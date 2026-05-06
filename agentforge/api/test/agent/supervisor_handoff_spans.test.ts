/**
 * §7 / G2-Early-10 — supervisor handoff event coverage.
 *
 * Asserts that each W2 worker tool emits a `handoff.<worker>` event BEFORE
 * its tool span, with a §7-compliant metadata shape: `{ from: 'supervisor',
 * to, reason: <one-sentence>, input_summary: <PHI-safe>, decided_at: <ISO> }`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  HANDOFF_REASONS,
  recordSupervisorHandoff,
  summarizeEvidenceRetrieverHandoff,
  summarizeIntakeExtractorHandoff,
} from '../../src/agent/handoff.js';
import type { Observability } from '../../src/observability/index.js';

function makeObservabilityCapture(): {
  obs: Observability;
  events: Array<{ name: string; meta?: Record<string, unknown> }>;
} {
  const events: Array<{ name: string; meta?: Record<string, unknown> }> = [];
  const obs: Observability = {
    traceTurn: async () => ({ id: 'corr-test', correlationId: 'corr-test' }),
    recordToolCall: vi.fn(async () => ({ end: vi.fn(async () => {}) })),
    recordEvent: vi.fn(async ({ name, meta }) => {
      events.push({ name, ...(meta !== undefined ? { meta } : {}) });
    }),
    recordLlmCall: vi.fn(async () => {}),
    shutdown: vi.fn(async () => {}),
  };
  return { obs, events };
}

describe('§7 G2-Early-10 — supervisor handoff event shape', () => {
  it('emits handoff.intake_extractor with §7 metadata shape and PHI-safe input_summary', async () => {
    const { obs, events } = makeObservabilityCapture();
    const summary = summarizeIntakeExtractorHandoff({
      docrefUuid: 'f8a2c1b9-1234-5678-9abc-def012345678',
      docType: 'intake_form',
    });
    await recordSupervisorHandoff(obs, 'corr-test', 'intake_extractor', summary);

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.name).toBe('handoff.intake_extractor');
    const meta = ev.meta as Record<string, unknown>;
    expect(meta['from']).toBe('supervisor');
    expect(meta['to']).toBe('intake_extractor');
    expect(typeof meta['reason']).toBe('string');
    expect((meta['reason'] as string).length).toBeGreaterThan(0);
    expect(typeof meta['decided_at']).toBe('string');
    expect((meta['decided_at'] as string)).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const inputSummary = meta['input_summary'] as Record<string, unknown>;
    expect(inputSummary['doc_type']).toBe('intake_form');
    expect(inputSummary['docref_uuid_prefix']).toBe('f8a2c1b9');
    // PHI-safe: input_summary must NOT carry the full uuid, patient_uuid, or any free-text.
    const summaryString = JSON.stringify(inputSummary);
    expect(summaryString).not.toContain('def012345678'); // tail of full uuid absent
  });

  it('emits handoff.evidence_retriever with §7 metadata shape and PHI-safe input_summary', async () => {
    const { obs, events } = makeObservabilityCapture();
    const query = 'Given LDL 158 and T2DM, should we intensify her statin?';
    const summary = summarizeEvidenceRetrieverHandoff({ query, maxChunks: 5 });
    await recordSupervisorHandoff(obs, 'corr-test', 'evidence_retriever', summary);

    expect(events).toHaveLength(1);
    const ev = events[0]!;
    expect(ev.name).toBe('handoff.evidence_retriever');
    const meta = ev.meta as Record<string, unknown>;
    expect(meta['from']).toBe('supervisor');
    expect(meta['to']).toBe('evidence_retriever');
    expect(typeof meta['reason']).toBe('string');
    expect((meta['reason'] as string).length).toBeGreaterThan(0);

    const inputSummary = meta['input_summary'] as Record<string, unknown>;
    expect(inputSummary['query_chars']).toBe(query.length);
    expect(inputSummary['max_chunks']).toBe(5);
    // PHI-safe: input_summary must NOT carry the literal query body.
    const summaryString = JSON.stringify(inputSummary);
    expect(summaryString).not.toContain('LDL');
    expect(summaryString).not.toContain('statin');
    expect(summaryString).not.toContain('T2DM');
  });

  it('uses HANDOFF_REASONS as default when no override is provided', async () => {
    const { obs, events } = makeObservabilityCapture();
    await recordSupervisorHandoff(obs, 'corr-test', 'intake_extractor', { doc_type: 'lab_pdf' });
    const meta = events[0]!.meta as Record<string, unknown>;
    expect(meta['reason']).toBe(HANDOFF_REASONS.intake_extractor);
  });
});
