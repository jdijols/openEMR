/**
 * G2-Final-FB-A-02 — `synthesizeAgentSteps` coverage.
 *
 * Locks the orchestrator's helper that turns tool-result envelopes into
 * inline `agent_step` chat blocks for the CUI. The helper itself is pure
 * (no I/O, no model calls) so we exercise every important branch directly:
 * happy retrieval, retrieval-with-no-results, retrieval error, happy
 * extraction, schema-invalid extraction, attach_and_extract error.
 */
import { describe, expect, it } from 'vitest';
import { synthesizeAgentSteps, synthesizeCrossCheckFailRefusal } from '../../src/agent/orchestrator.js';
import type { AiToolResultLike } from '../../src/agent/tool_results.js';

const RETRIEVAL_STATS = {
  hits_sparse: 7,
  hits_dense: 10,
  hits_unioned: 12,
  hits_after_rerank: 5,
  top_chunk_ids: ['jnc8-bp#diabetes-mellitus'],
  rerank_scores: [0.92],
};

const EVIDENCE_OK: AiToolResultLike = {
  toolCallId: 'call-1',
  toolName: 'evidence_retrieve',
  input: { query: 'should we intensify her statin?', max_chunks: 5 },
  output: {
    ok: true,
    chunks: [{ chunk_id: 'c1' }],
    stats: RETRIEVAL_STATS,
    duration_ms: 1234,
    query_chars: 32,
    max_chunks: 5,
  },
};

const EVIDENCE_NO_RESULTS: AiToolResultLike = {
  toolCallId: 'call-2',
  toolName: 'evidence_retrieve',
  input: { query: 'something obscure not in corpus', max_chunks: 5 },
  output: {
    ok: true,
    chunks: [],
    stats: { ...RETRIEVAL_STATS, hits_after_rerank: 0, top_chunk_ids: [], rerank_scores: [] },
    duration_ms: 800,
    query_chars: 32,
    max_chunks: 5,
  },
};

const EVIDENCE_ERROR: AiToolResultLike = {
  toolCallId: 'call-3',
  toolName: 'evidence_retrieve',
  input: { query: 'q', max_chunks: 5 },
  output: { ok: false, error: 'evidence_retrieve_failed', duration_ms: 50, query_chars: 1, max_chunks: 5 },
};

const EXTRACTION_OK: AiToolResultLike = {
  toolCallId: 'call-4',
  toolName: 'attach_and_extract',
  input: { docref_uuid: 'a1b2c3d4-aaaa-bbbb-cccc-1234567890ab', doc_type: 'lab_pdf', patient_uuid: 'p' },
  output: {
    ok: true,
    duration_ms: 3400,
    result: {
      schemaValid: true,
      crossCheckStatus: 'verified',
      factsTotal: 14,
      factsVerified: 14,
    },
  },
};

const EXTRACTION_SCHEMA_INVALID: AiToolResultLike = {
  toolCallId: 'call-5',
  toolName: 'attach_and_extract',
  input: { docref_uuid: 'deadbeef-0000-1111-2222-333344445555', doc_type: 'intake_form', patient_uuid: 'p' },
  output: {
    ok: true,
    duration_ms: 1200,
    result: {
      schemaValid: false,
      crossCheckStatus: 'unverified',
      factsTotal: 0,
      factsVerified: 0,
    },
  },
};

const EXTRACTION_ERROR: AiToolResultLike = {
  toolCallId: 'call-6',
  toolName: 'attach_and_extract',
  input: { docref_uuid: 'aabbccdd-1111-2222-3333-444455556666', doc_type: 'lab_pdf', patient_uuid: 'p' },
  output: { ok: false, error: 'document_not_found', duration_ms: 25 },
};

describe('synthesizeAgentSteps (FB-A-02)', () => {
  it('emits an ok evidence_retriever step with stats + duration', () => {
    const steps = synthesizeAgentSteps([EVIDENCE_OK]);
    expect(steps).toHaveLength(1);
    const step = steps[0]!;
    expect(step.type).toBe('agent_step');
    if (step.type !== 'agent_step') return;
    expect(step.worker).toBe('evidence_retriever');
    expect(step.outcome).toBe('ok');
    expect(step.duration_ms).toBe(1234);
    expect(step.input_summary).toEqual({ query_chars: 32, max_chunks: 5 });
    expect(step.stats).toMatchObject({ hits_after_rerank: 5 });
  });

  it('emits a no_results evidence_retriever step when rerank returns zero', () => {
    const steps = synthesizeAgentSteps([EVIDENCE_NO_RESULTS]);
    expect(steps).toHaveLength(1);
    if (steps[0]!.type !== 'agent_step') throw new Error('wrong type');
    expect(steps[0]!.outcome).toBe('no_results');
  });

  it('emits an error evidence_retriever step when ok=false', () => {
    const steps = synthesizeAgentSteps([EVIDENCE_ERROR]);
    expect(steps).toHaveLength(1);
    if (steps[0]!.type !== 'agent_step') throw new Error('wrong type');
    expect(steps[0]!.outcome).toBe('error');
    expect(steps[0]!.stats).toBeUndefined();
  });

  it('emits an ok intake_extractor step with schema_valid + facts stats', () => {
    const steps = synthesizeAgentSteps([EXTRACTION_OK]);
    expect(steps).toHaveLength(1);
    if (steps[0]!.type !== 'agent_step') throw new Error('wrong type');
    expect(steps[0]!.worker).toBe('intake_extractor');
    expect(steps[0]!.outcome).toBe('ok');
    expect(steps[0]!.duration_ms).toBe(3400);
    expect(steps[0]!.input_summary).toMatchObject({ docref_uuid_prefix: 'a1b2c3d4', doc_type: 'lab_pdf' });
    expect(steps[0]!.stats).toMatchObject({
      schema_valid: true,
      cross_check_status: 'verified',
      facts_total: 14,
      facts_verified: 14,
    });
  });

  it('emits an error intake_extractor step when schema_valid is false', () => {
    const steps = synthesizeAgentSteps([EXTRACTION_SCHEMA_INVALID]);
    expect(steps).toHaveLength(1);
    if (steps[0]!.type !== 'agent_step') throw new Error('wrong type');
    expect(steps[0]!.outcome).toBe('error');
    expect(steps[0]!.stats).toMatchObject({ schema_valid: false });
  });

  it('emits an error intake_extractor step when ok=false', () => {
    const steps = synthesizeAgentSteps([EXTRACTION_ERROR]);
    expect(steps).toHaveLength(1);
    if (steps[0]!.type !== 'agent_step') throw new Error('wrong type');
    expect(steps[0]!.outcome).toBe('error');
    expect(steps[0]!.input_summary).toMatchObject({ docref_uuid_prefix: 'aabbccdd', doc_type: 'lab_pdf' });
  });

  it('emits one block per invocation in order, ignoring non-W2 tools', () => {
    const noise: AiToolResultLike = {
      toolCallId: 'call-noise',
      toolName: 'get_identity',
      input: {},
      output: { ok: true, data: {} },
    };
    const steps = synthesizeAgentSteps([noise, EXTRACTION_OK, noise, EVIDENCE_OK, noise]);
    expect(steps).toHaveLength(2);
    if (steps[0]!.type !== 'agent_step' || steps[1]!.type !== 'agent_step') throw new Error('wrong type');
    expect(steps[0]!.worker).toBe('intake_extractor');
    expect(steps[1]!.worker).toBe('evidence_retriever');
  });
});

describe('synthesizeCrossCheckFailRefusal (FB-B-02)', () => {
  const TR_VERIFIED: AiToolResultLike = {
    toolCallId: 'call-v',
    toolName: 'attach_and_extract',
    input: { docref_uuid: 'd1', doc_type: 'lab_pdf', patient_uuid: 'p' },
    output: {
      ok: true,
      duration_ms: 100,
      result: { schemaValid: true, crossCheckStatus: 'verified', factsTotal: 3, factsVerified: 3 },
      persistence: { attempted: true, inserted: 3, updated: 0, failed: 0 },
    },
  };

  const TR_CROSS_CHECK_FAILED: AiToolResultLike = {
    toolCallId: 'call-x',
    toolName: 'attach_and_extract',
    input: { docref_uuid: 'd2', doc_type: 'lab_pdf', patient_uuid: 'p' },
    output: {
      ok: true,
      duration_ms: 100,
      result: { schemaValid: true, crossCheckStatus: 'unverified', factsTotal: 3, factsVerified: 0 },
      persistence: { attempted: false, inserted: 0, updated: 0, failed: 0, skipped_reason: 'cross_check_failed' },
    },
  };

  it('returns null when no cross-check failure occurred', () => {
    expect(synthesizeCrossCheckFailRefusal([TR_VERIFIED])).toBeNull();
  });

  it('returns a refusal block when the latest extraction skipped persistence on cross-check fail', () => {
    const out = synthesizeCrossCheckFailRefusal([TR_CROSS_CHECK_FAILED]);
    expect(out).not.toBeNull();
    expect(out?.type).toBe('refusal');
    if (out?.type !== 'refusal') return;
    expect(out.reason).toContain("couldn't be verified");
  });

  it('only surfaces the LATEST failure when multiple uploads happened in one turn', () => {
    const out = synthesizeCrossCheckFailRefusal([TR_VERIFIED, TR_CROSS_CHECK_FAILED]);
    expect(out?.type).toBe('refusal');
  });

  it('returns null when failure preceded a later success in the same turn', () => {
    const out = synthesizeCrossCheckFailRefusal([TR_CROSS_CHECK_FAILED, TR_VERIFIED]);
    expect(out).toBeNull();
  });
});
