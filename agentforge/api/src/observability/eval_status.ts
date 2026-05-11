/**
 * G2-Final-FB-A-04 — `GET /agentforge/api/health/eval-status`.
 *
 * Reads the most-recent file from `agentforge/api/eval/reports/` and
 * returns a PHI-safe summary the CUI's `EvalGateBadge` can render.
 *
 * Response shape (success):
 *   {
 *     ok: true,
 *     run_id, ran_at, cases_total, cases_failed, perf_over_budget,
 *     baseline_version, gate_breaches_count,
 *     per_category: { <category>: { pass_rate, case_count } }
 *   }
 *
 * Response shape (no reports yet — directory missing or empty):
 *   { ok: false, error: 'eval_unavailable' }   (HTTP 503)
 *
 * No PHI surfaces here by construction: case_ids are stable identifiers
 * (`w2-citation-present-...`), correlation_ids are eval-scoped, and the
 * per-category aggregate is counts only. The CUI never sees claim text or
 * citation bodies through this endpoint.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type EvalStatusOk = {
  readonly ok: true;
  readonly run_id: string;
  readonly ran_at: string;
  readonly cases_total: number;
  readonly cases_failed: number;
  readonly perf_over_budget: boolean;
  readonly baseline_version: string | null;
  readonly gate_breaches_count: number;
  readonly per_category: Readonly<Record<string, { pass_rate: number; case_count: number }>>;
};

export type EvalStatusUnavailable = {
  readonly ok: false;
  readonly error: 'eval_unavailable';
  readonly reason: string;
};

export type EvalStatus = EvalStatusOk | EvalStatusUnavailable;

type FsLike = {
  readdirSync: (path: string) => readonly string[];
  readFileSync: (path: string, encoding: 'utf8') => string;
  statSync: (path: string) => { mtimeMs: number };
};

const REAL_FS: FsLike = {
  readdirSync: (p) => readdirSync(p) as readonly string[],
  readFileSync: (p, e) => readFileSync(p, e),
  statSync: (p) => statSync(p),
};

/**
 * Pure function — given a reports directory and a filesystem facade,
 * return the eval-status payload. Splitting `loadEvalStatus` from the
 * route handler keeps unit tests filesystem-free.
 */
export function loadEvalStatus(reportsDir: string, fs: FsLike = REAL_FS): EvalStatus {
  let entries: readonly string[];
  try {
    entries = fs.readdirSync(reportsDir);
  } catch (e: unknown) {
    const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
    if (code === 'ENOENT') {
      return { ok: false, error: 'eval_unavailable', reason: 'reports_dir_missing' };
    }
    return {
      ok: false,
      error: 'eval_unavailable',
      reason: 'reports_dir_unreadable',
    };
  }

  const reports = entries.filter((n) => n.startsWith('eval-') && n.endsWith('.json'));
  if (reports.length === 0) {
    return { ok: false, error: 'eval_unavailable', reason: 'no_reports_found' };
  }

  // Sort by the run-id timestamp prefix embedded in the filename (e.g.
  // `eval-20260510T193243101Z_<uuid>.json`) rather than mtime. Mtime ties
  // are real after a fresh `git checkout` / clone — every tracked report
  // gets the checkout instant and the strict-`>` mtime comparison below
  // resolved ties to whichever file `readdirSync` visited first
  // (typically alphabetical → April 30 always won on the VPS post-deploy
  // when older reports were also committed). Sorting by the timestamp
  // in the filename is deterministic across deploys and clones.
  const sorted = [...reports].sort();
  const latestName = sorted[sorted.length - 1];
  if (latestName === undefined) {
    return { ok: false, error: 'eval_unavailable', reason: 'no_reports_found' };
  }
  const latestPath = join(reportsDir, latestName);
  let latestMtime: number;
  try {
    latestMtime = fs.statSync(latestPath).mtimeMs;
  } catch {
    return { ok: false, error: 'eval_unavailable', reason: 'latest_report_unreadable' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  } catch {
    return { ok: false, error: 'eval_unavailable', reason: 'latest_report_unparseable' };
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, error: 'eval_unavailable', reason: 'latest_report_unparseable' };
  }
  const o = parsed as Record<string, unknown>;

  const runId = typeof o['run_id'] === 'string' ? (o['run_id'] as string) : '';
  if (runId === '') {
    return { ok: false, error: 'eval_unavailable', reason: 'latest_report_missing_run_id' };
  }
  const checks = Array.isArray(o['checks']) ? (o['checks'] as ReadonlyArray<unknown>) : [];
  const casesTotal = checks.length;
  const casesFailed = checks.filter(
    (c) => typeof c === 'object' && c !== null && (c as { evaluation_passes?: unknown }).evaluation_passes !== true,
  ).length;
  const perfOverBudget = o['perf_over_budget'] === true;
  const baselineVersion = typeof o['baseline_version'] === 'string' ? (o['baseline_version'] as string) : null;
  const gateBreachesArr = Array.isArray(o['gate_breaches']) ? (o['gate_breaches'] as readonly unknown[]) : [];

  const perCategoryRaw = (o['per_category'] ?? {}) as Record<string, unknown>;
  const perCategory: Record<string, { pass_rate: number; case_count: number }> = {};
  for (const [cat, val] of Object.entries(perCategoryRaw)) {
    if (val === null || typeof val !== 'object') {
      continue;
    }
    const v = val as Record<string, unknown>;
    const passRate = typeof v['pass_rate'] === 'number' ? (v['pass_rate'] as number) : 0;
    const caseCount = typeof v['case_count'] === 'number' ? (v['case_count'] as number) : 0;
    perCategory[cat] = { pass_rate: passRate, case_count: caseCount };
  }

  // Derive `ran_at` from the run_id timestamp prefix when available
  // (`20260507T073700037Z_<uuid>`); fall back to file mtime ISO otherwise.
  const tsPrefix = runId.split('_')[0] ?? '';
  const ranAtIso = parseRunIdTimestamp(tsPrefix) ?? new Date(latestMtime).toISOString();

  return {
    ok: true,
    run_id: runId,
    ran_at: ranAtIso,
    cases_total: casesTotal,
    cases_failed: casesFailed,
    perf_over_budget: perfOverBudget,
    baseline_version: baselineVersion,
    gate_breaches_count: gateBreachesArr.length,
    per_category: perCategory,
  };
}

function parseRunIdTimestamp(prefix: string): string | null {
  // The runner formats run ids like `20260507T073700037Z` (no separators).
  // Reconstruct an ISO 8601 string so the CUI can render a human time.
  if (!/^\d{8}T\d{9}Z$/u.test(prefix)) {
    return null;
  }
  const y = prefix.slice(0, 4);
  const mo = prefix.slice(4, 6);
  const d = prefix.slice(6, 8);
  const h = prefix.slice(9, 11);
  const mi = prefix.slice(11, 13);
  const s = prefix.slice(13, 15);
  const ms = prefix.slice(15, 18);
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
  if (Number.isNaN(Date.parse(iso))) {
    return null;
  }
  return iso;
}
