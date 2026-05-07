/**
 * Pre-LLM mandatory retrieval — runs `runEvidenceRetriever` directly when the
 * orchestrator classifies the user message as a clinical question. Bypasses
 * the AI SDK tool wrapper (which the model decides whether to call), making
 * retrieval deterministic instead of probabilistic.
 *
 * Outputs three things:
 *   1. A prompt preamble listing each retrieved chunk with its citation_id
 *      visible to the model. The model uses these citation_ids when emitting
 *      claim segments — they map 1:1 to source_pack.uuid in the verification
 *      gate.
 *   2. A synthetic AiToolResultLike that mimics what the model would have
 *      received had it called evidence_retrieve itself. Merged into the
 *      orchestrator's tool-results array so `buildClinicalToolEvidence`
 *      picks up the citation UUIDs.
 *   3. A citation legend (id → short label + source url) for the structured
 *      finalization step.
 */

import type { Pool } from 'pg';
import type { CohereClient } from 'cohere-ai';
import type { Observability } from '../observability/index.js';
import { runEvidenceRetriever, type EvidenceRetrieverDeps } from '../workers/evidence_retriever.js';
import type { AiToolResultLike } from './tool_results.js';

const MANDATORY_RETRIEVAL_MAX_CHUNKS = 5;

export type MandatoryRetrievalDeps = Readonly<{
  pool: Pool;
  embedQuery: EvidenceRetrieverDeps['embedQuery'];
  cohere: Pick<CohereClient, 'rerank'>;
  observability: Observability;
  correlationId: string;
}>;

export type CitationLegendEntry = Readonly<{
  citation_id: string;
  section: string;
  source_url: string;
  /** First ~120 chars of the chunk text — used in prompt preamble. */
  preview: string;
}>;

export type MandatoryRetrievalOutput = Readonly<{
  promptPreamble: string;
  syntheticToolResult: AiToolResultLike;
  citationLegend: ReadonlyArray<CitationLegendEntry>;
  /** Set of citation IDs available for the model to cite from this turn. */
  allowedCitationIds: ReadonlySet<string>;
  chunkCount: number;
}>;

/**
 * Run mandatory retrieval and shape the result for the orchestrator.
 * Returns `null` when retrieval fails or returns zero chunks — the orchestrator
 * proceeds without a preamble (the model can still call evidence_retrieve as a
 * tool if it judges the question needs it).
 */
export async function runMandatoryRetrieval(
  query: string,
  deps: MandatoryRetrievalDeps,
): Promise<MandatoryRetrievalOutput | null> {
  const span = await deps.observability.recordToolCall({
    correlationId: deps.correlationId,
    toolName: 'evidence_retrieve',
    meta: {
      query_chars: query.length,
      max_chunks: MANDATORY_RETRIEVAL_MAX_CHUNKS,
      mandatory: true,
    },
  });

  try {
    const { chunks, stats } = await runEvidenceRetriever(
      { query, maxChunks: MANDATORY_RETRIEVAL_MAX_CHUNKS },
      { pool: deps.pool, embedQuery: deps.embedQuery, cohere: deps.cohere },
    );

    await span.end({
      meta: {
        outcome: 'ok',
        mandatory: true,
        chunks_returned: chunks.length,
        hits_sparse: stats.hits_sparse,
        hits_dense: stats.hits_dense,
        hits_unioned: stats.hits_unioned,
        hits_after_rerank: stats.hits_after_rerank,
        top_chunk_ids: stats.top_chunk_ids,
        rerank_scores: stats.rerank_scores,
      },
    });

    if (chunks.length === 0) {
      return null;
    }

    const asOf = new Date().toISOString();

    // Wrap chunks the same way the evidence_retrieve tool does so
    // `buildClinicalToolEvidence` extracts source_pack.uuid identically.
    const wrapped = chunks.map((c) => ({
      ...c,
      source_pack: {
        resource_family: 'clinical_guideline',
        table: 'rag_chunks',
        row_id: 0,
        uuid: c.chunk_id,
        as_of: asOf,
        retrieval_path: 'evidence_retrieve',
        navigation_hint: {
          kind: 'guideline_chunk',
          params: {
            chunk_id: c.chunk_id,
            section: c.section,
            source_url: c.source_url,
          },
        },
      },
    }));

    const syntheticToolResult: AiToolResultLike = {
      type: 'tool-result',
      toolName: 'evidence_retrieve',
      toolCallId: `mandatory-${deps.correlationId}`,
      input: { query, max_chunks: MANDATORY_RETRIEVAL_MAX_CHUNKS, mandatory: true },
      output: { ok: true as const, chunks: wrapped, mandatory: true },
    };

    const citationLegend: CitationLegendEntry[] = chunks.map((c) => ({
      citation_id: c.chunk_id,
      section: c.section,
      source_url: c.source_url,
      preview: c.text.length > 240 ? `${c.text.slice(0, 239)}…` : c.text,
    }));

    const allowedCitationIds = new Set<string>(chunks.map((c) => c.chunk_id));

    const promptPreamble = formatPreamble(citationLegend);

    return {
      promptPreamble,
      syntheticToolResult,
      citationLegend,
      allowedCitationIds,
      chunkCount: chunks.length,
    };
  } catch (e) {
    await span.end({ error: e });
    // Soft-fail: orchestrator will proceed without mandatory evidence and
    // the model can still attempt evidence_retrieve as a tool call. The
    // verification gate will still refuse if the model tries to cite an
    // unknown id.
    return null;
  }
}

function formatPreamble(legend: ReadonlyArray<CitationLegendEntry>): string {
  const lines = legend.map((entry, i) => {
    const idx = i + 1;
    return [
      `[${idx}] citation_id: ${entry.citation_id}`,
      `    section: ${entry.section}`,
      `    source: ${entry.source_url}`,
      `    text: ${entry.preview}`,
    ].join('\n');
  });

  return [
    '',
    '=== RETRIEVED CLINICAL EVIDENCE (deterministic; cite ONLY from these citation_ids) ===',
    ...lines,
    '=== END EVIDENCE ===',
    '',
  ].join('\n');
}
