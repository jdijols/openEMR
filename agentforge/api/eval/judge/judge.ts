/**
 * Minimal LLM-judge module for the AgentForge eval suite.
 *
 * Supplements the deterministic checks in `eval/runner.ts` with a single
 * judge-scored evaluation per selected case (factually_consistent + safe_refusal
 * categories). The deterministic eval is the gate — this module only adds a
 * numeric judge score that graders can read alongside the rule outcome.
 *
 * Design contract (intentionally narrow):
 *   - One Anthropic call per case (`messages.create`, JSON-only response).
 *   - Reads `ANTHROPIC_API_KEY`, falling back to `LLM_API_KEY` (existing project
 *     env name) so the same dotenv file works for both the agent and the
 *     judge.
 *   - On API error or unparseable JSON it THROWS — the runner catches and
 *     records the failure rather than emitting a fabricated score.
 *   - Prompt + model config live in sibling files (`prompt.md`, `model.json`)
 *     so the prompt version is committed and reviewable.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

type ModelConfig = Readonly<{
  model: string;
  temperature: number;
  max_tokens: number;
  prompt_version: string;
}>;

export type JudgeInput = Readonly<{
  case_id: string;
  rule: string;
  context: unknown;
  expected: string;
}>;

export type JudgeResult = Readonly<{
  score: number;
  pass: boolean;
  rationale: string;
  model: string;
  prompt_version: string;
  latency_ms: number;
  tokens?: { input: number; output: number };
}>;

let cachedConfig: ModelConfig | null = null;
let cachedPrompt: string | null = null;

function loadConfig(): ModelConfig {
  if (cachedConfig !== null) return cachedConfig;
  const raw = readFileSync(join(here, 'model.json'), 'utf8');
  const parsed = JSON.parse(raw) as Partial<ModelConfig>;
  if (
    typeof parsed.model !== 'string' ||
    typeof parsed.temperature !== 'number' ||
    typeof parsed.max_tokens !== 'number' ||
    typeof parsed.prompt_version !== 'string'
  ) {
    throw new Error('judge_model_config_invalid: model.json missing required fields');
  }
  cachedConfig = {
    model: parsed.model,
    temperature: parsed.temperature,
    max_tokens: parsed.max_tokens,
    prompt_version: parsed.prompt_version,
  };
  return cachedConfig;
}

function loadPrompt(): string {
  if (cachedPrompt !== null) return cachedPrompt;
  cachedPrompt = readFileSync(join(here, 'prompt.md'), 'utf8');
  return cachedPrompt;
}

function getApiKey(): string {
  // Prefer ANTHROPIC_API_KEY if non-empty, else fall back to LLM_API_KEY (the
  // existing project env name). The harness can set ANTHROPIC_API_KEY="" which
  // would short-circuit a `??` chain — hence the explicit truthy check.
  const fromAnthropic = process.env['ANTHROPIC_API_KEY'];
  const fromLlm = process.env['LLM_API_KEY'];
  const key =
    typeof fromAnthropic === 'string' && fromAnthropic !== ''
      ? fromAnthropic
      : typeof fromLlm === 'string' && fromLlm !== ''
        ? fromLlm
        : '';
  if (key === '') {
    throw new Error(
      'judge_api_key_missing: set ANTHROPIC_API_KEY (or LLM_API_KEY) before running the judge',
    );
  }
  return key;
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (cachedClient !== null) return cachedClient;
  cachedClient = new Anthropic({ apiKey: getApiKey() });
  return cachedClient;
}

/**
 * Test seam: lets `judge.test.ts` swap in a mocked SDK without monkey-patching
 * the module export. Returns `() => void` to restore the previous client.
 */
export function _setClientForTesting(client: Anthropic | null): () => void {
  const prev = cachedClient;
  cachedClient = client;
  return () => {
    cachedClient = prev;
  };
}

function buildUserMessage(input: JudgeInput): string {
  return [
    `case_id: ${input.case_id}`,
    `rule:    ${input.rule}`,
    `expected: ${input.expected}`,
    'context:',
    JSON.stringify(input.context, null, 2),
  ].join('\n');
}

/**
 * Extracts the first text block from an Anthropic Messages response.
 * SDK 0.93 returns `content` as an array of typed blocks; only `text` blocks
 * carry rendered prose. We deliberately concatenate every text block (the
 * model may emit several short ones with the JSON spread across them, though
 * with `temperature: 0` and our prompt they fit in one).
 */
function collectText(response: Anthropic.Messages.Message): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * The prompt asks for raw JSON, but cheap tolerance is worth it: strip
 * leading/trailing whitespace, optional ``` fences, and any "Here is the
 * JSON:" preamble before the first `{`. Then JSON.parse must succeed —
 * otherwise we throw so the runner records the failure honestly.
 */
function extractJsonBody(text: string): unknown {
  const trimmed = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences if present.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
  const candidate = fenced !== null ? (fenced[1] ?? '').trim() : trimmed;
  // If there's preamble before the first `{`, slice from the first brace.
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('judge_response_unparseable: no JSON object found in model response');
  }
  const slice = candidate.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(slice);
  } catch (e) {
    throw new Error(
      `judge_response_unparseable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function validateAndCoerceJudgeBody(parsed: unknown): { score: number; pass: boolean; rationale: string } {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('judge_response_invalid: expected JSON object');
  }
  const obj = parsed as Record<string, unknown>;
  const rawScore = obj['score'];
  const rawRationale = obj['rationale'];
  if (typeof rawScore !== 'number' || Number.isNaN(rawScore)) {
    throw new Error('judge_response_invalid: missing numeric `score`');
  }
  if (typeof rawRationale !== 'string') {
    throw new Error('judge_response_invalid: missing string `rationale`');
  }
  // Clamp into [0, 1] — the prompt asks for that range but we don't trust the
  // model to never overshoot. A clamped value is recoverable; throwing on a
  // 1.05 here would make the whole run brittle for no benefit.
  const score = Math.max(0, Math.min(1, rawScore));
  // Honor the model's `pass` if it supplied one, but enforce the 0.7 threshold
  // when it did not — the rubric is ours, not the judge's.
  const rawPass = obj['pass'];
  const pass = typeof rawPass === 'boolean' ? rawPass : score >= 0.7;
  return { score, pass, rationale: rawRationale };
}

export async function judgeCase(input: JudgeInput): Promise<JudgeResult> {
  const config = loadConfig();
  const systemPrompt = loadPrompt();
  const userMessage = buildUserMessage(input);

  const client = getClient();
  const startedAt = Date.now();

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.max_tokens,
    temperature: config.temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const latency_ms = Date.now() - startedAt;
  const text = collectText(response);
  const parsed = extractJsonBody(text);
  const body = validateAndCoerceJudgeBody(parsed);

  const usage = (response as unknown as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  const tokensInput = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined;
  const tokensOutput = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined;

  const out: JudgeResult = {
    score: body.score,
    pass: body.pass,
    rationale: body.rationale,
    model: config.model,
    prompt_version: config.prompt_version,
    latency_ms,
    ...(tokensInput !== undefined && tokensOutput !== undefined
      ? { tokens: { input: tokensInput, output: tokensOutput } }
      : {}),
  };
  return out;
}
