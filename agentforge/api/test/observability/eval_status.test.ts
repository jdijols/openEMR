/**
 * G2-Final-FB-A-04 — `loadEvalStatus` unit coverage.
 *
 * Pure function with an injected filesystem facade — every branch tested
 * in-process without touching disk. The handler's HTTP wiring (503 vs 200)
 * is a one-line check on top of this; tested implicitly by the sanity
 * suite that exercises `app.ts` end-to-end.
 */
import { describe, expect, it } from 'vitest';
import { loadEvalStatus } from '../../src/observability/eval_status.js';

type FsLike = Parameters<typeof loadEvalStatus>[1];

const SAMPLE_REPORT = {
  run_id: '20260507T073700037Z_fa21ce79',
  duration_ms: 12,
  perf_budget_ms: 5000,
  perf_over_budget: false,
  correlation_ids: [],
  checks: [
    { check: 'schema_valid', case_id: 'a', evaluation_passes: true },
    { check: 'schema_valid', case_id: 'b', evaluation_passes: true },
    { check: 'citation_present', case_id: 'c', evaluation_passes: false, detail: 'foo' },
  ],
  aggregate: {},
  per_category: {
    schema_valid: { category: 'schema_valid', case_count: 10, evaluations_passed: 10, evaluations_failed: 0, pass_rate: 1.0 },
    citation_present: { category: 'citation_present', case_count: 10, evaluations_passed: 9, evaluations_failed: 1, pass_rate: 0.9 },
    factually_consistent: { category: 'factually_consistent', case_count: 12, evaluations_passed: 12, evaluations_failed: 0, pass_rate: 1.0 },
    safe_refusal: { category: 'safe_refusal', case_count: 35, evaluations_passed: 35, evaluations_failed: 0, pass_rate: 1.0 },
    no_phi_in_logs: { category: 'no_phi_in_logs', case_count: 8, evaluations_passed: 8, evaluations_failed: 0, pass_rate: 1.0 },
  },
  baseline_version: 'w2-final-rebalance-2026-05-06',
  gate_breaches: [],
};

function fsWith(reports: Readonly<Record<string, { mtimeMs: number; body: unknown }>>): FsLike {
  return {
    readdirSync: () => Object.keys(reports),
    readFileSync: (p) => {
      const name = p.split('/').pop()!;
      const r = reports[name];
      if (r === undefined) {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return JSON.stringify(r.body);
    },
    statSync: (p) => {
      const name = p.split('/').pop()!;
      const r = reports[name];
      if (r === undefined) {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return { mtimeMs: r.mtimeMs };
    },
  };
}

describe('loadEvalStatus (FB-A-04)', () => {
  it('returns ok with the latest report by run-id timestamp prefix', () => {
    // Filenames carry the run_id timestamp (`eval-YYYYMMDDTHHMMSSmmmZ_<uuid>.json`)
    // — lexical sort = chronological sort. Mtime is intentionally ordered the
    // other way to prove the sort uses the filename, not mtime (mtime ties are
    // real after a fresh `git checkout` of multiple committed reports).
    const fs = fsWith({
      'eval-20260510T193243101Z_88744fe6.json': {
        mtimeMs: 100,
        body: SAMPLE_REPORT,
      },
      'eval-20260430T225137000Z_13cf8189.json': {
        mtimeMs: 200,
        body: { ...SAMPLE_REPORT, run_id: 'OLD_aaaa' },
      },
    });
    const out = loadEvalStatus('/reports', fs);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.run_id).toBe('20260507T073700037Z_fa21ce79');
    expect(out.cases_total).toBe(3);
    expect(out.cases_failed).toBe(1);
    expect(out.baseline_version).toBe('w2-final-rebalance-2026-05-06');
    expect(out.gate_breaches_count).toBe(0);
    expect(out.per_category['schema_valid']).toEqual({ pass_rate: 1.0, case_count: 10 });
    expect(out.per_category['citation_present']).toEqual({ pass_rate: 0.9, case_count: 10 });
    expect(out.ran_at).toBe('2026-05-07T07:37:00.037Z');
  });

  it('returns 503-shaped error when reports dir is missing (ENOENT)', () => {
    const fs: FsLike = {
      readdirSync: () => {
        throw Object.assign(new Error('nope'), { code: 'ENOENT' });
      },
      readFileSync: () => '',
      statSync: () => ({ mtimeMs: 0 }),
    };
    const out = loadEvalStatus('/missing', fs);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toBe('eval_unavailable');
    expect(out.reason).toBe('reports_dir_missing');
  });

  it('returns 503-shaped error when reports dir is empty', () => {
    const fs = fsWith({});
    const out = loadEvalStatus('/empty', fs);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('no_reports_found');
  });

  it('returns 503-shaped error when latest report is unparseable JSON', () => {
    const fs: FsLike = {
      readdirSync: () => ['eval-broken.json'],
      readFileSync: () => '{not-json',
      statSync: () => ({ mtimeMs: 1 }),
    };
    const out = loadEvalStatus('/r', fs);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe('latest_report_unparseable');
  });

  it('counts gate_breaches when present', () => {
    const fs = fsWith({
      'eval-x.json': {
        mtimeMs: 1,
        body: {
          ...SAMPLE_REPORT,
          gate_breaches: [
            { category: 'schema_valid', reason: 'below_absolute_floor', current: 0.8 },
            { category: 'citation_present', reason: 'regression_exceeds_cap', current: 0.85, baseline: 1.0, delta_pp: 0.15 },
          ],
        },
      },
    });
    const out = loadEvalStatus('/r', fs);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.gate_breaches_count).toBe(2);
  });

  it('falls back to mtime-derived ran_at when run_id timestamp is malformed', () => {
    const fs = fsWith({
      'eval-x.json': {
        mtimeMs: Date.parse('2026-04-01T00:00:00Z'),
        body: { ...SAMPLE_REPORT, run_id: 'malformed_xx' },
      },
    });
    const out = loadEvalStatus('/r', fs);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.ran_at).toBe('2026-04-01T00:00:00.000Z');
  });
});
