import { describe, expect, it, vi } from 'vitest';
import { runEvidenceRetriever, type EvidenceRetrieverDeps } from '../../src/workers/evidence_retriever.js';

/**
 * §8 / G2-MVP-55 — evidence_retriever isolated tests.
 *
 * Three scenarios (pg + Cohere + embedder all mocked):
 *  (a) returns ranked chunks with §6-shaped citations.
 *  (b) dedupes overlap between sparse and dense.
 *  (c) handles empty result gracefully (returns []).
 */

function makePool(rows: { sparse: ReadonlyArray<unknown>; dense: ReadonlyArray<unknown> }) {
  // Each call to pool.query alternates between sparse first, then dense.
  const queries: ReadonlyArray<unknown>[] = [rows.sparse, rows.dense];
  let i = 0;
  return {
    query: vi.fn(async () => ({ rows: queries[i++] ?? [] })),
  } as unknown as EvidenceRetrieverDeps['pool'];
}

function makeCohere(rerankIndices: number[], scoreBase = 0.9): EvidenceRetrieverDeps['cohere'] {
  return {
    rerank: vi.fn(async () => ({
      results: rerankIndices.map((index, i) => ({
        index,
        relevanceScore: scoreBase - i * 0.05,
      })),
    })),
  } as unknown as EvidenceRetrieverDeps['cohere'];
}

const embedQueryStub: EvidenceRetrieverDeps['embedQuery'] = async () => Array.from({ length: 384 }, () => 0);

describe('§8 G2-MVP-55 — evidence_retriever', () => {
  it('returns ranked chunks with §6-shaped citations', async () => {
    const pool = makePool({
      sparse: [
        { chunk_id: 'uspstf-statin#statin-intensification-in-diabetes', section: 'Statin Intensification in Diabetes', text: 'Patients with diabetes plus risk enhancers warrant high-intensity statin.', source_url: 'https://example/uspstf' },
      ],
      dense: [
        { chunk_id: 'ada-glycemic#statin-therapy-in-diabetes', section: 'Statin Therapy in Diabetes', text: 'High-intensity statin recommended for diabetes ages 40-75 with ASCVD risk factors.', source_url: 'https://example/ada' },
      ],
    });
    const cohere = makeCohere([0, 1]);

    const { chunks, stats } = await runEvidenceRetriever(
      { query: 'should we intensify her statin?', maxChunks: 5 },
      { pool, embedQuery: embedQueryStub, cohere },
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.citation.source_type).toBe('guideline_chunk');
    expect(chunks[0]?.citation.source_id).toBe('uspstf-statin#statin-intensification-in-diabetes');
    expect(chunks[0]?.citation.quote_or_value.length).toBeGreaterThan(0);
    expect(chunks[0]?.rerank_score).toBeGreaterThan(0);

    // §12 / G2-Early-50 — per-stage retrieval stats surface for span meta.
    expect(stats.hits_sparse).toBe(1);
    expect(stats.hits_dense).toBe(1);
    expect(stats.hits_unioned).toBe(2);
    expect(stats.hits_after_rerank).toBe(2);
    expect(stats.top_chunk_ids).toHaveLength(2);
    expect(stats.rerank_scores).toHaveLength(2);
  });

  it('dedupes overlap between sparse and dense', async () => {
    // Sparse and dense both surface the same chunk_id; rerank sees ONE unique candidate.
    const sharedChunk = { chunk_id: 'uspstf-statin#statin-intensification-in-diabetes', section: 'Statin Intensification', text: 'High-intensity statin in diabetes.', source_url: 'https://example/uspstf' };
    const pool = makePool({
      sparse: [sharedChunk],
      dense: [sharedChunk],
    });
    const cohere = makeCohere([0]);

    const { chunks, stats } = await runEvidenceRetriever(
      { query: 'statin intensification', maxChunks: 5 },
      { pool, embedQuery: embedQueryStub, cohere },
    );

    expect(chunks).toHaveLength(1);
    expect(stats.hits_sparse).toBe(1);
    expect(stats.hits_dense).toBe(1);
    expect(stats.hits_unioned).toBe(1); // dedupe collapsed to one
    const rerankFn = cohere.rerank as ReturnType<typeof vi.fn>;
    expect(rerankFn).toHaveBeenCalledOnce();
    const firstCall = rerankFn.mock.calls[0]?.[0] as { documents: unknown[] } | undefined;
    expect(firstCall?.documents).toHaveLength(1);
  });

  it('handles empty result gracefully', async () => {
    const pool = makePool({ sparse: [], dense: [] });
    const cohere = makeCohere([]);

    const { chunks, stats } = await runEvidenceRetriever(
      { query: 'no matching evidence here', maxChunks: 5 },
      { pool, embedQuery: embedQueryStub, cohere },
    );

    expect(chunks).toHaveLength(0);
    expect(stats.hits_unioned).toBe(0);
    expect(stats.hits_after_rerank).toBe(0);
    // Cohere should not be called when there are no candidates to rerank.
    expect(cohere.rerank).not.toHaveBeenCalled();
  });
});
