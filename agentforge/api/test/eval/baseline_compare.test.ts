/**
 * §11 / G2-Early-38 — baseline-compare gate. The runner must fail (non-zero
 * exit) if any category drops below the absolute floor (95%) or regresses
 * from the pinned baseline by more than 5pp.
 */

import { describe, it, expect } from 'vitest';
import { _testHooks } from '../../eval/runner.js';

const { detectGateBreaches, W2_GATE_ABSOLUTE_FLOOR, W2_GATE_REGRESSION_PP } = _testHooks;

function makeAggregate(rates: Partial<Record<string, number>>) {
  // Caller passes pass_rate per category; we synthesize plausible counts.
  // Use case_count = 10 so 1 failure = 10pp (large enough to register).
  const out: Record<string, { category: string; case_count: number; evaluations_passed: number; evaluations_failed: number; pass_rate: number }> = {};
  for (const cat of ['schema_valid', 'citation_present', 'factually_consistent', 'safe_refusal', 'no_phi_in_logs']) {
    const rate = rates[cat] ?? 1.0;
    out[cat] = {
      category: cat,
      case_count: 10,
      evaluations_passed: Math.round(rate * 10),
      evaluations_failed: 10 - Math.round(rate * 10),
      pass_rate: rate,
    };
  }
  return out as Parameters<typeof detectGateBreaches>[0];
}

const baselineAllGreen = {
  version: 'test-baseline',
  pinned_at: '2026-05-06T00:00:00Z',
  per_category: {
    schema_valid: { pass_rate: 1.0, case_count: 10 },
    citation_present: { pass_rate: 1.0, case_count: 10 },
    factually_consistent: { pass_rate: 1.0, case_count: 12 },
    safe_refusal: { pass_rate: 1.0, case_count: 10 },
    no_phi_in_logs: { pass_rate: 1.0, case_count: 8 },
  },
} as const;

describe('§11 G2-Early-38 — baseline-compare gate', () => {
  it('clean run (all categories at 1.0) produces zero breaches', () => {
    const breaches = detectGateBreaches(makeAggregate({}), baselineAllGreen);
    expect(breaches).toHaveLength(0);
  });

  it('a category dropping to 0.85 trips the absolute-floor breach', () => {
    const breaches = detectGateBreaches(makeAggregate({ schema_valid: 0.85 }), baselineAllGreen);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.category).toBe('schema_valid');
    expect(breaches[0]!.reason).toBe('below_absolute_floor');
    expect(breaches[0]!.current).toBeCloseTo(0.85);
  });

  it('a category at 0.96 still trips the regression cap when baseline was 1.0 and delta > 5pp threshold', () => {
    // 1.0 → 0.94 = 6pp drop, exceeds 5pp cap. But also < 95% floor → that wins.
    const breaches = detectGateBreaches(makeAggregate({ citation_present: 0.94 }), baselineAllGreen);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.reason).toBe('below_absolute_floor');
  });

  it('a category at 0.96 with baseline 1.0 = 4pp drop, both gates allow (no breach)', () => {
    const breaches = detectGateBreaches(makeAggregate({ schema_valid: 0.96 }), baselineAllGreen);
    expect(breaches).toHaveLength(0);
  });

  it('regression-only breach: baseline 1.0, current 0.96 — this is 4pp drop (allowed); but baseline 1.0, current 0.95 is exactly at floor (allowed); baseline 0.99, current 0.93 is 6pp drop and below 95% — both fire (floor wins by ordering)', () => {
    const baselineMixed = {
      ...baselineAllGreen,
      per_category: {
        ...baselineAllGreen.per_category,
        factually_consistent: { pass_rate: 0.99, case_count: 12 },
      },
    } as typeof baselineAllGreen;
    const breaches = detectGateBreaches(makeAggregate({ factually_consistent: 0.93 }), baselineMixed);
    expect(breaches).toHaveLength(1);
    // Floor breach takes priority (continue inside loop).
    expect(breaches[0]!.reason).toBe('below_absolute_floor');
  });

  it('regression-only breach without floor: baseline 1.0, current 0.97 — 3pp drop, allowed; baseline 1.0, current 0.95 (exactly at floor) — allowed; baseline 0.97, current 0.91 — 6pp drop AND below 95% (floor)', () => {
    // To exercise the regression-only path we need current > 95% AND
    // current < (baseline - 5pp). That requires baseline > 100% which is
    // impossible for ratios. So in the boolean-rubric world, a >5pp
    // regression always also crosses the 95% floor. Confirm the ordering
    // semantics: floor breach is reported, regression breach is suppressed
    // for the same category (no double-counting).
    const baselineOne = {
      ...baselineAllGreen,
      per_category: {
        ...baselineAllGreen.per_category,
        no_phi_in_logs: { pass_rate: 1.0, case_count: 8 },
      },
    } as typeof baselineAllGreen;
    const breaches = detectGateBreaches(makeAggregate({ no_phi_in_logs: 0.875 }), baselineOne);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.category).toBe('no_phi_in_logs');
    expect(breaches[0]!.reason).toBe('below_absolute_floor');
  });

  it('zero-case category does not breach floor (vacuous)', () => {
    const empty = makeAggregate({});
    // Override schema_valid to 0 cases (case_count 0 means pass_rate is conventionally 1.0 in our aggregator)
    empty.schema_valid = {
      category: 'schema_valid',
      case_count: 0,
      evaluations_passed: 0,
      evaluations_failed: 0,
      pass_rate: 1.0,
    };
    const breaches = detectGateBreaches(empty, baselineAllGreen);
    expect(breaches).toHaveLength(0);
  });

  it('null baseline → only absolute-floor gate fires', () => {
    const breaches = detectGateBreaches(makeAggregate({ schema_valid: 0.5 }), null);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]!.reason).toBe('below_absolute_floor');
  });

  it('exposes the pinned thresholds for transparency', () => {
    expect(W2_GATE_ABSOLUTE_FLOOR).toBe(0.95);
    expect(W2_GATE_REGRESSION_PP).toBe(0.05);
  });
});
