import type { Pool } from 'pg';
import type { CohereClient } from 'cohere-ai';
import type { SourceCitation } from '../schemas/extraction.js';

/**
 * §8 / G2-MVP-55 — `evidence_retriever` worker.
 *
 * Hybrid retrieval pipeline:
 *  1. Sparse: tsvector / plainto_tsquery / ts_rank_cd top-10.
 *  2. Dense:  bge-small embedding → cosine `<=>` top-10.
 *  3. Union + dedupe by chunk_id.
 *  4. Cohere Rerank → top `max_chunks` (default 5).
 *  5. Pre-build SourceCitationSchema for each surviving chunk.
 *
 * Returns evidence snippets with rerank_score plus a citation conforming to
 * the W2 §6 contract — `source_type='guideline_chunk'`, `quote_or_value`
 * holds the chunk text (capped at 400 chars to keep span bodies bounded).
 */

export type EvidenceChunk = {
  readonly chunk_id: string;
  readonly section: string;
  readonly text: string;
  readonly source_url: string;
  readonly rerank_score: number;
  readonly citation: SourceCitation;
};

export type EvidenceRetrieverInput = {
  readonly query: string;
  readonly maxChunks: number;
};

export type EvidenceRetrieverDeps = {
  readonly pool: Pool;
  /**
   * Embed `text` into a 384-d float vector. Production uses bge-small via
   * @xenova/transformers. Tests inject a deterministic stub.
   */
  readonly embedQuery: (text: string) => Promise<readonly number[]>;
  /**
   * Cohere rerank client. Tests inject a fake that returns ranked indices.
   */
  readonly cohere: Pick<CohereClient, 'rerank'> | { rerank: CohereClient['rerank'] };
  readonly cohereModel?: string;
};

const SPARSE_TOP_K = 10;
const DENSE_TOP_K = 10;
const QUOTE_MAX_LEN = 400;
const DEFAULT_RERANK_MODEL = 'rerank-english-v3.0';

export async function runEvidenceRetriever(
  input: EvidenceRetrieverInput,
  deps: EvidenceRetrieverDeps,
): Promise<readonly EvidenceChunk[]> {
  const query = input.query.trim();
  if (query.length === 0) {
    return [];
  }

  // 1. Sparse retrieval (tsvector + ts_rank_cd)
  const sparseRows = await deps.pool.query<{
    chunk_id: string;
    section: string;
    text: string;
    source_url: string;
  }>(
    `SELECT chunk_id, section, text, source_url
     FROM rag_chunks
     WHERE text_search @@ plainto_tsquery('english', $1)
     ORDER BY ts_rank_cd(text_search, plainto_tsquery('english', $1)) DESC
     LIMIT $2`,
    [query, SPARSE_TOP_K],
  );

  // 2. Dense retrieval (cosine via pgvector <=>)
  const queryVec = await deps.embedQuery(query);
  const queryVecLiteral = `[${queryVec.join(',')}]`;
  const denseRows = await deps.pool.query<{
    chunk_id: string;
    section: string;
    text: string;
    source_url: string;
  }>(
    `SELECT chunk_id, section, text, source_url
     FROM rag_chunks
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    [queryVecLiteral, DENSE_TOP_K],
  );

  // 3. Union + dedupe by chunk_id (sparse first to bias FTS coverage).
  const dedupe = new Map<string, { chunk_id: string; section: string; text: string; source_url: string }>();
  for (const row of [...sparseRows.rows, ...denseRows.rows]) {
    if (!dedupe.has(row.chunk_id)) {
      dedupe.set(row.chunk_id, row);
    }
  }
  const candidates = [...dedupe.values()];
  if (candidates.length === 0) {
    return [];
  }

  // 4. Cohere Rerank
  const rerankResponse = await deps.cohere.rerank({
    model: deps.cohereModel ?? DEFAULT_RERANK_MODEL,
    query,
    documents: candidates.map((c) => c.text),
    topN: Math.min(input.maxChunks, candidates.length),
  });

  const rerankResults = (rerankResponse as { results?: ReadonlyArray<{ index: number; relevanceScore: number }> }).results ?? [];

  // 5. Build citation envelopes for each surviving chunk.
  return rerankResults
    .filter((r): r is { index: number; relevanceScore: number } => typeof r.index === 'number' && r.index >= 0 && r.index < candidates.length)
    .map((r) => {
      const chunk = candidates[r.index];
      if (!chunk) {
        // unreachable per the filter, but TS narrows safely.
        throw new Error('rerank index out of range');
      }
      const quote = chunk.text.length > QUOTE_MAX_LEN ? `${chunk.text.slice(0, QUOTE_MAX_LEN - 1)}…` : chunk.text;
      return {
        chunk_id: chunk.chunk_id,
        section: chunk.section,
        text: chunk.text,
        source_url: chunk.source_url,
        rerank_score: r.relevanceScore,
        citation: {
          source_type: 'guideline_chunk',
          source_id: chunk.chunk_id,
          page_or_section: chunk.section,
          field_or_chunk_id: chunk.chunk_id,
          quote_or_value: quote,
        } satisfies SourceCitation,
      };
    });
}
