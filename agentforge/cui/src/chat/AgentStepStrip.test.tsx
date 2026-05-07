import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentStepStrip, type AgentStepBlock } from './AgentStepStrip.js';

/**
 * G2-Final-FB-A-03 — AgentStepStrip render + click-expand coverage.
 *
 * Locks the inline-strip's two visual states (collapsed summary, expanded
 * detail) and the per-worker key-stat formatting so a regression that
 * silently drops the funnel numbers or the schema-valid pill stays out of
 * the demo lane. data-testid hooks chosen so the future `MessageList`
 * integration test can lean on them without reaching into styles.
 */

const RETRIEVAL_OK: AgentStepBlock = {
  worker: 'evidence_retriever',
  reason:
    'user question contains evidence-seeking language; supervisor routed to evidence_retriever for guideline grounding.',
  input_summary: { query_chars: 84, max_chunks: 5 },
  duration_ms: 1234,
  outcome: 'ok',
  stats: {
    hits_sparse: 7,
    hits_dense: 10,
    hits_unioned: 12,
    hits_after_rerank: 5,
    top_chunk_ids: ['jnc8-bp#diabetes-mellitus'],
    rerank_scores: [0.92],
  },
};

const EXTRACTION_OK: AgentStepBlock = {
  worker: 'intake_extractor',
  reason:
    'docref_uuid present in turn input; supervisor routed to intake_extractor before answering.',
  input_summary: { docref_uuid_prefix: 'a1b2c3d4', doc_type: 'lab_pdf' },
  duration_ms: 3400,
  outcome: 'ok',
  stats: {
    schema_valid: true,
    cross_check_status: 'verified',
    facts_total: 14,
    facts_verified: 14,
  },
};

const EVIDENCE_NO_RESULTS: AgentStepBlock = {
  worker: 'evidence_retriever',
  reason: 'r',
  input_summary: { query_chars: 22, max_chunks: 5 },
  duration_ms: 800,
  outcome: 'no_results',
  stats: {
    hits_sparse: 0,
    hits_dense: 0,
    hits_unioned: 0,
    hits_after_rerank: 0,
    top_chunk_ids: [],
    rerank_scores: [],
  },
};

const EXTRACTION_ERROR: AgentStepBlock = {
  worker: 'intake_extractor',
  reason: 'r',
  input_summary: { docref_uuid_prefix: 'aabbccdd', doc_type: 'lab_pdf' },
  duration_ms: 25,
  outcome: 'error',
};

describe('AgentStepStrip (FB-A-03)', () => {
  it('renders collapsed retrieval summary with funnel stats', () => {
    render(<AgentStepStrip block={RETRIEVAL_OK} />);
    const strip = screen.getByTestId('agent-step-strip');
    expect(strip).toHaveAttribute('data-worker', 'evidence_retriever');
    expect(strip).toHaveAttribute('data-outcome', 'ok');
    expect(strip).toHaveTextContent('Routed to evidence_retriever');
    expect(strip).toHaveTextContent('1.2s');
    expect(strip).toHaveTextContent('sparse 7 + dense 10 → 12 unioned → 5 reranked');
    expect(screen.queryByTestId('agent-step-detail')).toBeNull();
  });

  it('renders collapsed extraction summary with schema-valid + verified counts', () => {
    render(<AgentStepStrip block={EXTRACTION_OK} />);
    const strip = screen.getByTestId('agent-step-strip');
    expect(strip).toHaveAttribute('data-worker', 'intake_extractor');
    expect(strip).toHaveTextContent('Routed to intake_extractor');
    expect(strip).toHaveTextContent('3.4s');
    expect(strip).toHaveTextContent('schema valid');
    expect(strip).toHaveTextContent('14/14 verified');
    expect(strip).toHaveTextContent('verified');
  });

  it('expands to reveal reason + input_summary + stats on click', () => {
    render(<AgentStepStrip block={RETRIEVAL_OK} />);
    fireEvent.click(screen.getByTestId('agent-step-toggle'));
    const detail = screen.getByTestId('agent-step-detail');
    expect(detail).toHaveTextContent('user question contains evidence-seeking');
    expect(detail).toHaveTextContent('input_summary');
    expect(detail).toHaveTextContent('stats');
  });

  it('marks no_results outcome distinctly from ok', () => {
    render(<AgentStepStrip block={EVIDENCE_NO_RESULTS} />);
    const strip = screen.getByTestId('agent-step-strip');
    expect(strip).toHaveAttribute('data-outcome', 'no_results');
    expect(strip).toHaveTextContent('0 reranked');
  });

  it('marks error outcome and tolerates missing stats payload', () => {
    render(<AgentStepStrip block={EXTRACTION_ERROR} />);
    const strip = screen.getByTestId('agent-step-strip');
    expect(strip).toHaveAttribute('data-outcome', 'error');
    expect(strip).toHaveTextContent('Routed to intake_extractor');
    // No stats → no per-key-stat suffix beyond the duration.
    fireEvent.click(screen.getByTestId('agent-step-toggle'));
    const detail = screen.getByTestId('agent-step-detail');
    expect(detail).toHaveTextContent('input_summary');
  });
});
