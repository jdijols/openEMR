/**
 * G2-Final-FB-A-01 — `agent_step` block schema coverage.
 *
 * Locks the new discriminated-union variant added to `chatBlockSchema` so
 * the orchestrator's `synthesizeAgentSteps` (FB-A-02) and the CUI's
 * `AgentStepStrip` (FB-A-03) can lean on the schema as the single source
 * of truth. Strictly additive — these tests do NOT exercise the existing
 * variants (text / claim / proposal / extraction / etc.); those remain
 * covered through the orchestrator round-trip suite.
 */
import { describe, expect, it } from 'vitest';
import { chatBlockSchema } from '../../src/openemr/types.js';

const RETRIEVAL_STATS = {
  hits_sparse: 7,
  hits_dense: 10,
  hits_unioned: 12,
  hits_after_rerank: 5,
  top_chunk_ids: ['jnc8-bp#diabetes-mellitus', 'uspstf-statin#high-intensity'],
  rerank_scores: [0.92, 0.81],
};

const EXTRACTION_STATS = {
  schema_valid: true,
  cross_check_status: 'verified',
  facts_total: 14,
  facts_verified: 14,
  overall_confidence: 'high',
};

describe('chatBlockSchema — agent_step variant (FB-A-01)', () => {
  it('accepts a canonical evidence_retriever step', () => {
    const parsed = chatBlockSchema.safeParse({
      type: 'agent_step',
      worker: 'evidence_retriever',
      reason: 'user question contains evidence-seeking language; supervisor routed to evidence_retriever for guideline grounding.',
      input_summary: { query_chars: 84, max_chunks: 5 },
      duration_ms: 1234,
      outcome: 'ok',
      stats: RETRIEVAL_STATS,
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a canonical intake_extractor step (no stats branch tolerated)', () => {
    const parsed = chatBlockSchema.safeParse({
      type: 'agent_step',
      worker: 'intake_extractor',
      reason: 'docref_uuid present in turn input; supervisor routed to intake_extractor before answering.',
      input_summary: { docref_uuid_prefix: 'a1b2c3d4', doc_type: 'lab_pdf' },
      duration_ms: 3400,
      outcome: 'ok',
      stats: EXTRACTION_STATS,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown worker enum value', () => {
    const parsed = chatBlockSchema.safeParse({
      type: 'agent_step',
      worker: 'mystery_worker',
      reason: 'should not parse',
      input_summary: {},
      duration_ms: 0,
      outcome: 'ok',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a negative duration_ms', () => {
    const parsed = chatBlockSchema.safeParse({
      type: 'agent_step',
      worker: 'intake_extractor',
      reason: 'r',
      input_summary: {},
      duration_ms: -5,
      outcome: 'ok',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown outcome enum value', () => {
    const parsed = chatBlockSchema.safeParse({
      type: 'agent_step',
      worker: 'evidence_retriever',
      reason: 'r',
      input_summary: {},
      duration_ms: 100,
      outcome: 'mostly-ok',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an empty reason string', () => {
    const parsed = chatBlockSchema.safeParse({
      type: 'agent_step',
      worker: 'evidence_retriever',
      reason: '',
      input_summary: {},
      duration_ms: 100,
      outcome: 'ok',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a reason longer than 240 chars', () => {
    const parsed = chatBlockSchema.safeParse({
      type: 'agent_step',
      worker: 'evidence_retriever',
      reason: 'x'.repeat(241),
      input_summary: {},
      duration_ms: 100,
      outcome: 'ok',
    });
    expect(parsed.success).toBe(false);
  });
});
