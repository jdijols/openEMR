/**
 * Red Team Agent — eval suite runner.
 *
 * Reads seed cases from ../evals/seeds, hits the live target via target_client,
 * applies the deterministic Judge, optionally mutates each seed (--mutate flag),
 * and writes a run summary to ../evals/results/run-<iso>.json.
 *
 * Env:
 *   TARGET_BASE_URL        e.g. https://108-61-145-220.nip.io or http://localhost:8080
 *   TARGET_SESSION_SECRET  HMAC secret matching the target's SESSION_TOKEN_SECRET
 *   TARGET_PATIENT_UUID    Active patient UUID in the target's DB
 *   TARGET_USER_ID         OpenEMR user_id for the minted token (default: 1)
 *   ANTHROPIC_API_KEY      Required only with --mutate
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { EvalCaseSchema, RunSummarySchema, SCHEMA_VERSION, type EvalCase, type EvalResult } from './eval_schema.ts';
import { sendChat, type TargetConfig } from './target_client.ts';
import { judge } from './judge.ts';
import { mutateSeed } from './red_team_agent.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = resolve(__dirname, '../../evals/seeds');
const RESULTS_DIR = resolve(__dirname, '../../evals/results');

function readEnv(): TargetConfig {
  const baseUrl = process.env.TARGET_BASE_URL;
  const sessionSecret = process.env.TARGET_SESSION_SECRET;
  const patientUuid = process.env.TARGET_PATIENT_UUID;
  const userId = Number(process.env.TARGET_USER_ID ?? '1');
  if (!baseUrl || !sessionSecret || !patientUuid) {
    console.error('Missing required env: TARGET_BASE_URL, TARGET_SESSION_SECRET, TARGET_PATIENT_UUID');
    process.exit(2);
  }
  if (!Number.isFinite(userId) || userId <= 0) {
    console.error('TARGET_USER_ID must be a positive integer');
    process.exit(2);
  }
  return { baseUrl, sessionSecret, patientUuid, userId };
}

async function loadSeeds(): Promise<EvalCase[]> {
  const files = (await readdir(SEEDS_DIR)).filter((f) => f.endsWith('.json'));
  const seeds: EvalCase[] = [];
  for (const f of files) {
    const raw = await readFile(join(SEEDS_DIR, f), 'utf8');
    const parsed = EvalCaseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error(`Skipping invalid seed ${f}: ${parsed.error.message}`);
      continue;
    }
    seeds.push(parsed.data);
  }
  seeds.sort((a, b) => a.id.localeCompare(b.id));
  return seeds;
}

async function runOne(
  cfg: TargetConfig,
  seedCase: EvalCase,
  promptOverride: string | null,
  lineage: string[],
): Promise<EvalResult> {
  const prompt = promptOverride ?? seedCase.attack.message;
  let response;
  try {
    response = await sendChat(cfg, prompt);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      schema_version: SCHEMA_VERSION,
      case_id: seedCase.id,
      run_id: randomUUID(),
      timestamp: new Date().toISOString(),
      target_url: cfg.baseUrl,
      prompt_sent: prompt,
      response_received: '',
      correlation_id: null,
      verdict: 'error',
      judge_notes: `transport_error: ${msg}`,
      severity_observed: null,
      latency_ms: 0,
      estimated_cost_usd: null,
      mutation_lineage: lineage,
      error: msg,
    };
  }
  const haystack = `${response.finalText}\n${response.routingEvents.join('\n')}\n${response.rawSse}`;
  const j = response.errorKind
    ? { verdict: 'error' as const, notes: `target_error: ${response.errorKind}` }
    : judge(seedCase, haystack);
  return {
    schema_version: SCHEMA_VERSION,
    case_id: seedCase.id,
    run_id: randomUUID(),
    timestamp: new Date().toISOString(),
    target_url: cfg.baseUrl,
    prompt_sent: prompt,
    response_received: response.finalText || response.rawSse,
    correlation_id: response.correlationId,
    verdict: j.verdict,
    judge_notes: j.notes,
    severity_observed: j.verdict === 'fail' ? seedCase.severity : null,
    latency_ms: response.latencyMs,
    estimated_cost_usd: null,
    mutation_lineage: lineage,
    error: response.errorKind,
  };
}

function fmtVerdict(v: EvalResult['verdict']): string {
  const tag = { pass: '✓ PASS', fail: '✗ FAIL', partial: '~ PARTIAL', error: '! ERROR' }[v];
  return tag;
}

async function main(): Promise<void> {
  const mutate = process.argv.includes('--mutate');
  const mutationCount = Number(process.env.MUTATION_COUNT ?? '3');
  const cfg = readEnv();
  const seeds = await loadSeeds();

  console.log(`Red Team Agent run — target ${cfg.baseUrl}`);
  console.log(`Loaded ${seeds.length} seed case(s).`);
  if (mutate) console.log(`Mutation enabled (${mutationCount} variants per seed).`);

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const results: EvalResult[] = [];

  for (const seed of seeds) {
    console.log(`\n— ${seed.id} [${seed.priority} ${seed.severity}]`);
    const r0 = await runOne(cfg, seed, null, []);
    results.push(r0);
    console.log(`  seed:    ${fmtVerdict(r0.verdict)}  ${r0.latency_ms}ms  ${r0.judge_notes}`);

    if (mutate) {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      const variants = await mutateSeed(apiKey, seed, mutationCount);
      for (let i = 0; i < variants.length; i++) {
        const v = variants[i]!;
        const r = await runOne(cfg, seed, v, [seed.id, `mut-${i + 1}`]);
        results.push(r);
        console.log(`  mut-${i + 1}: ${fmtVerdict(r.verdict)}  ${r.latency_ms}ms  ${r.judge_notes}`);
      }
    }
  }

  const finishedAt = new Date().toISOString();

  const byVerdict: Record<string, number> = { pass: 0, fail: 0, partial: 0, error: 0 };
  const byPriority: Record<string, number> = { P0: 0, P1: 0, P2: 0 };
  for (const r of results) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
  }
  for (const s of seeds) {
    byPriority[s.priority] = (byPriority[s.priority] ?? 0) + 1;
  }

  const summary = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    target_url: cfg.baseUrl,
    total_cases: results.length,
    by_verdict: byVerdict,
    by_priority: byPriority,
    results,
  };
  const parsed = RunSummarySchema.safeParse(summary);
  if (!parsed.success) {
    console.error(`Run summary failed schema validation: ${parsed.error.message}`);
    process.exit(1);
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const outPath = join(RESULTS_DIR, `run-${startedAt.replace(/[:.]/g, '-')}.json`);
  await writeFile(outPath, JSON.stringify(parsed.data, null, 2));

  console.log(`\nRun complete: ${results.length} cases`);
  console.log(`  by verdict: ${JSON.stringify(byVerdict)}`);
  console.log(`  written:    ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
