import { generateText, stepCountIs } from 'ai';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { Observability } from '../observability/index.js';
import { appendTurn, insertConversationRow, insertPendingProposal } from '../conversations/store.js';
import { normalizeReactionToOptionId, normalizeSubstance } from '../tools/propose_writes.js';
import { verifySessionToken } from '../handshake/sessionToken.js';
import { chatBlockSchema, type ChatBlock } from '../openemr/types.js';
import { createChartContextReadTools } from '../tools/chart_context_reads.js';
import { createGetAllergiesTool } from '../tools/get_allergies.js';
import { createGetIdentityTool } from '../tools/get_identity.js';
import { createProposeWriteTools } from '../tools/propose_writes.js';
import { buildW2DocumentNote, createW2Tools } from './w2_tools.js';
import { estimateUsdForProviderTokens } from './cost_estimate.js';
import { todayInFacilityTz } from './local_date.js';
import { CLINICAL_SYSTEM_PROMPT } from './system_prompt.js';
import { getChatModel, getProviderModelId } from './model.js';
import {
  buildCitationLegendFromToolResults,
  buildCitationNavigationIndex,
  buildClinicalToolEvidence,
  type CitationNavigationHint,
} from './toolEvidence.js';
import { verifyClinicalBlocks } from './verification.js';
import { type AiToolResultLike, isToolResultLike } from './tool_results.js';
import { HANDOFF_REASONS, type RoutingEmitter } from './handoff.js';
import { finalizeStructuredEnvelope } from './finalizeStructured.js';

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
 * G2-Final-FB-A-02 — synthesize one `agent_step` chat block per
 * `attach_and_extract` / `evidence_retrieve` invocation found in the
 * merged tool-results stream. Surfaces supervisor routing inline in the
 * CUI so the reviewer can see which worker fired, why (one-sentence
 * rationale from `HANDOFF_REASONS`), and the funnel / extraction stats —
 * without opening Langfuse.
 *
 * PHI-safe by construction: `input_summary` carries only the same
 * structural metadata that the handoff event recorded (size, prefix,
 * counts), and `stats` carries `RetrievalStats` (counts + chunk_ids +
 * scores) or extraction-confidence buckets.
 *
 * Tool-results that aren't one of the two W2 workers are skipped — only
 * the supervisor's worker dispatches surface as `agent_step` blocks.
 */
export function synthesizeAgentSteps(toolResults: AiToolResultLike[]): ChatBlock[] {
  const out: ChatBlock[] = [];

  for (const tr of toolResults) {
    if (tr.toolName === 'evidence_retrieve') {
      const block = buildEvidenceRetrieveAgentStep(tr);
      if (block !== null) {
        out.push(block);
      }
      continue;
    }
    if (tr.toolName === 'attach_and_extract') {
      const block = buildAttachAndExtractAgentStep(tr);
      if (block !== null) {
        out.push(block);
      }
    }
  }

  return out;
}

function asPlainObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function readNonNegativeInt(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0;
}

function buildEvidenceRetrieveAgentStep(tr: AiToolResultLike): ChatBlock | null {
  const input = asPlainObject(tr.input);
  const output = asPlainObject(tr.output);
  if (output === null) {
    return null;
  }

  const queryChars = readNonNegativeInt(output['query_chars'] ?? input?.['query']?.toString().length);
  const maxChunks = readNonNegativeInt(output['max_chunks'] ?? input?.['max_chunks']);
  const durationMs = readNonNegativeInt(output['duration_ms']);
  const inputSummary = { query_chars: queryChars, max_chunks: maxChunks };

  if (output['ok'] !== true) {
    return {
      type: 'agent_step',
      worker: 'evidence_retriever',
      reason: HANDOFF_REASONS.evidence_retriever,
      input_summary: inputSummary,
      duration_ms: durationMs,
      outcome: 'error',
    };
  }

  const stats = asPlainObject(output['stats']);
  const hitsAfterRerank = stats !== null ? readNonNegativeInt(stats['hits_after_rerank']) : 0;
  return {
    type: 'agent_step',
    worker: 'evidence_retriever',
    reason: HANDOFF_REASONS.evidence_retriever,
    input_summary: inputSummary,
    duration_ms: durationMs,
    outcome: hitsAfterRerank > 0 ? 'ok' : 'no_results',
    ...(stats !== null ? { stats } : {}),
  };
}

function buildAttachAndExtractAgentStep(tr: AiToolResultLike): ChatBlock | null {
  const input = asPlainObject(tr.input);
  const output = asPlainObject(tr.output);
  if (output === null) {
    return null;
  }

  const docrefRaw = typeof input?.['docref_uuid'] === 'string' ? (input['docref_uuid'] as string) : '';
  const docTypeRaw = typeof input?.['doc_type'] === 'string' ? (input['doc_type'] as string) : 'unknown';
  const inputSummary = {
    docref_uuid_prefix: docrefRaw.slice(0, 8),
    doc_type: docTypeRaw,
  };
  const durationMs = readNonNegativeInt(output['duration_ms']);

  if (output['ok'] !== true) {
    return {
      type: 'agent_step',
      worker: 'intake_extractor',
      reason: HANDOFF_REASONS.intake_extractor,
      input_summary: inputSummary,
      duration_ms: durationMs,
      outcome: 'error',
    };
  }

  const result = asPlainObject(output['result']);
  if (result === null) {
    return null;
  }
  const schemaValid = result['schemaValid'] === true;
  const factsTotal = readNonNegativeInt(result['factsTotal']);
  const factsVerified = readNonNegativeInt(result['factsVerified']);
  const crossCheckStatus =
    typeof result['crossCheckStatus'] === 'string' ? (result['crossCheckStatus'] as string) : 'unknown';
  const stats: Record<string, unknown> = {
    schema_valid: schemaValid,
    cross_check_status: crossCheckStatus,
    facts_total: factsTotal,
    facts_verified: factsVerified,
  };

  let outcome: 'ok' | 'no_results' | 'error';
  if (!schemaValid) {
    outcome = 'error';
  } else if (factsTotal === 0) {
    outcome = 'no_results';
  } else {
    outcome = 'ok';
  }

  return {
    type: 'agent_step',
    worker: 'intake_extractor',
    reason: HANDOFF_REASONS.intake_extractor,
    input_summary: inputSummary,
    duration_ms: durationMs,
    outcome,
    stats,
  };
}

/**
 * G2-Final-FB-B-02 — synthesize a refusal block when an `attach_and_extract`
 * tool result reports `persistence.skipped_reason === 'cross_check_failed'`.
 *
 * Per S14, facts whose `quote_or_value` was not present in the source PDF
 * MUST NOT persist. The worker already skipped persistence; this helper
 * surfaces a user-facing refusal so the reviewer sees the failure mode
 * instead of an empty success banner. Only the latest such failure is
 * surfaced (avoids cascading refusals across consecutive uploads).
 */
export function synthesizeCrossCheckFailRefusal(toolResults: AiToolResultLike[]): ChatBlock | null {
  // Walk newest → oldest. Stop at the FIRST attach_and_extract result we
  // see — only the latest extraction on this turn determines whether the
  // refusal surfaces. A later success suppresses an earlier failure.
  for (let i = toolResults.length - 1; i >= 0; i--) {
    const tr = toolResults[i];
    if (tr === undefined || tr.toolName !== 'attach_and_extract') {
      continue;
    }
    const out = asPlainObject(tr.output);
    if (out === null || out['ok'] !== true) {
      // Latest extraction errored at the tool boundary — refusal not
      // appropriate here (the agent_step error block already surfaces it).
      return null;
    }
    const persistence = asPlainObject(out['persistence']);
    if (persistence === null) {
      return null;
    }
    if (persistence['skipped_reason'] === 'cross_check_failed') {
      return {
        type: 'refusal',
        reason:
          "Some values in this lab couldn't be verified against the source PDF — not writing to the chart. Open the source to review.",
      };
    }
    return null;
  }
  return null;
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

export type ChatTurnDeps = Readonly<{
  pool: Pool;
  /**
   * Optional live-routing emitter. The HTTP layer binds this to the SSE
   * stream's `routing` event so the CUI can swap the typing indicator's
   * bare ellipsis for a worker-specific affordance ("Reading file" /
   * "Searching evidence") the moment the supervisor's tool call begins.
   * Tests omit it — the post-hoc `agent_step` blocks already exercise the
   * synthesized shape on the response side.
   */
  onRouting?: RoutingEmitter;
}>;

export type ChatTurnInput = {
  sessionToken: string;
  patientUuid: string;
  userMessage: string;
  /** Client-owned stable id for Postgres thread partitioning (RFC-4122). */
  conversation_id?: string | undefined;
  /** §5 / G2-MVP-36 — when present, the supervisor invokes attach_and_extract first. */
  docrefUuid?: string | undefined;
  docType?: 'lab_pdf' | 'intake_form' | undefined;
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
    await observability.recordEvent({
      correlationId,
      name: 'security_guard.internal_disclosure_block',
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

  const w2Tools = await createW2Tools({
    env,
    pool: deps.pool,
    sessionToken: input.sessionToken,
    correlationId,
    observability,
    ...(deps.onRouting !== undefined ? { onRouting: deps.onRouting } : {}),
  });

  const tools = {
    ...createChartContextReadTools(env, input.sessionToken, observability, correlationId),
    get_identity: createGetIdentityTool(env, input.sessionToken, observability, correlationId),
    get_allergies: createGetAllergiesTool(env, input.sessionToken, observability, correlationId),
    ...proposeBundle,
    ...w2Tools,
  };

  const model = getChatModel(env);
  const providerModelId = getProviderModelId(env);
  await observability.recordLlmCall({
    correlationId,
    providerModel: providerModelId,
    meta: { phase: 'request' },
  });

  const sessionClaims = verifySessionToken(input.sessionToken, env.SESSION_TOKEN_SECRET);
  const boundEncounterId =
    sessionClaims !== null && typeof sessionClaims.encounter_id === 'number' && sessionClaims.encounter_id > 0 ?
      sessionClaims.encounter_id
    : null;

  // P2 fix: format `server_today` in OpenEMR's configured facility timezone
  // (carried in the JWT `facility_tz` claim) so the model's "today" matches
  // the operator's wall clock, not UTC. Falls back to UTC when claim absent.
  const today = todayInFacilityTz(new Date(), sessionClaims?.facility_tz ?? null);
  const w2DocumentNote = buildW2DocumentNote(input.docrefUuid, input.docType);
  const turnHeader =
    (boundEncounterId !== null
      ? `patient_uuid for this turn: ${input.patientUuid}\nactive_encounter_id for this turn: ${boundEncounterId}\nserver_today: ${today}\n\nUser: ${input.userMessage}`
      : `patient_uuid for this turn: ${input.patientUuid}\nactive_encounter_id for this turn: <none — the rail was launched without a bound encounter; either an encounter has not been saved yet, or this rail iframe is stale and needs to be reopened after the physician saved the encounter form>\nserver_today: ${today}\n\nUser: ${input.userMessage}`)
    + w2DocumentNote;

  const llmStartedAtMs = Date.now();
  const result = await generateText({
    model,
    system: CLINICAL_SYSTEM_PROMPT,
    prompt: turnHeader,
    tools,
    stopWhen: stepCountIs(12),
  });

  const mergedToolResults = collectToolResultsFromGenerateTextResult(result);

  let blocks = parseBlocksFromModelText(result.text);

  // P0-B / FB-D follow-up (2026-05-07) — when the turn used evidence_retrieve,
  // run the structured-finalize pass to convert the LLM's free-text draft
  // into a schema-validated envelope where claim blocks carry inline cite
  // segments to the returned guideline chunks. The legacy parser
  // (parseBlocksFromModelText above) handles chart-data turns correctly —
  // the model produces proper claim+cite shapes natively for those — but on
  // evidence_retrieve turns the model falls back to a "textbook prose +
  // sources list at the end" shape that strips inline citations. The
  // finalizer's Zod schema makes that shape unrepresentable: every claim
  // block requires ≥1 cite segment, and citation_id is constrained to a
  // closed enum of the chunk UUIDs returned this turn.
  //
  // Conditioned on the legend being non-empty (i.e. evidence_retrieve was
  // actually invoked) so chart-data-only turns keep the proven legacy path
  // and we don't pay an extra LLM call per turn for content that doesn't
  // need restructuring. On finalizer failure (schema validation throws,
  // model timeout, etc.) we fall through to the legacy blocks — same
  // failure mode as today, no regression risk.
  const citationLegendForFinalizer = buildCitationLegendFromToolResults(mergedToolResults);
  if (citationLegendForFinalizer.length > 0) {
    const evidenceForFinalizer = buildClinicalToolEvidence(input.patientUuid, mergedToolResults);
    if (evidenceForFinalizer.citationUuids.size > 0) {
      const structured = await finalizeStructuredEnvelope({
        model,
        userMessage: input.userMessage,
        draftText: result.text,
        citationLegend: citationLegendForFinalizer,
        allowedCitationIds: evidenceForFinalizer.citationUuids,
        observability,
        correlationId,
      });
      if (structured !== null) {
        blocks = structured.blocks;
      }
    }
  }

  blocks = [...blocks, ...coerceProposalChatBlocks(mergedToolResults)];

  // §9 / G2-MVP-99 — surface successful attach_and_extract result as an
  // `extraction` block so the CUI can render the ExtractionAcknowledgment
  // headline + (for intake_form) the IntakeProposalCard inline. Prepended
  // so the visual flow is: ack → (lab summary proposal) → LLM commentary
  // → claims with citations.
  const extractionBlock = buildExtractionBlock(mergedToolResults);
  if (extractionBlock !== null) {
    blocks = [extractionBlock, ...blocks];
  }

  // G2-Final-FB-A-02 — surface supervisor routing inline. One `agent_step`
  // block per worker invocation, prepended so the visual flow becomes:
  // routing → extraction ack → claims with citations. Reviewer can see the
  // funnel + duration without opening Langfuse.
  const agentStepBlocks = synthesizeAgentSteps(mergedToolResults);
  if (agentStepBlocks.length > 0) {
    blocks = [...agentStepBlocks, ...blocks];
  }

  // G2-Final-FB-B-02 — when a lab extraction failed PDF cross-check (S14),
  // the worker already skipped persistence; surface a refusal so the
  // reviewer sees why no rows landed.
  const crossCheckRefusal = synthesizeCrossCheckFailRefusal(mergedToolResults);
  if (crossCheckRefusal !== null) {
    blocks = [...blocks, crossCheckRefusal];
  }

  // §10 / G2-Early-27 — Lab Summary clinical note auto-proposal.
  // Re-enabled 2026-05-06 after debugging the swallowed-exception path:
  // `OpenEmrClinicalNoteAdapter` now requires `library/forms.inc.php`
  // in its constructor (so `addForm()` is defined when ClinicalNotesService
  // creates the parent `clinical_notes` form on a fresh new-patient
  // encounter), and `ClinicalNoteWriteAction` now `error_log()`s the
  // caught exception detail so future failures surface in `php-log`.
  const labSummaryProposal = await maybeBuildLabSummaryProposal(mergedToolResults, {
    pool: deps.pool,
    conversationInternalId: convRecord.internalId,
    patientUuid: input.patientUuid,
    encounterId: boundEncounterId,
  });
  if (labSummaryProposal !== null) {
    // Insert the lab summary proposal directly after the extraction block so the
    // Confirm/Reject card renders below the lab acknowledgment, mirroring the intake
    // form's IntakeProposalCard placement.
    const insertAt = blocks.findIndex((b) => b.type === 'extraction') + 1;
    blocks = [
      ...blocks.slice(0, insertAt),
      labSummaryProposal,
      ...blocks.slice(insertAt),
    ];
  }

  // Phase 4 — intake-form bundle proposal. Replaces the W2 IntakeProposalCard
  // path (browser-side fan-out via intake_dispatch.ts) with a single bundle
  // pending_proposals row. The CUI affordance queues it like any other
  // proposal; the dashboard's BundleReviewModal opens against the queue
  // head with per-section toggles + Confirm All / Reject All. Server-side
  // fan-out (apply_pending_write.ts) writes each leaf with a synthetic
  // proposal_id so the PHP idempotency ledger keeps each section/item
  // uniquely de-duplicable.
  const intakeBundleProposal = await maybeBuildIntakeBundleProposal(mergedToolResults, {
    pool: deps.pool,
    conversationInternalId: convRecord.internalId,
    patientUuid: input.patientUuid,
    encounterId: boundEncounterId,
  });
  if (intakeBundleProposal !== null) {
    const insertAt = blocks.findIndex((b) => b.type === 'extraction') + 1;
    blocks = [
      ...blocks.slice(0, insertAt),
      intakeBundleProposal,
      ...blocks.slice(insertAt),
    ];
  }

  const evidence = buildClinicalToolEvidence(input.patientUuid, mergedToolResults);

  // Verification gate — runs post-LLM, post-tool, pre-return. The four layers
  // (citation enforcement, negative-claim backing, BP range guard, med-inactive
  // warning) and their known limitations live in VERIFICATION.md at repo root.
  blocks = await verifyClinicalBlocks(observability, correlationId, blocks, evidence);

  const usage = result.totalUsage;
  const costUsd =
    estimateUsdForProviderTokens(env.LLM_PROVIDER, usage?.inputTokens, usage?.outputTokens) ?? null;
  const costMeta =
    usage === undefined
      ? {
          phase: 'response_completed',
          traceId: trace.id,
          start_time_ms: llmStartedAtMs,
          cost_usd: null as number | null,
        }
      : {
          phase: 'response_completed',
          traceId: trace.id,
          correlation_id: correlationId,
          provider: env.LLM_PROVIDER,
          start_time_ms: llmStartedAtMs,
          input_tokens: usage.inputTokens ?? null,
          output_tokens: usage.outputTokens ?? null,
          cost_usd: costUsd ?? null,
        };

  console.info(JSON.stringify(costMeta));

  await observability.recordLlmCall({
    correlationId,
    providerModel: providerModelId,
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

/**
 * §9 / G2-MVP-99 — find the latest successful `attach_and_extract` tool result
 * in `mergedToolResults` and convert it into an `extraction` ChatBlock for the
 * CUI. Returns null when no extraction ran or the extraction errored.
 */
function buildExtractionBlock(toolResults: AiToolResultLike[]): ChatBlock | null {
  for (let i = toolResults.length - 1; i >= 0; i--) {
    const tr = toolResults[i];
    if (tr === undefined || tr.toolName !== 'attach_and_extract') {
      continue;
    }
    const out = tr.output;
    if (out === null || typeof out !== 'object') {
      continue;
    }
    const ok = (out as { ok?: unknown }).ok;
    if (ok !== true) {
      continue;
    }
    const result = (out as { result?: unknown }).result;
    if (result === null || typeof result !== 'object') {
      continue;
    }
    const r = result as {
      metadata?: { docType?: 'lab_pdf' | 'intake_form' };
      factsTotal?: number;
      extraction?: unknown;
    };
    const docType = r.metadata?.docType;
    if (docType !== 'lab_pdf' && docType !== 'intake_form') {
      continue;
    }
    const docrefUuid =
      tr.input !== null && typeof tr.input === 'object' ?
        ((tr.input as { docref_uuid?: string }).docref_uuid ?? '')
      : '';
    if (docrefUuid === '') {
      continue;
    }

    if (docType === 'lab_pdf') {
      const labResults =
        r.extraction !== null && typeof r.extraction === 'object' ?
          ((r.extraction as { results?: ReadonlyArray<{ abnormal_flag?: string }> }).results ?? [])
        : [];
      const nAbnormal = labResults.filter(
        (lr) => typeof lr.abnormal_flag === 'string' && lr.abnormal_flag !== 'normal' && lr.abnormal_flag !== 'unknown',
      ).length;
      // G2-Early-27 — include the formatted Lab Summary text on the
      // extraction block so the CUI can render an informational
      // ProposalCardShell preview (no Confirm/Reject; deferred-scope
      // status). The actual chart write lands at G2-Early-27.
      const labSummary =
        r.extraction !== null && typeof r.extraction === 'object' ?
          formatLabSummaryNoteBody(r.extraction as Record<string, unknown>)
        : '';
      return {
        type: 'extraction',
        doc_type: 'lab_pdf',
        docref_uuid: docrefUuid,
        n_facts: typeof r.factsTotal === 'number' ? r.factsTotal : labResults.length,
        n_abnormal: nAbnormal,
        ...(labSummary !== '' ? { lab_summary: labSummary } : {}),
      };
    }

    // intake_form
    const ext = r.extraction as {
      demographics?: { name?: string | null; dob?: string | null; sex?: string | null; contact_phone?: string | null };
      chief_concern?: { text?: string; onset?: string | null };
      current_medications?: ReadonlyArray<{ name?: string; dose?: string | null; frequency?: string | null }>;
      allergies?: ReadonlyArray<{ substance?: string; reaction?: string | null; severity?: string | null }>;
      family_history?: ReadonlyArray<{ relation?: string; condition?: string }>;
    } | null;
    if (ext === null || typeof ext !== 'object') {
      continue;
    }
    return {
      type: 'extraction',
      doc_type: 'intake_form',
      docref_uuid: docrefUuid,
      n_facts: typeof r.factsTotal === 'number' ? r.factsTotal : 0,
      intake_data: {
        demographics: {
          name: ext.demographics?.name ?? null,
          dob: ext.demographics?.dob ?? null,
          sex: ext.demographics?.sex ?? null,
          contact_phone: ext.demographics?.contact_phone ?? null,
        },
        chief_concern: {
          text: ext.chief_concern?.text ?? '',
          onset: ext.chief_concern?.onset ?? null,
        },
        current_medications: (ext.current_medications ?? []).map((m) => ({
          name: m.name ?? '',
          dose: m.dose ?? null,
          frequency: m.frequency ?? null,
        })),
        allergies: (ext.allergies ?? []).map((a) => ({
          substance: a.substance ?? '',
          reaction: a.reaction ?? null,
          severity: a.severity ?? null,
        })),
        family_history: (ext.family_history ?? []).map((f) => ({
          relation: f.relation ?? '',
          condition: f.condition ?? '',
        })),
      },
    };
  }
  return null;
}

/**
 * §10 / G2-Early-27 — Lab Summary clinical-note auto-proposal.
 *
 * When `attach_and_extract` succeeds for a lab PDF, synthesize a
 * `propose_clinical_note_write`-equivalent pending proposal directly
 * (no LLM round-trip) and emit a matching `proposal` ChatBlock so the
 * CUI renders a Confirm/Reject card alongside the lab acknowledgment.
 * On Confirm, the existing W1 `/conversations/:id/confirm` endpoint
 * applies the pending row, writing the lab summary into the encounter's
 * canonical clinical-note row.
 *
 * Returns null when:
 *   - no successful lab extraction in this turn
 *   - no bound encounter (clinical notes need one)
 *   - the extraction is missing the `results` array (defensive)
 */
async function maybeBuildLabSummaryProposal(
  toolResults: AiToolResultLike[],
  ctx: Readonly<{
    pool: Pool;
    conversationInternalId: number;
    patientUuid: string;
    encounterId: number | null;
  }>,
): Promise<ChatBlock | null> {
  if (ctx.encounterId === null || ctx.encounterId <= 0) {
    return null;
  }

  // Find the latest successful lab extraction in the tool results.
  for (let i = toolResults.length - 1; i >= 0; i--) {
    const tr = toolResults[i];
    if (tr === undefined || tr.toolName !== 'attach_and_extract') {
      continue;
    }
    const out = tr.output;
    if (out === null || typeof out !== 'object' || (out as { ok?: unknown }).ok !== true) {
      continue;
    }
    const r = (out as { result?: unknown }).result;
    if (r === null || typeof r !== 'object') {
      continue;
    }
    const meta = (r as { metadata?: { docType?: string } }).metadata;
    if (meta?.docType !== 'lab_pdf') {
      continue;
    }
    const ext = (r as { extraction?: unknown }).extraction;
    if (ext === null || typeof ext !== 'object') {
      continue;
    }
    const results = (ext as { results?: ReadonlyArray<unknown> }).results;
    if (!Array.isArray(results) || results.length === 0) {
      continue;
    }

    const noteBody = formatLabSummaryNoteBody(ext as Record<string, unknown>);
    if (noteBody === '') {
      continue;
    }

    const proposalId = randomUUID();
    try {
      await insertPendingProposal(ctx.pool, {
        proposalId,
        conversationInternalId: ctx.conversationInternalId,
        patientUuid: ctx.patientUuid.toLowerCase(),
        encounterId: ctx.encounterId,
        writeTarget: 'clinical_note',
        payload: { text: noteBody },
      });
    } catch (e) {
      // Don't block the rest of the turn if proposal insertion fails;
      // log and continue. The user still sees the extraction
      // acknowledgment and can ask follow-up questions.
      console.error('lab_summary_proposal_insert_failed', {
        proposal_id: proposalId,
        error_message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    const previewBody = noteBody.length > 280 ? `${noteBody.slice(0, 277)}…` : noteBody;
    return {
      type: 'proposal',
      proposal_id: proposalId,
      write_target: 'clinical_note',
      preview: `Lab Summary clinical note (encounter #${ctx.encounterId}) → ${previewBody}`,
    };
  }

  return null;
}

/**
 * Phase 4 — Intake-form bundle proposal.
 *
 * When `attach_and_extract` succeeds for a patient intake form, fold every
 * extracted section (demographics, chief concern, current medications,
 * allergies, family history) into ONE bundle `pending_proposals` row and
 * emit a single `proposal` chat block that lands in the affordance queue.
 * The dashboard's `BundleReviewModal` opens against the queue head so the
 * physician can per-section reject / per-row toggle, then Confirm All to
 * fan out N writes.
 *
 * Replaces the W2-era `IntakeProposalCard` flow which dispatched per-row
 * writes browser-side via `intake_dispatch.ts`. The new path is
 * server-side fan-out (apply_pending_write.ts) using synthetic per-leaf
 * proposal_ids so the PHP idempotency ledger keeps each section/item
 * uniquely de-duplicable.
 *
 * Returns null when:
 *   - no successful intake_form extraction in this turn
 *   - extraction has no usable sections (every field empty)
 *   - row insert fails (logged, doesn't block the turn)
 */
async function maybeBuildIntakeBundleProposal(
  toolResults: AiToolResultLike[],
  ctx: Readonly<{
    pool: Pool;
    conversationInternalId: number;
    patientUuid: string;
    encounterId: number | null;
  }>,
): Promise<ChatBlock | null> {
  for (let i = toolResults.length - 1; i >= 0; i--) {
    const tr = toolResults[i];
    if (tr === undefined || tr.toolName !== 'attach_and_extract') {
      continue;
    }
    const out = tr.output;
    if (out === null || typeof out !== 'object' || (out as { ok?: unknown }).ok !== true) {
      continue;
    }
    const r = (out as { result?: unknown }).result;
    if (r === null || typeof r !== 'object') {
      continue;
    }
    const meta = (r as { metadata?: { docType?: string } }).metadata;
    if (meta?.docType !== 'intake_form') {
      continue;
    }
    const ext = (r as { extraction?: unknown }).extraction;
    if (ext === null || typeof ext !== 'object') {
      continue;
    }
    const extObj = ext as Record<string, unknown>;
    if (extObj['document_type'] !== 'intake_form') {
      continue;
    }

    const docrefUuid =
      tr.input !== null && typeof tr.input === 'object' ?
        ((tr.input as { docref_uuid?: string }).docref_uuid ?? '')
      : '';

    const sections = buildIntakeBundleSections(extObj, ctx.encounterId);
    if (sections.length === 0) {
      // Extraction returned but every section was empty — nothing to confirm.
      // Skip silently (the extraction acknowledgment block still renders).
      return null;
    }

    const preview = formatIntakeBundlePreview(sections);
    const proposalId = randomUUID();
    const bundlePayload: Record<string, unknown> = {
      kind: 'bundle',
      source: 'intake_form',
      preview,
      sections,
    };
    if (docrefUuid !== '') {
      bundlePayload['doc_ref_uuid'] = docrefUuid;
    }

    try {
      await insertPendingProposal(ctx.pool, {
        proposalId,
        conversationInternalId: ctx.conversationInternalId,
        // Bundle root has no encounter binding — `encounter_id` lives at the
        // section level, since one bundle may mix encounter-bound (chief
        // complaint) and patient-scoped (allergy / medication) sections.
        encounterId: null,
        patientUuid: ctx.patientUuid.toLowerCase(),
        writeTarget: 'intake_bundle',
        payload: bundlePayload,
      });
    } catch (e) {
      console.error('intake_bundle_proposal_insert_failed', {
        proposal_id: proposalId,
        error_message: e instanceof Error ? e.message : String(e),
      });
      return null;
    }

    return {
      type: 'proposal',
      proposal_id: proposalId,
      write_target: 'intake_bundle',
      preview,
    };
  }

  return null;
}

/**
 * Walk the `intake_form` extraction shape and build per-section bundle
 * entries. Each leaf carries its own `write_target`, `payload`, and
 * (when relevant) `encounter_id`. Empty sections are skipped — the
 * extracted form may have had rows for some fields and not others.
 *
 * Slug-style `section_id` and `item_id` values are intentional: the PHP
 * idempotency ledger column is `VARCHAR(191)` and the synthetic proposal
 * ids fan-out emits are `${parent}::${section}[::${item}]`. Short slugs
 * stay well within budget; the bundle assembler asserts no `::` in the
 * IDs (see plan doc, "Schema constraints on synthetic IDs").
 */
type IntakeBundleItem = Readonly<{
  item_id: string;
  write_target: string;
  encounter_id: number | null;
  payload: Record<string, unknown>;
  rejected: boolean;
}>;

type IntakeBundleSection =
  | {
      readonly section_id: string;
      readonly title: string;
      readonly write_target: string;
      readonly encounter_id: number | null;
      readonly payload: Record<string, unknown>;
      readonly rejected: boolean;
    }
  | {
      readonly section_id: string;
      readonly title: string;
      readonly items: ReadonlyArray<IntakeBundleItem>;
    };

function buildIntakeBundleSections(
  ext: Record<string, unknown>,
  encounterId: number | null,
): IntakeBundleSection[] {
  const sections: IntakeBundleSection[] = [];

  // Demographics — single section. The intake extractor emits split name
  // fields directly (`legal_name_first` / `legal_name_last` /
  // `legal_name_middle`); `name` (combined) is a legacy alias from older
  // fixtures that we still tolerate. PHP `DemographicsUpdatePayload`'s
  // ALLOWED_KEYS is `first_name`, `last_name`, `middle_name`, `dob`,
  // `sex`, `contact_phone` — keep the bundle payload to that exact set or
  // it gets rejected as `unsupported_payload`.
  const demo = ext['demographics'] as Record<string, unknown> | undefined;
  const demoPayload: Record<string, unknown> = {};
  if (demo !== undefined && demo !== null) {
    const firstSplit = typeof demo['legal_name_first'] === 'string' ? (demo['legal_name_first'] as string).trim() : '';
    const lastSplit = typeof demo['legal_name_last'] === 'string' ? (demo['legal_name_last'] as string).trim() : '';
    const middleSplit = typeof demo['legal_name_middle'] === 'string' ? (demo['legal_name_middle'] as string).trim() : '';
    if (firstSplit !== '') {
      demoPayload['first_name'] = firstSplit;
    }
    if (lastSplit !== '') {
      demoPayload['last_name'] = lastSplit;
    }
    if (middleSplit !== '') {
      demoPayload['middle_name'] = middleSplit;
    }
    // Fallback: legacy fixtures that emit a single combined `name`.
    if (firstSplit === '' && lastSplit === '' && typeof demo['name'] === 'string' && (demo['name'] as string).trim() !== '') {
      const parts = (demo['name'] as string).trim().split(/\s+/);
      if (parts.length >= 1 && parts[0] !== undefined && parts[0] !== '') {
        demoPayload['first_name'] = parts[0];
      }
      if (parts.length >= 2) {
        const last = parts[parts.length - 1];
        if (last !== undefined && last !== '') {
          demoPayload['last_name'] = last;
        }
      }
    }
    if (typeof demo['dob'] === 'string' && (demo['dob'] as string).trim() !== '') {
      demoPayload['dob'] = (demo['dob'] as string).trim();
    }
    if (typeof demo['sex'] === 'string' && (demo['sex'] as string).trim() !== '') {
      demoPayload['sex'] = (demo['sex'] as string).trim();
    }
    if (typeof demo['contact_phone'] === 'string' && (demo['contact_phone'] as string).trim() !== '') {
      demoPayload['contact_phone'] = (demo['contact_phone'] as string).trim();
    }
  }
  if (Object.keys(demoPayload).length > 0) {
    sections.push({
      section_id: 'demographics',
      title: 'Demographics',
      write_target: 'demographics_update',
      encounter_id: null,
      payload: demoPayload,
      rejected: false,
    });
  }

  // Chief concern — encounter-bound. Skipped when no encounter is bound
  // (the rail launched without one); the rest of the bundle still
  // confirms.
  const chief = ext['chief_concern'] as { text?: unknown } | undefined;
  if (typeof chief?.text === 'string' && chief.text.trim() !== '' && encounterId !== null) {
    sections.push({
      section_id: 'chief_concern',
      title: 'Chief concern',
      write_target: 'chief_complaint',
      encounter_id: encounterId,
      payload: { reason: chief.text.trim() },
      rejected: false,
    });
  }

  // Medications — list-shaped section. PHP `MedicationAddPayload` accepts
  // `name | dose | frequency | sig | indication | begdate | enddate`;
  // pull through every field the extractor emitted so the chart write
  // captures the full medication row (the agent extracts indication +
  // begdate + sig from richer intake forms).
  const medsRaw = Array.isArray(ext['current_medications']) ?
    (ext['current_medications'] as ReadonlyArray<Record<string, unknown>>)
  : [];
  const medItems: IntakeBundleItem[] = [];
  medsRaw.forEach((m, idx) => {
    const name = typeof m['name'] === 'string' ? (m['name'] as string).trim() : '';
    if (name === '') {
      return;
    }
    const itemPayload: Record<string, unknown> = { name };
    for (const key of ['dose', 'frequency', 'sig', 'indication', 'begdate', 'enddate'] as const) {
      const v = m[key];
      if (typeof v === 'string' && v.trim() !== '') {
        itemPayload[key] = v.trim();
      }
    }
    medItems.push({
      item_id: `med-${idx + 1}`,
      write_target: 'medication_add',
      encounter_id: null,
      payload: itemPayload,
      rejected: false,
    });
  });
  if (medItems.length > 0) {
    sections.push({ section_id: 'medications', title: 'Medications', items: medItems });
  }

  // Allergies — list-shaped section. PHP `AllergyWritePayload` enforces
  // strict allowlists for both `reaction` (must be one of the
  // `list_options.list_id='reaction'` ids: unassigned / hives / nausea /
  // shortness_of_breath / other) and `severity` (severity_ccda option_ids
  // plus `life_threatening` / `unknown` legacy aliases). Apply the same
  // normalizers `propose_allergy_write` uses so the bundle's free-text
  // extractions ("Hives", "shortness of breath") survive PHP parse.
  const allergiesRaw = Array.isArray(ext['allergies']) ?
    (ext['allergies'] as ReadonlyArray<Record<string, unknown>>)
  : [];
  const allergyItems: IntakeBundleItem[] = [];
  allergiesRaw.forEach((a, idx) => {
    const substance = typeof a['substance'] === 'string' ? (a['substance'] as string).trim() : '';
    if (substance === '') {
      return;
    }
    const itemPayload: Record<string, unknown> = {
      action: 'add',
      substance: normalizeSubstance(substance),
    };
    const reaction = typeof a['reaction'] === 'string' ? (a['reaction'] as string).trim() : '';
    if (reaction !== '') {
      itemPayload['reaction'] = normalizeReactionToOptionId(reaction);
    }
    const severity = typeof a['severity'] === 'string' ? (a['severity'] as string).trim() : '';
    if (severity !== '') {
      itemPayload['severity'] = severity;
    }
    allergyItems.push({
      item_id: `alg-${idx + 1}`,
      write_target: 'allergy',
      encounter_id: null,
      payload: itemPayload,
      rejected: false,
    });
  });
  if (allergyItems.length > 0) {
    sections.push({ section_id: 'allergies', title: 'Allergies', items: allergyItems });
  }

  // Family history — list-shaped section. PHP `FamilyHistoryAddPayload`
  // accepts `relation | condition | age_of_onset | deceased`; plumb both
  // optional fields when the extractor populated them.
  const familyRaw = Array.isArray(ext['family_history']) ?
    (ext['family_history'] as ReadonlyArray<Record<string, unknown>>)
  : [];
  const familyItems: IntakeBundleItem[] = [];
  familyRaw.forEach((f, idx) => {
    const relation = typeof f['relation'] === 'string' ? (f['relation'] as string).trim().toLowerCase() : '';
    const condition = typeof f['condition'] === 'string' ? (f['condition'] as string).trim() : '';
    if (relation === '' || condition === '') {
      return;
    }
    const itemPayload: Record<string, unknown> = { relation, condition };
    if (typeof f['age_of_onset'] === 'string' && (f['age_of_onset'] as string).trim() !== '') {
      itemPayload['age_of_onset'] = (f['age_of_onset'] as string).trim();
    }
    if (f['deceased'] === true) {
      itemPayload['deceased'] = true;
    } else if (f['deceased'] === false) {
      itemPayload['deceased'] = false;
    }
    familyItems.push({
      item_id: `fam-${idx + 1}`,
      write_target: 'family_history_add',
      encounter_id: null,
      payload: itemPayload,
      rejected: false,
    });
  });
  if (familyItems.length > 0) {
    sections.push({ section_id: 'family_history', title: 'Family history', items: familyItems });
  }

  return sections;
}

/**
 * Render-ready preview line for a bundle, derived from its section list.
 * Format: "Demographics · 3 medications · 2 allergies · 1 family history".
 * The bundle review modal can recompute this client-side from the
 * payload after a section gets rejected — see preview_formatters.ts's
 * `formatPreview('bundle', payload)` consumer.
 */
function formatIntakeBundlePreview(sections: IntakeBundleSection[]): string {
  const parts: string[] = [];
  for (const s of sections) {
    if ('items' in s) {
      const live = s.items.filter((it) => !it.rejected);
      if (live.length === 0) {
        continue;
      }
      const noun = pluralizeBundleSection(s.section_id, live.length);
      parts.push(`${live.length} ${noun}`);
    } else if (!s.rejected) {
      parts.push(s.title);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : 'Intake form';
}

function pluralizeBundleSection(sectionId: string, count: number): string {
  if (sectionId === 'medications') {
    return count === 1 ? 'medication' : 'medications';
  }
  if (sectionId === 'allergies') {
    return count === 1 ? 'allergy' : 'allergies';
  }
  if (sectionId === 'family_history') {
    return count === 1 ? 'family-history entry' : 'family-history entries';
  }
  return sectionId;
}

/**
 * Format a `LabPdfExtraction` (loose-typed because we receive it through
 * the tool-result envelope) into a clinical-note body. Layout chosen for
 * physician readability + downstream chart_context_reads parsability:
 *
 *   Lab Summary — <performing_lab>, collected <date>
 *   • LDL: 158 mg/dL (HIGH; ref 0–99)
 *   • HDL: 48 mg/dL (LOW; ref 40–60)
 *   • ...
 *
 * Uses bullet glyphs + UPPERCASE flags so the abnormal results stand
 * out when rendered as plaintext in the OpenEMR clinical-note panel.
 */
function formatLabSummaryNoteBody(ext: Record<string, unknown>): string {
  const performingLab = typeof ext['performing_lab'] === 'string' ? (ext['performing_lab'] as string) : null;
  const orderingProvider = typeof ext['ordering_provider'] === 'string' ? (ext['ordering_provider'] as string) : null;
  const panelName = typeof ext['panel_name'] === 'string' ? (ext['panel_name'] as string) : null;
  const interpretiveComments = typeof ext['interpretive_comments'] === 'string' ? (ext['interpretive_comments'] as string) : null;
  const results = Array.isArray(ext['results']) ? (ext['results'] as ReadonlyArray<Record<string, unknown>>) : [];
  if (results.length === 0) {
    return '';
  }

  // Prefer the top-level date_collected; fall back to the first result's
  // collection_date — labs typically have a single collection per panel.
  const topLevelCollectedRaw = typeof ext['date_collected'] === 'string' ? (ext['date_collected'] as string) : null;
  const collectionDate =
    topLevelCollectedRaw !== null && topLevelCollectedRaw !== ''
      ? topLevelCollectedRaw
      : (typeof results[0]?.['collection_date'] === 'string' ? (results[0]?.['collection_date'] as string) : null);

  const headerParts: string[] = ['Lab Summary'];
  if (panelName !== null && panelName !== '') {
    headerParts.push(panelName);
  } else if (performingLab !== null && performingLab !== '') {
    headerParts.push(performingLab);
  }
  if (collectionDate !== null && collectionDate !== '') {
    headerParts.push(`collected ${collectionDate}`);
  }
  const header = headerParts.join(' — ');

  const lines: string[] = [header];
  // Performing lab is shown on its own line when the panel_name is what made
  // it into the header — keeps the lab provenance visible without crowding the title.
  if (panelName !== null && panelName !== '' && performingLab !== null && performingLab !== '') {
    lines.push(performingLab);
  }
  if (orderingProvider !== null && orderingProvider !== '') {
    lines.push(`Ordered by ${orderingProvider}`);
  }
  lines.push('');

  for (const r of results) {
    const name = typeof r['test_name'] === 'string' ? (r['test_name'] as string) : '(unnamed test)';
    const valueRaw = r['value'];
    const value = typeof valueRaw === 'number' || typeof valueRaw === 'string' ? String(valueRaw) : '?';
    const unit = typeof r['unit'] === 'string' ? (r['unit'] as string) : '';
    const flagRaw = typeof r['abnormal_flag'] === 'string' ? (r['abnormal_flag'] as string) : 'unknown';
    const flag = flagRaw === 'normal' || flagRaw === 'unknown' ? '' : flagRaw.toUpperCase();
    const refLow = r['reference_range_low'];
    const refHigh = r['reference_range_high'];
    const refText = typeof r['reference_range_text'] === 'string' ? (r['reference_range_text'] as string) : '';
    const refParts: string[] = [];
    if (typeof refLow === 'number' || typeof refHigh === 'number') {
      refParts.push(`ref ${refLow ?? '?'}–${refHigh ?? '?'}`);
    } else if (refText !== '') {
      refParts.push(`ref ${refText}`);
    }
    const flagAndRef =
      flag !== '' && refParts.length > 0 ? ` (${flag}; ${refParts.join('; ')})`
      : flag !== '' ? ` (${flag})`
      : refParts.length > 0 ? ` (${refParts.join('; ')})`
      : '';
    const unitSuffix = unit !== '' ? ` ${unit}` : '';
    let resultLine = `• ${name}: ${value}${unitSuffix}${flagAndRef}`;
    // Per-result comment on a continuation line (rare but valuable when present).
    const resultComments = typeof r['result_comments'] === 'string' ? (r['result_comments'] as string) : null;
    if (resultComments !== null && resultComments.trim() !== '') {
      resultLine += `\n    ${resultComments.trim()}`;
    }
    lines.push(resultLine);
  }

  // Free-text interpretive paragraph from the lab — what makes this note actionable.
  // Without it, the bullets are just numbers; with it, the note tells the physician
  // what the lab thinks the numbers mean and what guideline action to consider.
  if (interpretiveComments !== null && interpretiveComments.trim() !== '') {
    lines.push('');
    lines.push('Interpretive Comments:');
    lines.push(interpretiveComments.trim());
  }

  return lines.join('\n');
}
