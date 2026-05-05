import Anthropic from '@anthropic-ai/sdk';
import { CohereClient } from 'cohere-ai';
import type { Pool } from 'pg';
import type { Env } from '../env.js';
import type { Observability } from '../observability/index.js';
import { createAttachAndExtractTool, type AttachAndExtractDeps, type DocumentBytesFetcher } from '../tools/attach_and_extract.js';
import { createEvidenceRetrieveTool, type EvidenceRetrieveDeps } from '../tools/evidence_retrieve.js';
import type { IntakeExtractorDeps } from '../workers/intake_extractor.js';

/**
 * §7 / G2-MVP-36 — W2 supervisor-tool factory.
 *
 * Constructs the two new W2 tools (`attach_and_extract`, `evidence_retrieve`)
 * with all their heavy clients (Anthropic, Cohere, bge-small embedder)
 * lazily-instantiated and cached across turns. The orchestrator imports
 * the returned bag and merges it into its existing tool registry.
 */

type CachedClients = {
  anthropic: Anthropic;
  cohere: CohereClient;
  embedQuery: EvidenceRetrieveDeps['embedQuery'];
  pdfParseFn: IntakeExtractorDeps['pdfParseFn'];
};

let cached: CachedClients | null = null;

async function getClients(env: Env): Promise<CachedClients> {
  if (cached !== null) {
    return cached;
  }
  const anthropic = new Anthropic({ apiKey: env.LLM_API_KEY });
  const cohere = new CohereClient({ token: env.COHERE_API_KEY });

  // Lazy-loaded bge-small embedder. Heavy first call; cached afterwards.
  let embedderPromise: Promise<(text: string) => Promise<readonly number[]>> | null = null;
  const embedQuery: EvidenceRetrieveDeps['embedQuery'] = async (text) => {
    if (embedderPromise === null) {
      embedderPromise = (async () => {
        const { pipeline } = await import('@xenova/transformers');
        const ext = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
        return async (s: string) => {
          const out = await ext(s, { pooling: 'mean', normalize: true });
          return Array.from(out.data) as number[];
        };
      })();
    }
    const fn = await embedderPromise;
    return fn(text);
  };

  // Lazy pdf-parse import (heavy parser; only loaded when first PDF is processed).
  let pdfParseModulePromise: Promise<(buf: Buffer) => Promise<{ text: string }>> | null = null;
  const pdfParseFn: IntakeExtractorDeps['pdfParseFn'] = async (bytes: Uint8Array) => {
    if (pdfParseModulePromise === null) {
      pdfParseModulePromise = (async () => {
        const mod = await import('pdf-parse');
        const fn = (mod as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default;
        return fn;
      })();
    }
    const fn = await pdfParseModulePromise;
    return fn(Buffer.from(bytes));
  };

  cached = { anthropic, cohere, embedQuery, pdfParseFn };
  return cached;
}

/**
 * HTTP fetch for /document/bytes.php — same-session ACL is enforced server-side
 * by ChartContextGate; the agent forwards its session_token + patient_uuid.
 */
function makeBytesFetcher(env: Env, sessionToken: string): DocumentBytesFetcher {
  return async ({ docrefUuid, patientUuidCanonical }) => {
    const url = new URL(`${env.OPENEMR_MODULE_BASE_URL.replace(/\/$/, '')}/document/bytes.php`);
    url.searchParams.set('docref_uuid', docrefUuid);
    url.searchParams.set('session_token', sessionToken);
    url.searchParams.set('patient_uuid', patientUuidCanonical);

    const resp = await fetch(url, { method: 'GET' });
    if (resp.status === 404) {
      return null;
    }
    if (!resp.ok) {
      throw new Error(`bytes_fetch_failed_${resp.status}`);
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') ?? 'application/octet-stream';
    return { bytes: buf, mimeType };
  };
}

export type W2ToolsDeps = {
  readonly env: Env;
  readonly pool: Pool;
  readonly sessionToken: string;
  readonly correlationId: string;
  readonly observability: Observability;
};

export async function createW2Tools(deps: W2ToolsDeps) {
  const clients = await getClients(deps.env);

  const attachExtractDeps: AttachAndExtractDeps = {
    env: deps.env,
    sessionToken: deps.sessionToken,
    correlationId: deps.correlationId,
    observability: deps.observability,
    fetchBytes: makeBytesFetcher(deps.env, deps.sessionToken),
    extractorDeps: {
      client: clients.anthropic,
      pdfParseFn: clients.pdfParseFn,
    },
  };

  const evidenceDeps: EvidenceRetrieveDeps = {
    pool: deps.pool,
    embedQuery: clients.embedQuery,
    cohere: clients.cohere,
    observability: deps.observability,
    correlationId: deps.correlationId,
  };

  return {
    attach_and_extract: createAttachAndExtractTool(attachExtractDeps),
    evidence_retrieve: createEvidenceRetrieveTool(evidenceDeps),
  };
}

/**
 * Pure helper for tests: builds the W2 turn-header note that the
 * orchestrator appends when the physician's turn carries a `docref_uuid`.
 */
export function buildW2DocumentNote(docrefUuid: string | undefined, docType: string | undefined): string {
  if (!docrefUuid || !docType) {
    return '';
  }
  return `\n\nUploaded document available — call attach_and_extract({patient_uuid, docref_uuid: "${docrefUuid}", doc_type: "${docType}"}) BEFORE answering. The extracted facts go into the chart; cite them with their returned source_pack uuids.`;
}
