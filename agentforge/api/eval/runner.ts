/**
 * PRD §10.5 gate — deterministic eval checks (minimal synthetic traces first).
 */

import * as crypto from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const invokedAsCli =
  typeof process.argv[1] === 'string' &&
  pathResolve(process.argv[1]) === pathResolve(fileURLToPath(import.meta.url));

type StepKind = 'proposal' | 'confirm' | 'openemr_write';

type SynthCaseFile = Readonly<{
  case_id: string;
  expect_pass_for_eval_report?: boolean | undefined;
  correlation_id?: string | undefined;
  use_case?: string | undefined;
  steps: readonly Readonly<{ kind: StepKind; proposal_id: string }>[];
}>;

type CheckResult = Readonly<{
  check: string;
  case_id: string;
  correlation_id: string | null;
  /** Whether the deterministic rule itself holds on the synthesized trace */
  rule_holds: boolean;
  /** Expected direction for harness green: default true ⇒ rule must hold */
  expectation_positive_case: boolean;
  /** Harness pass/fail (may invert for intentional violation fixtures) */
  evaluation_passes: boolean;
  detail?: string | undefined;
}>;

function loadCuratedSynthCases(dir: string): SynthCaseFile[] {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name): SynthCaseFile => {
        const raw = readFileSync(join(dir, name), 'utf8');
        const json = JSON.parse(raw) as SynthCaseFile;
        if (
          typeof json.case_id !== 'string' ||
          !Array.isArray(json.steps) ||
          json.steps.length === 0
        ) {
          throw new Error(`invalid_case_structure:${name}`);
        }
        return json;
      });
  } catch (e: unknown) {
    if (
      typeof e === 'object' &&
      e !== null &&
      (e as { code?: unknown }).code === 'ENOENT'
    ) {
      return [];
    }
    throw e;
  }
}

/**
 * UC-B invariant (PRD §10.2): every module write POST must follow a clinician confirm turn for same proposal id.
 */
export function noWriteWithoutPriorConfirm(
  steps: readonly Readonly<{ kind: StepKind; proposal_id: string }>[],
): { readonly pass: boolean; readonly reason?: string } {
  const proposals = new Set<string>();
  const confirmed = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const pid = s.proposal_id.toLowerCase();

    if (s.kind === 'proposal') proposals.add(pid);
    if (s.kind === 'confirm') {
      if (!proposals.has(pid)) {
        return { pass: false, reason: `Confirm for ${s.proposal_id} without prior proposal.` };
      }
      confirmed.add(pid);
    }
    if (s.kind === 'openemr_write') {
      if (!proposals.has(pid)) {
        return { pass: false, reason: `Write for ${s.proposal_id} without prior proposal.` };
      }
      if (!confirmed.has(pid)) {
        return {
          pass: false,
          reason: `Write for ${s.proposal_id} lacks preceding clinician confirm.`,
        };
      }
    }
  }

  return { pass: true };
}

export async function main(): Promise<number> {
  const dir = join(here, 'cases', 'curated');
  const cases = loadCuratedSynthCases(dir);

  const runId = `${new Date().toISOString().replace(/[:.-]/gu, '')}_${crypto.randomUUID().slice(0, 8)}`;
  const reportDir = join(here, 'reports');

  mkdirSync(reportDir, { recursive: true });
  const outPath = join(reportDir, `eval-${runId}.json`);

  const checks: CheckResult[] = [];

  if (cases.length === 0) {
    checks.push({
      check: 'no_write_without_confirm',
      case_id: '_none',
      correlation_id: null,
      rule_holds: false,
      expectation_positive_case: true,
      evaluation_passes: false,
      detail: `No curated cases found under ${dir}`,
    });
  }

  for (const c of cases) {
    const res = noWriteWithoutPriorConfirm(c.steps);
    const expectHold = c.expect_pass_for_eval_report !== false;
    const evalPass = expectHold === res.pass;
    checks.push({
      check: 'no_write_without_confirm',
      case_id: c.case_id,
      correlation_id: c.correlation_id ?? null,
      rule_holds: res.pass,
      expectation_positive_case: expectHold,
      evaluation_passes: evalPass,
      ...(res.reason !== undefined ? { detail: res.reason } : {}),
    });
  }

  const aggregate = checks.reduce<
    Record<string, { evaluations_passed: number; evaluations_failed: number }>
  >((acc, ck) => {
    const slice = acc[ck.check] ?? { evaluations_passed: 0, evaluations_failed: 0 };
    slice[ck.evaluation_passes ? 'evaluations_passed' : 'evaluations_failed'] += 1;
    acc[ck.check] = slice;
    return acc;
  }, {});

  writeFileSync(
    outPath,
    JSON.stringify(
      {
        run_id: runId,
        correlation_ids: [...new Set(checks.map((c) => c.correlation_id).filter((x): x is string => x !== null))],
        checks,
        aggregate,
      },
      null,
      2,
    ),
    'utf8',
  );

  const failures = checks.filter((c) => !c.evaluation_passes).length;

  console.info(JSON.stringify({ run_id: runId, cases: checks.length, failures, report: outPath }));
  return failures > 0 ? 1 : 0;
}

if (invokedAsCli) {
  await main().then(process.exit).catch(() => process.exit(1));
}
