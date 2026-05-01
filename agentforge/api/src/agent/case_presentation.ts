import { generateText } from 'ai';
import type { Env } from '../env.js';
import { verifySessionToken } from '../handshake/sessionToken.js';
import { OpenEmrCallError } from '../openemr/client.js';
import type { Observability } from '../observability/index.js';
import { assertBoundPatient } from '../tools/_binding.js';
import { estimateUsdForProviderTokens } from './cost_estimate.js';
import { fetchCasePresentationData } from './case_presentation_fetch.js';
import { casePresentationCacheGet, casePresentationCacheSet } from './case_presentation_cache.js';
import { CASE_PRESENTATION_SYSTEM_PROMPT } from './case_presentation_prompt.js';
import { getChatModel } from './model.js';
import { parseBlocksFromModelText } from './orchestrator.js';
import { buildCitationNavigationIndex, buildClinicalToolEvidence, type CitationNavigationHint } from './toolEvidence.js';
import { verifyClinicalBlocks } from './verification.js';
import type { ChatBlock } from '../openemr/types.js';

export type CasePresentationInput = {
  readonly sessionToken: string;
  readonly patientUuid: string;
  readonly forceRefresh?: boolean;
};

type CasePresentationResult = {
  blocks: ChatBlock[];
  citation_navigation: Record<string, CitationNavigationHint>;
};

/**
 * In-flight coalescer: if two callers race past the cache for the same
 * (sessionToken, patientUuid, encounterId) — e.g. the rail container's two
 * auto-fire pings on chart open — they share a single LLM call instead of
 * producing two subtly different briefs.
 *
 * `encounterId` is part of the key for the same reason the cache key is
 * (P3 fix): two concurrent calls under the same token across an encounter
 * change must NOT coalesce, or they'd return a brief scoped to whichever
 * encounter happened to win the race.
 */
const inflight = new Map<string, Promise<CasePresentationResult>>();

function inflightKey(sessionToken: string, patientUuid: string, encounterId: number | null): string {
  const enc = encounterId === null ? 'none' : String(encounterId);
  return `${patientUuid}\0${enc}\0${sessionToken}`;
}

/**
 * P3 guard: a brief that came back with zero blocks (transient LLM/provider
 * hiccup) or only refusal blocks (chart_read_failed, etc.) is NOT a usable
 * cached answer. Caching it pins the operator to a blank rail for the full
 * 30-minute TTL with no recovery path short of clicking Refresh — which is
 * the exact P3 reproducer. Empty / refusal-only results are returned to the
 * caller (so they see what happened) but never persisted to the cache.
 */
function isCacheable(blocks: readonly ChatBlock[]): boolean {
  if (blocks.length === 0) {
    return false;
  }
  return blocks.some((b) => b.type !== 'refusal');
}

/** Test-only: clear in-flight de-dup map. */
export function __resetCasePresentationInflightForTests(): void {
  inflight.clear();
}

export async function runCasePresentation(
  env: Env,
  observability: Observability,
  input: CasePresentationInput,
  correlationId: string,
): Promise<CasePresentationResult> {
  const { sessionToken, patientUuid, forceRefresh } = input;

  const bound = assertBoundPatient(env, sessionToken, patientUuid);
  if (!bound.ok) {
    return { blocks: [{ type: 'refusal', reason: 'active_chart_mismatch' }], citation_navigation: {} };
  }

  // P3 fix: encounter_id participates in the cache + inflight key so two
  // encounters on the same patient under the same session token (which can
  // happen when the rail re-mints the launch code mid-session per the P2 fix)
  // do not collide. Token signature/expiry/binding is already verified by
  // `assertBoundPatient`; this re-verify is just to read the claim.
  const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  const encounterId = claims?.encounter_id ?? null;

  if (!forceRefresh) {
    const cached = casePresentationCacheGet(sessionToken, patientUuid, encounterId);
    if (cached !== null) {
      await observability.recordToolCall({
        correlationId,
        toolName: 'case_presentation',
        meta: { cache_hit: true },
      });
      return cached;
    }

    const key = inflightKey(sessionToken, patientUuid, encounterId);
    const pending = inflight.get(key);
    if (pending !== undefined) {
      await observability.recordToolCall({
        correlationId,
        toolName: 'case_presentation',
        meta: { inflight_coalesced: true },
      });
      return pending;
    }

    const promise = runCasePresentationUncached(env, observability, input, correlationId);
    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  }

  return runCasePresentationUncached(env, observability, input, correlationId);
}

async function runCasePresentationUncached(
  env: Env,
  observability: Observability,
  input: CasePresentationInput,
  correlationId: string,
): Promise<CasePresentationResult> {
  const { sessionToken, patientUuid } = input;

  const trace = await observability.traceTurn({ correlationId, turnName: 'case_presentation' });
  const ctx = { sessionToken, correlationId };

  // Token validity (signature, expiry, patient binding) is already gated by
  // `assertBoundPatient` above; this re-verify is just to read claims.
  // - facility_tz: P2 fix — format the brief's `today` in the operator's
  //   facility tz, not UTC.
  // - encounter_id: P3 fix — scope the cache write to this encounter so a
  //   later encounter on the same patient does not pick up this brief.
  const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  const facilityTz = claims?.facility_tz ?? null;
  const encounterId = claims?.encounter_id ?? null;

  let fetched;
  try {
    fetched = await fetchCasePresentationData(env, ctx, patientUuid, facilityTz);
  } catch (e) {
    if (e instanceof OpenEmrCallError) {
      return { blocks: [{ type: 'refusal', reason: 'chart_read_failed' }], citation_navigation: {} };
    }

    throw e;
  }

  const model = getChatModel(env);
  const userPrompt = `Chart context (JSON) for bound patient_uuid=${patientUuid}:\n${JSON.stringify(fetched.bundleForLlm)}`;

  await observability.recordLlmCall({
    correlationId,
    providerModel: env.LLM_PROVIDER,
    meta: { phase: 'case_presentation_request' },
  });

  const result = await generateText({
    model,
    system: CASE_PRESENTATION_SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  const evidence = buildClinicalToolEvidence(patientUuid, fetched.toolResults);
  let blocks = parseBlocksFromModelText(result.text);
  blocks = await verifyClinicalBlocks(observability, correlationId, blocks, evidence);

  const usage = result.totalUsage;
  const costUsd = estimateUsdForProviderTokens(env.LLM_PROVIDER, usage?.inputTokens, usage?.outputTokens) ?? null;
  const costMeta =
    usage === undefined ?
      { phase: 'case_presentation_completed', traceId: trace.id, cost_usd: null as number | null }
    : {
        phase: 'case_presentation_completed',
        traceId: trace.id,
        correlation_id: correlationId,
        provider: env.LLM_PROVIDER,
        input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null,
        cost_usd: costUsd ?? null,
      };

  console.info(JSON.stringify(costMeta));

  await observability.recordLlmCall({
    correlationId,
    providerModel: env.LLM_PROVIDER,
    meta: costMeta as Record<string, unknown>,
  });

  const citation_navigation = buildCitationNavigationIndex(fetched.toolResults);

  if (isCacheable(blocks)) {
    casePresentationCacheSet(sessionToken, patientUuid, encounterId, { blocks, citation_navigation });
  }

  return { blocks, citation_navigation };
}
