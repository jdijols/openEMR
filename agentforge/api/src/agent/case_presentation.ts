import { generateText } from 'ai';
import { z } from 'zod';
import type { Env } from '../env.js';
import { verifySessionToken } from '../handshake/sessionToken.js';
import { OpenEmrCallError } from '../openemr/client.js';
import type { Observability } from '../observability/index.js';
import { assertBoundPatient } from '../tools/_binding.js';
import { estimateUsdForProviderTokens } from './cost_estimate.js';
import { fetchCasePresentationData } from './case_presentation_fetch.js';
import { casePresentationCacheGet, casePresentationCacheSet } from './case_presentation_cache.js';
import {
  buildPriorVisitSummaryInput,
  buildSimplifiedCasePresentationBlocks,
  findCurrentEncounter,
  previousEncounters,
  type PriorVisitSummary,
} from './case_presentation_format.js';
import { CASE_PRESENTATION_PRIOR_VISIT_SUMMARY_PROMPT } from './case_presentation_prompt.js';
import { getChatModel, getProviderModelId } from './model.js';
import { buildCitationNavigationIndex, buildClinicalToolEvidence, type CitationNavigationHint } from './toolEvidence.js';
import { verifyClinicalBlocks } from './verification.js';
import type { ChatBlock } from '../openemr/types.js';

export type CasePresentationInput = {
  readonly sessionToken: string;
  readonly patientUuid: string;
  readonly forceRefresh?: boolean;
};

type CasePresentationResult = {
  blocks: ChatBlock[];
  citation_navigation: Record<string, CitationNavigationHint>;
};

/**
 * In-flight coalescer: if two callers race past the cache for the same
 * (sessionToken, patientUuid, encounterId) — e.g. the rail container's two
 * auto-fire pings on chart open — they share a single LLM call instead of
 * producing two subtly different briefs.
 *
 * `encounterId` is part of the key for the same reason the cache key is
 * (P3 fix): two concurrent calls under the same token across an encounter
 * change must NOT coalesce, or they'd return a brief scoped to whichever
 * encounter happened to win the race.
 */
const inflight = new Map<string, Promise<CasePresentationResult>>();

const priorVisitSummariesSchema = z.object({
  previous_visits: z.array(
    z.object({
      citation_uuid: z.string().min(1),
      summary: z.string(),
    }),
  ),
});

function inflightKey(sessionToken: string, patientUuid: string, encounterId: number | null): string {
  const enc = encounterId === null ? 'none' : String(encounterId);
  return `${patientUuid}\0${enc}\0${sessionToken}`;
}

/**
 * P3 guard: a brief that came back with zero blocks (transient LLM/provider
 * hiccup) or only refusal blocks (chart_read_failed, etc.) is NOT a usable
 * cached answer. Caching it pins the operator to a blank rail for the full
 * 2-hour TTL with no recovery path short of clicking refresh — which is
 * the exact P3 reproducer. Empty / refusal-only results are returned to the
 * caller (so they see what happened) but never persisted to the cache.
 */
function isCacheable(blocks: readonly ChatBlock[]): boolean {
  if (blocks.length === 0) {
    return false;
  }
  return blocks.some((b) => b.type !== 'refusal');
}

/** Test-only: clear in-flight de-dup map. */
export function __resetCasePresentationInflightForTests(): void {
  inflight.clear();
}

function parsePriorVisitSummaries(
  modelText: string,
  allowedCitationUuids: ReadonlySet<string>,
): readonly PriorVisitSummary[] {
  let raw: unknown;
  try {
    raw = JSON.parse(modelText);
  } catch {
    return [];
  }

  const parsed = priorVisitSummariesSchema.safeParse(raw);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.previous_visits
    .filter((summary) => allowedCitationUuids.has(summary.citation_uuid))
    .map((summary) => ({
      citationUuid: summary.citation_uuid,
      summary: summary.summary,
    }));
}

export async function runCasePresentation(
  env: Env,
  observability: Observability,
  input: CasePresentationInput,
  correlationId: string,
): Promise<CasePresentationResult> {
  const { sessionToken, patientUuid, forceRefresh } = input;

  const bound = assertBoundPatient(env, sessionToken, patientUuid);
  if (!bound.ok) {
    return { blocks: [{ type: 'refusal', reason: 'active_chart_mismatch' }], citation_navigation: {} };
  }

  // P3 fix: encounter_id participates in the cache + inflight key so two
  // encounters on the same patient under the same session token (which can
  // happen when the rail re-mints the launch code mid-session per the P2 fix)
  // do not collide. Token signature/expiry/binding is already verified by
  // `assertBoundPatient`; this re-verify is just to read the claim.
  const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  const encounterId = claims?.encounter_id ?? null;

  if (!forceRefresh) {
    const cached = casePresentationCacheGet(sessionToken, patientUuid, encounterId);
    if (cached !== null) {
      await observability.recordEvent({
        correlationId,
        name: 'case_presentation.cache_hit',
        meta: { cache_hit: true },
      });
      return cached;
    }

    const key = inflightKey(sessionToken, patientUuid, encounterId);
    const pending = inflight.get(key);
    if (pending !== undefined) {
      await observability.recordEvent({
        correlationId,
        name: 'case_presentation.inflight_coalesced',
        meta: { inflight_coalesced: true },
      });
      return pending;
    }

    const promise = runCasePresentationUncached(env, observability, input, correlationId);
    inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      inflight.delete(key);
    }
  }

  return runCasePresentationUncached(env, observability, input, correlationId);
}

async function runCasePresentationUncached(
  env: Env,
  observability: Observability,
  input: CasePresentationInput,
  correlationId: string,
): Promise<CasePresentationResult> {
  const { sessionToken, patientUuid } = input;

  const trace = await observability.traceTurn({ correlationId, turnName: 'case_presentation' });
  const ctx = { sessionToken, correlationId };

  // Token validity (signature, expiry, patient binding) is already gated by
  // `assertBoundPatient` above; this re-verify is just to read claims.
  // - facility_tz: P2 fix — format the brief's `today` in the operator's
  //   facility tz, not UTC.
  // - encounter_id: P3 fix — scope the cache write to this encounter so a
  //   later encounter on the same patient does not pick up this brief.
  const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  const facilityTz = claims?.facility_tz ?? null;
  const encounterId = claims?.encounter_id ?? null;

  let fetched;
  try {
    fetched = await fetchCasePresentationData(env, ctx, patientUuid, facilityTz);
  } catch (e) {
    if (e instanceof OpenEmrCallError) {
      return { blocks: [{ type: 'refusal', reason: 'chart_read_failed' }], citation_navigation: {} };
    }

    throw e;
  }

  const today = typeof fetched.bundleForLlm['today'] === 'string' ? fetched.bundleForLlm['today'] : '';
  const currentEncounter = findCurrentEncounter(fetched.encounters, encounterId, today);
  const previous = previousEncounters(fetched.encounters, currentEncounter);
  const previousVisitInput = buildPriorVisitSummaryInput(fetched, previous);
  const model = getChatModel(env);
  const providerModelId = getProviderModelId(env);
  const userPrompt = `Previous visit context (JSON) for bound patient_uuid=${patientUuid}:\n${JSON.stringify({
    patient_uuid: patientUuid,
    today,
    previous_visits: previousVisitInput,
  })}`;

  await observability.recordLlmCall({
    correlationId,
    providerModel: providerModelId,
    meta: { phase: 'case_presentation_request' },
  });

  const llmStartedAtMs = Date.now();
  const result = await generateText({
    model,
    system: CASE_PRESENTATION_PRIOR_VISIT_SUMMARY_PROMPT,
    prompt: userPrompt,
  });

  const evidence = buildClinicalToolEvidence(patientUuid, fetched.toolResults);
  const allowedPriorCitationUuids = new Set(previousVisitInput.map((visit) => visit.citation_uuid));
  const priorSummaries = parsePriorVisitSummaries(result.text, allowedPriorCitationUuids);
  let blocks = buildSimplifiedCasePresentationBlocks(fetched, encounterId, priorSummaries);
  blocks = await verifyClinicalBlocks(observability, correlationId, blocks, evidence);

  const usage = result.totalUsage;
  const costUsd = estimateUsdForProviderTokens(env.LLM_PROVIDER, usage?.inputTokens, usage?.outputTokens) ?? null;
  const costMeta =
    usage === undefined ?
      {
        phase: 'case_presentation_completed',
        traceId: trace.id,
        start_time_ms: llmStartedAtMs,
        cost_usd: null as number | null,
      }
    : {
        phase: 'case_presentation_completed',
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

  const citation_navigation = buildCitationNavigationIndex(fetched.toolResults);

  if (isCacheable(blocks)) {
    casePresentationCacheSet(sessionToken, patientUuid, encounterId, { blocks, citation_navigation });
  }

  return { blocks, citation_navigation };
}
