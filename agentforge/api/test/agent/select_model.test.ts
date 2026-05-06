/**
 * §7 / G2-Early-11 — per-worker model selection coverage.
 */

import { describe, it, expect } from 'vitest';
import { selectModel, UnknownWorkerError } from '../../src/agent/select_model.js';

describe('§7 G2-Early-11 — selectModel(workerName)', () => {
  it('returns Haiku 4.5 for supervisor', () => {
    expect(selectModel('supervisor')).toBe('claude-haiku-4-5');
  });

  it('returns Haiku 4.5 for intake_extractor', () => {
    expect(selectModel('intake_extractor')).toBe('claude-haiku-4-5');
  });

  it('returns null for evidence_retriever (no LLM in worker)', () => {
    expect(selectModel('evidence_retriever')).toBeNull();
  });

  it('returns null for critic (placeholder, future Sonnet target)', () => {
    expect(selectModel('critic')).toBeNull();
  });

  it('throws UnknownWorkerError for unknown worker name (no silent fallback)', () => {
    expect(() => selectModel('not_a_worker')).toThrow(UnknownWorkerError);
    try {
      selectModel('janitor');
    } catch (e) {
      expect(e).toBeInstanceOf(UnknownWorkerError);
      expect((e as UnknownWorkerError).worker).toBe('janitor');
    }
  });
});
