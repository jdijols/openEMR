import { generateText, stepCountIs } from 'ai';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { Observability } from '../observability/index.js';
import { appendTurn, insertConversationRow } from '../conversations/store.js';
import { verifySessionToken } from '../handshake/sessionToken.js';
import { chatBlockSchema, type ChatBlock } from '../openemr/types.js';
import { createChartContextReadTools } from '../tools/chart_context_reads.js';
import { createGetAllergiesTool } from '../tools/get_allergies.js';
import { createGetIdentityTool } from '../tools/get_identity.js';
import { createProposeWriteTools } from '../tools/propose_writes.js';
import { estimateUsdForProviderTokens } from './cost_estimate.js';
import { CLINICAL_SYSTEM_PROMPT } from './system_prompt.js';
import { getChatModel } from './model.js';
import { buildCitationNavigationIndex, buildClinicalToolEvidence, type CitationNavigationHint } from './toolEvidence.js';
import { verifyClinicalBlocks } from './verification.js';
import { type AiToolResultLike, isToolResultLike } from './tool_results.js';

const blocksEnvelopeSchema = z.object({
  blocks: z.array(chatBlockSchema),
});

const INTERNAL_DISCLOSURE_PATTERNS = [
  /\b(show|print|reveal|display|list|tell|give|dump|return)\b[\s\S]{0,80}\b(system prompt|developer (?:message|instructions?)|hidden (?:message|instructions?|prompt)|internal (?:prompt|instructions?|context)|initial instructions?)\b/iu,
  /\b(show|print|reveal|display|list|tell|give|dump|return)\b[\s\S]{0,80}\b(tool calls?|tool outputs?|tool results?|tool schemas?|tool names?|function calls?|raw tool|trace|traces|logs?)\b/iu,
  /\bwhat (?:tools?|functions?) (?:did|do|can) you (?:call|use|have|access)\b/iu,
  /\bhow (?:are|were) you (?:configured|prompted|instructed)\b/iu,
  /\bignore (?:previous|prior|all) instructions?\b[\s\S]{0,120}\b(system prompt|tool calls?|hidden|developer)\b/iu,
  /\bchain[-\s]?of[-\s]?thought\b/iu,
];

export function isInternalDisclosureRequest(message: string): boolean {
  const normalized = message.trim();
  return INTERNAL_DISCLOSURE_PATTERNS.some((p) => p.test(normalized));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function normalizeSegmentRecord(item: Record<string, unknown>): Record<string, unknown> {
  const s: Record<string, unknown> = { ...item };
  const st = s['type'];
  if (typeof st === 'string') {
    s['type'] = st.toLowerCase();
  }

  if (s['type'] === 'cite' && s['citation_id'] === undefined) {
    if (typeof s['citationId'] === 'string') {
      s['citation_id'] = s['citationId'];
    } else if (typeof s['citation_uuid'] === 'string') {
      s['citation_id'] = s['citation_uuid'];
    } else if (typeof s['uuid'] === 'string') {
      s['citation_id'] = s['uuid'];
    } else if (typeof s['id'] === 'string') {
      s['citation_id'] = s['id'];
    }
  }
  if (s['type'] === 'cite' && typeof s['citation_id'] === 'string') {
    delete s['citationId'];
    delete s['citation_uuid'];
  }

  for (const key of ['content', 'message', 'body'] as const) {
    if (
      (s['type'] === 'text' || s['type'] === 'cite') &&
      typeof s[key] === 'string' &&
      s['text'] === undefined
    ) {
      s['text'] = s[key];
      delete s[key];
    }
  }

  return s;
}

function normalizeBlockRecord(item: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...item };
  const t = next['type'];
  if (typeof t === 'string') {
    next['type'] = t.toLowerCase();
  }

  const blockType = next['type'];
  for (const key of ['content', 'message', 'body'] as const) {
    if (
      (blockType === 'text' || blockType === 'claim') &&
      typeof next[key] === 'string' &&
      next['text'] === undefined
    ) {
      next['text'] = next[key];
      delete next[key];
      continue;
    }

    if (
      blockType === 'proposal' &&
      typeof next[key] === 'string' &&
      next['preview'] === undefined &&
      typeof next['proposal_id'] === 'string' &&
      typeof next['write_target'] === 'string'
    ) {
      next['preview'] = next[key];
      delete next[key];
      continue;
    }
  }

  if (blockType === 'claim') {
    if (typeof next['citation_ids'] === 'string') {
      next['citation_ids'] = [next['citation_ids']];
    }
    if (typeof next['citation_id'] === 'string' && next['citation_ids'] === undefined) {
      next['citation_ids'] = [next['citation_id']];
      delete next['citation_id'];
    }

    if (Array.isArray(next['segments']) && next['segments'].length > 0) {
      next['segments'] = (next['segments'] as unknown[]).map((seg) =>
        isPlainObject(seg) ? normalizeSegmentRecord(seg) : seg,
      );
      delete next['text'];
      delete next['citation_ids'];
    }
  }

  return next;
}

/**
 * LLMs often emit `content` instead of `text` for block bodies. Normalize before Zod so we don't
 * fall back to a single raw-JSON text block (CUI would show an unreadable wall).
 */
export function normalizeBlocksEnvelopeJson(raw: unknown): unknown {
  let blocksArr: unknown;
  let wrapInEnvelope = false;

  if (isPlainObject(raw) && Array.isArray(raw['blocks'])) {
    blocksArr = raw['blocks'];
  } else if (Array.isArray(raw)) {
    blocksArr = raw;
    wrapInEnvelope = true;
  } else {
    return raw;
  }

  const blocks = (blocksArr as unknown[]).map((item) => {
    if (!isPlainObject(item)) {
      return item;
    }

    return normalizeBlockRecord(item);
  });

  return wrapInEnvelope ? { blocks } : { ...(raw as Record<string, unknown>), blocks };
}

/**
 * Extract likely JSON payloads from model output (preamble + fenced blocks, bare objects, etc.).
 */
export function extractJsonTextCandidates(modelText: string): string[] {
  const s = modelText.replace(/^\uFEFF/, '').trim();
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (c: string): void => {
    const t = c.trim();
    if (t !== '' && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(s)) !== null) {
    const inner = m[1];
    if (inner !== undefined) {
      push(inner);
    }
  }

  const balanced = extractFirstJsonValue(s);
  if (balanced !== null) {
    push(balanced);
  }

  const legacyStrip = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '').trim();
  push(legacyStrip);
  push(s);

  return out;
}

function extractBalancedJsonSlice(
  s: string,
  start: number,
  open: '{' | '[',
  close: '}' | ']',
): string | null {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const c = s[i]!;

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        continue;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === open) {
      depth++;
      continue;
    }

    if (c === close) {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * First top-level JSON object or array (string-aware), preferring `[` before `{` so `[{...}]`
 * is not truncated at the first inner `{`.
 */
export function extractFirstJsonValue(s: string): string | null {
  const arrIdx = s.indexOf('[');
  const objIdx = s.indexOf('{');
  if (arrIdx !== -1 && (objIdx === -1 || arrIdx < objIdx)) {
    return extractBalancedJsonSlice(s, arrIdx, '[', ']');
  }
  if (objIdx !== -1) {
    return extractBalancedJsonSlice(s, objIdx, '{', '}');
  }
  return null;
}

function looksLikeUnparsedBlocksJson(s: string): boolean {
  const t = s.trim();
  if (t.length < 80) {
    return false;
  }
  const head = t.slice(0, 240).toLowerCase();
  return head.includes('"blocks"') && head.includes('{');
}

function parseBlocksLenientFromEnvelope(normalized: unknown): ChatBlock[] | null {
  if (!isPlainObject(normalized) || !Array.isArray(normalized['blocks'])) {
    return null;
  }

  const blocksRaw = normalized['blocks'] as unknown[];
  const out: ChatBlock[] = [];

  for (const br of blocksRaw) {
    if (!isPlainObject(br)) {
      continue;
    }

    const rec = normalizeBlockRecord(br);
    const p = chatBlockSchema.safeParse(rec);
    if (p.success) {
      out.push(p.data);
    }
  }

  return out.length > 0 ? out : null;
}

function isWhitespaceOnlyTextChunk(s: string): boolean {
  return !/[^\s\uFEFF\u00a0]/u.test(s);
}

/**
 * The model sometimes interleaves compact `{"type":"claim", ...}` blobs with Markdown prose after
 * the blocks envelope heuristic fails — without this, the CUI shows an unreadable JSON wall.
 */
function splitTextWithEmbeddedClaims(raw: string): ChatBlock[] {
  const out: ChatBlock[] = [];
  let cursor = 0;
  const re = /\{"type"\s*:\s*"claim"/gu;

  for (;;) {
    re.lastIndex = cursor;
    const m = re.exec(raw);
    if (m === null) {
      const tail = raw.slice(cursor);
      if (!isWhitespaceOnlyTextChunk(tail)) {
        out.push({ type: 'text', text: tail });
      }
      break;
    }

    const objStart = m.index;
    const prefix = raw.slice(cursor, objStart);
    if (!isWhitespaceOnlyTextChunk(prefix)) {
      out.push({ type: 'text', text: prefix });
    }

    const jsonSlice = extractBalancedJsonSlice(raw, objStart, '{', '}');
    if (jsonSlice === null) {
      cursor = objStart + 1;
      continue;
    }

    try {
      const unknown: unknown = JSON.parse(jsonSlice);
      const rec = normalizeBlockRecord(unknown as Record<string, unknown>);
      const p = chatBlockSchema.safeParse(rec);
      if (p.success && p.data.type === 'claim') {
        out.push(p.data);
        cursor = objStart + jsonSlice.length;
        continue;
      }
    } catch {
      /* fallthrough */
    }

    cursor = objStart + jsonSlice.length;
  }

  return out.length > 0 ? out : [{ type: 'text', text: raw }];
}

function expandEmbeddedClaimsInParsedBlocks(blocks: ChatBlock[]): ChatBlock[] {
  const next: ChatBlock[] = [];

  for (const b of blocks) {
    if (b.type !== 'text') {
      next.push(b);
      continue;
    }
    next.push(...splitTextWithEmbeddedClaims(b.text));
  }

  return next;
}

export function parseBlocksFromModelText(text: string): ChatBlock[] {
  const originalTrimmed = text.replace(/^\uFEFF/, '').trim();
  const candidates = extractJsonTextCandidates(text);

  for (const cand of candidates) {
    try {
      const raw: unknown = JSON.parse(cand);
      const normalized = normalizeBlocksEnvelopeJson(raw);
      const parsed = blocksEnvelopeSchema.safeParse(normalized);
      if (parsed.success) {
        return expandEmbeddedClaimsInParsedBlocks(parsed.data.blocks);
      }

      const lenient = parseBlocksLenientFromEnvelope(normalized);
      if (lenient !== null) {
        return expandEmbeddedClaimsInParsedBlocks(lenient);
      }
    } catch {
      /* try next candidate */
    }
  }

  if (looksLikeUnparsedBlocksJson(originalTrimmed)) {
    return [
      {
        type: 'text',
        text: 'The assistant returned a response that could not be displayed. Please try again or reopen the chart.',
      },
    ];
  }

  const legacyTrimmed = originalTrimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '').trim();
  return expandEmbeddedClaimsInParsedBlocks([
    { type: 'text', text: legacyTrimmed || '(empty model response)' },
  ]);
}

/**
 * AI SDK v6 surfaces a *single* tool invocation in several overlapping fields
 * (final-step `toolResults`, `staticToolResults`, `dynamicToolResults`, plus
 * the same call inside `steps[i].toolResults` and the `tool-result` entries in
 * `steps[i].content`). `dedupKey` returns one identity per real call so the
 * collector emits each result exactly once. Falls back to a `(toolName|input)`
 * fingerprint when older mocks don't carry a `toolCallId`.
 */
function dedupKey(tr: AiToolResultLike): string {
  if (typeof tr.toolCallId === 'string' && tr.toolCallId !== '') {
    return `id:${tr.toolCallId}`;
  }

  let inputFingerprint: string;
  try {
    inputFingerprint = JSON.stringify(tr.input ?? null);
  } catch {
    inputFingerprint = '[unserializable]';
  }

  return `name:${tr.toolName ?? ''}|input:${inputFingerprint}`;
}

function appendToolResultsFromUnknown(
  from: unknown,
  into: AiToolResultLike[],
  seen: Set<string>,
): void {
  if (!Array.isArray(from)) {
    return;
  }

  for (const item of from) {
    if (!isToolResultLike(item)) {
      continue;
    }

    const key = dedupKey(item);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    into.push(item);
  }
}

export function collectToolResultsFromGenerateTextResult(result: unknown): AiToolResultLike[] {
  const out: AiToolResultLike[] = [];
  const seen = new Set<string>();
  if (result === null || typeof result !== 'object') {
    return out;
  }

  const root = result as {
    staticToolResults?: unknown;
    dynamicToolResults?: unknown;
    toolResults?: unknown;
    steps?: unknown;
  };

  // AI SDK v6 exposes final-step tool results at the root and all step results under `steps`.
  // Dedupe by toolCallId so a single tool invocation never appears twice in `out`.
  appendToolResultsFromUnknown(root.staticToolResults, out, seen);
  appendToolResultsFromUnknown(root.dynamicToolResults, out, seen);
  appendToolResultsFromUnknown(root.toolResults, out, seen);

  if (Array.isArray(root.steps)) {
    for (const step of root.steps) {
      if (step === null || typeof step !== 'object') {
        continue;
      }

      const s = step as {
        staticToolResults?: unknown;
        dynamicToolResults?: unknown;
        toolResults?: unknown;
        content?: unknown;
      };
      appendToolResultsFromUnknown(s.staticToolResults, out, seen);
      appendToolResultsFromUnknown(s.dynamicToolResults, out, seen);
      appendToolResultsFromUnknown(s.toolResults, out, seen);
      appendToolResultsFromUnknown(s.content, out, seen);
    }
  }

  return out;
}

/**
 * Emit one proposal block per *unique* proposal_id. Belt-and-suspenders against
 * S2 ("no silent write"): if the same proposal_id ever shows up twice in the
 * collected tool results, we still render exactly one Confirm/Reject card so a
 * clinician cannot accidentally double-confirm the same write.
 */
export function coerceProposalChatBlocks(toolResults: AiToolResultLike[]): ChatBlock[] {
  const out: ChatBlock[] = [];
  const seenProposalIds = new Set<string>();

  for (const tr of toolResults) {
    const payload = tr.output;
    if (!isPlainObject(payload)) {
      continue;
    }
    if (payload['ok'] !== true) {
      continue;
    }
    const proposalIdRaw = payload['proposal_id'];
    const wtRaw = payload['write_target'];
    const previewCandidate = payload['preview'];
    const previewFromPayload =
      typeof previewCandidate === 'string' && previewCandidate.trim() !== '' ? previewCandidate : wtRaw;

    if (typeof proposalIdRaw !== 'string' || typeof wtRaw !== 'string') {
      continue;
    }

    if (seenProposalIds.has(proposalIdRaw)) {
      continue;
    }

    const preview =
      typeof previewFromPayload === 'string' && previewFromPayload.trim() !== '' ?
        previewFromPayload.trim()
      : `Proposed ${wtRaw}`;

    const parsed = chatBlockSchema.safeParse({
      type: 'proposal',
      proposal_id: proposalIdRaw,
      write_target: wtRaw,
      preview,
    });

    if (parsed.success) {
      seenProposalIds.add(proposalIdRaw);
      out.push(parsed.data);
    }
  }

  return out;
}

export type ChatTurnDeps = Readonly<{ pool: Pool }>;

export type ChatTurnInput = {
  sessionToken: string;
  patientUuid: string;
  userMessage: string;
  /** Client-owned stable id for Postgres thread partitioning (RFC-4122). */
  conversation_id?: string | undefined;
};

export async function runChatTurn(
  env: Env,
  observability: Observability,
  input: ChatTurnInput,
  correlationId: string,
  deps: ChatTurnDeps,
): Promise<{
  blocks: ChatBlock[];
  citation_navigation: Record<string, CitationNavigationHint>;
  conversation_id: string;
}> {
  const trace = await observability.traceTurn({ correlationId, turnName: 'chat' });
  const conversationIdFallback =
    typeof input.conversation_id === 'string' && input.conversation_id !== '' ?
      input.conversation_id
    : randomUUID();

  if (isInternalDisclosureRequest(input.userMessage)) {
    await observability.recordToolCall({
      correlationId,
      toolName: 'security_guard',
      meta: { category: 'internal_disclosure_block' },
    });

    return {
      blocks: [{ type: 'refusal', reason: 'internal_details_not_available' }],
      citation_navigation: {},
      conversation_id: conversationIdFallback,
    };
  }

  let convRecord;
  try {
    convRecord = await insertConversationRow(deps.pool, conversationIdFallback, input.patientUuid);
  } catch (e) {
    const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
    if (code === 'conversation_patient_mismatch') {
      return {
        blocks: [{ type: 'refusal', reason: 'conversation_patient_conflict' }],
        citation_navigation: {},
        conversation_id: conversationIdFallback,
      };
    }
    throw e;
  }

  await appendTurn(deps.pool, convRecord.internalId, 'user', correlationId, {
    text: input.userMessage,
  });

  const proposeBundle = createProposeWriteTools(
    env,
    deps.pool,
    input.sessionToken,
    observability,
    correlationId,
    { conversationInternalId: convRecord.internalId },
  );

  const tools = {
    ...createChartContextReadTools(env, input.sessionToken, observability, correlationId),
    get_identity: createGetIdentityTool(env, input.sessionToken, observability, correlationId),
    get_allergies: createGetAllergiesTool(env, input.sessionToken, observability, correlationId),
    ...proposeBundle,
  };

  const model = getChatModel(env);
  await observability.recordLlmCall({
    correlationId,
    providerModel: env.LLM_PROVIDER,
    meta: { phase: 'request' },
  });

  const sessionClaims = verifySessionToken(input.sessionToken, env.SESSION_TOKEN_SECRET);
  const boundEncounterId =
    sessionClaims !== null && typeof sessionClaims.encounter_id === 'number' && sessionClaims.encounter_id > 0 ?
      sessionClaims.encounter_id
    : null;

  const today = new Date().toISOString().slice(0, 10);
  const turnHeader =
    boundEncounterId !== null ?
      `patient_uuid for this turn: ${input.patientUuid}\nactive_encounter_id for this turn: ${boundEncounterId}\nserver_today: ${today}\n\nUser: ${input.userMessage}`
    : `patient_uuid for this turn: ${input.patientUuid}\nactive_encounter_id for this turn: <none — the rail was launched without a bound encounter; either an encounter has not been saved yet, or this rail iframe is stale and needs to be reopened after the physician saved the encounter form>\nserver_today: ${today}\n\nUser: ${input.userMessage}`;

  const result = await generateText({
    model,
    system: CLINICAL_SYSTEM_PROMPT,
    prompt: turnHeader,
    tools,
    stopWhen: stepCountIs(12),
  });

  const mergedToolResults = collectToolResultsFromGenerateTextResult(result);

  let blocks = parseBlocksFromModelText(result.text);
  blocks = [...blocks, ...coerceProposalChatBlocks(mergedToolResults)];

  const evidence = buildClinicalToolEvidence(input.patientUuid, mergedToolResults);

  blocks = await verifyClinicalBlocks(observability, correlationId, blocks, evidence);

  const usage = result.totalUsage;
  const costUsd =
    estimateUsdForProviderTokens(env.LLM_PROVIDER, usage?.inputTokens, usage?.outputTokens) ?? null;
  const costMeta =
    usage === undefined
      ? { phase: 'response_completed', traceId: trace.id, cost_usd: null as number | null }
      : {
          phase: 'response_completed',
          traceId: trace.id,
          correlation_id: correlationId,
          provider: env.LLM_PROVIDER,
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          cost_usd: costUsd ?? null,
        };

  console.info(JSON.stringify(costMeta));

  await observability.recordLlmCall({
    correlationId,
    providerModel: env.LLM_PROVIDER,
    meta: costMeta as Record<string, unknown>,
  });

  const assistantBody: Record<string, unknown> = { blocks: blocks as unknown[] };
  await appendTurn(deps.pool, convRecord.internalId, 'assistant', correlationId, assistantBody);

  const citation_navigation = buildCitationNavigationIndex(mergedToolResults);

  return {
    blocks,
    citation_navigation,
    conversation_id: convRecord.externalId,
  };
}
