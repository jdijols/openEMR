import { tool } from 'ai';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { Observability } from '../observability/index.js';
import { assertBoundPatient } from './_binding.js';
import { runIntakeExtractor, type IntakeExtractorDeps, type IntakeExtractorResult } from '../workers/intake_extractor.js';
import { recordSupervisorHandoff, summarizeIntakeExtractorHandoff } from '../agent/handoff.js';

/**
 * §5 / §7 / G2-MVP-35 — `attach_and_extract` tool surface (brief signature).
 *
 * Input shape mirrors the brief's `attach_and_extract(patient_id, file_path,
 * doc_type)` — `patient_uuid` is the chart-bound canonical UUID; `docref_uuid`
 * is our reconciliation of "file_path" (logical handle for bytes already
 * stored by the upload entry; idempotent on `(patient_uuid, sha256)`); and
 * `doc_type` is the §6 enum.
 *
 * Cross-patient defense in depth (S1) — `assertBoundPatient` blocks the
 * tool BEFORE any HTTP call to the module's DocBytes endpoint, so the
 * supervisor cannot smuggle a foreign-patient DocRef into the worker.
 */

const AttachAndExtractInputSchema = z.object({
  patient_uuid: z.string().min(1),
  docref_uuid: z.string().min(1),
  doc_type: z.enum(['lab_pdf', 'intake_form']),
});

export type AttachAndExtractInput = z.infer<typeof AttachAndExtractInputSchema>;

export type DocumentBytesFetcher = (args: {
  readonly docrefUuid: string;
  readonly patientUuidCanonical: string;
}) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string } | null>;

/**
 * G2-Final-FB-B-01 — persistence callback. Invoked by `runAttachAndExtract`
 * after a `lab_pdf` extraction returns with `crossCheckStatus === 'verified'`.
 * Production wires this to `postModuleJson('write/observation_from_extraction.php', ...)`;
 * tests inject a deterministic stub.
 */
export type ObservationPersister = (args: {
  readonly patientUuidCanonical: string;
  readonly docrefUuid: string;
  readonly results: ReadonlyArray<Readonly<Record<string, unknown>>>;
}) => Promise<{ readonly inserted: number; readonly updated: number; readonly failed: number }>;

export type AttachAndExtractDeps = {
  readonly env: Env;
  readonly sessionToken: string;
  readonly correlationId: string;
  readonly observability: Observability;
  readonly fetchBytes: DocumentBytesFetcher;
  readonly extractorDeps: IntakeExtractorDeps;
  /** Optional — when absent, persistence is skipped (test convenience). */
  readonly persistObservations?: ObservationPersister;
};

export type PersistenceOutcome = {
  readonly attempted: boolean;
  readonly inserted: number;
  readonly updated: number;
  readonly failed: number;
  /** Set when the verification gate skipped persistence (S14). */
  readonly skipped_reason?: 'cross_check_failed' | 'schema_invalid' | 'not_lab_pdf' | 'no_persister';
};

export type AttachAndExtractOutput =
  | {
      readonly ok: true;
      readonly result: IntakeExtractorResult;
      /** G2-Final-FB-A-02 — wall-clock for the orchestrator's `agent_step` strip. */
      readonly duration_ms: number;
      /** G2-Final-FB-B-01 — observation persistence outcome (lab_pdf only). */
      readonly persistence: PersistenceOutcome;
    }
  | {
      readonly ok: false;
      readonly error: 'active_chart_mismatch' | 'document_not_found' | 'openemr_error';
      readonly duration_ms: number;
    };

export function createAttachAndExtractTool(deps: AttachAndExtractDeps) {
  return tool({
    description:
      'Read a previously-uploaded clinical document (lab PDF or intake form) and extract structured facts with verbatim citations. Every fact carries a source citation per W2 contract; PDFs add a deterministic cross-check and a bounding-box overlay.',
    inputSchema: AttachAndExtractInputSchema,
    execute: async ({ patient_uuid, docref_uuid, doc_type }): Promise<AttachAndExtractOutput> => {
      return runAttachAndExtract({ patient_uuid, docref_uuid, doc_type }, deps);
    },
  });
}

/**
 * Pure helper exported for isolated tests. Performs the full tool flow
 * without going through the Vercel AI SDK `tool()` wrapper.
 */
export async function runAttachAndExtract(
  input: AttachAndExtractInput,
  deps: AttachAndExtractDeps,
): Promise<AttachAndExtractOutput> {
  // G2-Final-FB-A-02 — capture wall-clock so every exit path can populate
  // `duration_ms` on the output envelope (used by `synthesizeAgentSteps`).
  const startedAtMs = Date.now();

  const bound = assertBoundPatient(deps.env, deps.sessionToken, input.patient_uuid);
  if (!bound.ok) {
    return { ok: false, error: 'active_chart_mismatch', duration_ms: Date.now() - startedAtMs };
  }

  // §7 / G2-Early-10 — supervisor → intake_extractor handoff event. Emitted
  // BEFORE the tool span so the handoff appears as the first node of this
  // worker's trace branch, with PHI-safe input_summary and one-sentence
  // routing rationale.
  await recordSupervisorHandoff(
    deps.observability,
    deps.correlationId,
    'intake_extractor',
    summarizeIntakeExtractorHandoff({ docrefUuid: input.docref_uuid, docType: input.doc_type }),
  );

  const span = await deps.observability.recordToolCall({
    correlationId: deps.correlationId,
    toolName: 'attach_and_extract',
    meta: { doc_type: input.doc_type, docref_uuid_prefix: input.docref_uuid.slice(0, 8) },
  });

  try {
    const fetched = await deps.fetchBytes({
      docrefUuid: input.docref_uuid,
      patientUuidCanonical: input.patient_uuid,
    });

    if (fetched === null) {
      await span.end({ meta: { outcome: 'document_not_found' } });
      return { ok: false, error: 'document_not_found', duration_ms: Date.now() - startedAtMs };
    }

    const result = await runIntakeExtractor(
      {
        docrefUuid: input.docref_uuid,
        patientUuidCanonical: input.patient_uuid,
        docType: input.doc_type,
        fileBytes: fetched.bytes,
        mimeType: fetched.mimeType,
      },
      deps.extractorDeps,
    );

    // §12 / G2-Early-51 — required Langfuse `extraction confidence` fields.
    // Walks the §6 extraction object once to derive: VLM-reported overall
    // confidence, count of fields the VLM flagged uncertain, and a
    // per-fact confidence summary (bucketed counts across all citations).
    const confidence = summarizeExtractionConfidence(result);

    // G2-Final-FB-B-01 — persist observations when (a) lab_pdf, (b) schema
    // valid, (c) cross-check verified. Anything else routes to the FB-B-02
    // refusal path via `persistence.skipped_reason` — orchestrator
    // synthesizes the user-facing refusal block from this.
    const persistence = await maybePersistObservations(input, result, deps);

    await span.end({
      meta: {
        outcome: 'ok',
        schema_valid: result.schemaValid,
        cross_check_status: result.crossCheckStatus,
        facts_total: result.factsTotal,
        facts_verified: result.factsVerified,
        overall_confidence: confidence.overallConfidence,
        fields_uncertain_count: confidence.fieldsUncertainCount,
        per_fact_confidence_summary: confidence.perFactConfidenceSummary,
        persistence_attempted: persistence.attempted,
        persistence_inserted: persistence.inserted,
        persistence_updated: persistence.updated,
        persistence_failed: persistence.failed,
        persistence_skipped_reason: persistence.skipped_reason ?? null,
      },
    });

    return {
      ok: true,
      result,
      duration_ms: Date.now() - startedAtMs,
      persistence,
    };
  } catch (e) {
    // Print the underlying exception so dev tail can debug without a Langfuse round-trip.
    console.error('attach_and_extract_threw', {
      correlation_id: deps.correlationId,
      doc_type: input.doc_type,
      docref_uuid_prefix: input.docref_uuid.slice(0, 8),
      error_message: e instanceof Error ? e.message : String(e),
      error_name: e instanceof Error ? e.name : 'unknown',
      stack_head: e instanceof Error && typeof e.stack === 'string' ? e.stack.split('\n').slice(0, 5).join('\n') : null,
    });
    await span.end({ error: e });
    return { ok: false, error: 'openemr_error', duration_ms: Date.now() - startedAtMs };
  }
}

/**
 * §12 / G2-Early-51 — derive PHI-safe extraction-confidence metadata for the
 * intake_extractor span. Walks the §6 extraction object once and reports:
 *
 *   - `overallConfidence`  — VLM-reported `extraction_metadata.overall_confidence`
 *   - `fieldsUncertainCount` — length of `extraction_metadata.fields_uncertain`
 *   - `perFactConfidenceSummary` — bucketed counts of per-citation `confidence`
 *                                  values across every leaf citation in the
 *                                  extraction (high / medium / low / missing).
 *
 * No PHI surfaces here: only category counts, not the underlying values.
 */
type ExtractionConfidenceSummary = {
  readonly overallConfidence: 'high' | 'medium' | 'low' | 'unknown';
  readonly fieldsUncertainCount: number;
  readonly perFactConfidenceSummary: Readonly<{
    high: number;
    medium: number;
    low: number;
    missing: number;
  }>;
};

function summarizeExtractionConfidence(
  result: IntakeExtractorResult,
): ExtractionConfidenceSummary {
  if (result.extraction === null) {
    return {
      overallConfidence: 'unknown',
      fieldsUncertainCount: 0,
      perFactConfidenceSummary: { high: 0, medium: 0, low: 0, missing: 0 },
    };
  }
  const meta = result.extraction.extraction_metadata;
  const overallConfidence = meta.overall_confidence;
  const fieldsUncertainCount = meta.fields_uncertain.length;

  // Walk every leaf citation across both schema shapes and bucket
  // each citation's `confidence` value.
  const buckets = { high: 0, medium: 0, low: 0, missing: 0 };
  const visit = (c: { confidence?: number } | undefined): void => {
    if (c === undefined) return;
    const v = c.confidence;
    if (typeof v !== 'number') {
      buckets.missing += 1;
      return;
    }
    if (v >= 0.8) buckets.high += 1;
    else if (v >= 0.5) buckets.medium += 1;
    else buckets.low += 1;
  };

  if (result.extraction.document_type === 'lab_pdf') {
    for (const r of result.extraction.results) {
      visit(r.citation);
    }
  } else {
    visit(result.extraction.demographics.citation);
    visit(result.extraction.chief_concern.citation);
    for (const m of result.extraction.current_medications) visit(m.citation);
    for (const a of result.extraction.allergies) visit(a.citation);
    for (const f of result.extraction.family_history) visit(f.citation);
  }

  return {
    overallConfidence,
    fieldsUncertainCount,
    perFactConfidenceSummary: buckets,
  };
}

/**
 * G2-Final-FB-B-01 — gate persistence by the W2 invariants.
 *
 *   - Only `lab_pdf` extractions persist (intake_form takes the W1 propose-write path).
 *   - Schema must be valid (otherwise no extraction shape to write).
 *   - PDF cross-check must be `verified` (S14 — facts whose `quote_or_value`
 *     was not present in the source PDF text MUST NOT persist).
 *   - Persister must be wired (no-op when absent — keeps test paths simple).
 *
 * Per-row failures are aggregated into the persistence outcome; the worker's
 * span and the chat-side refusal copy use `skipped_reason` to explain to the
 * reviewer why no rows landed.
 */
async function maybePersistObservations(
  input: AttachAndExtractInput,
  result: IntakeExtractorResult,
  deps: AttachAndExtractDeps,
): Promise<PersistenceOutcome> {
  if (input.doc_type !== 'lab_pdf') {
    return { attempted: false, inserted: 0, updated: 0, failed: 0, skipped_reason: 'not_lab_pdf' };
  }
  if (!result.schemaValid || result.extraction === null) {
    return { attempted: false, inserted: 0, updated: 0, failed: 0, skipped_reason: 'schema_invalid' };
  }
  if (result.crossCheckStatus !== 'verified') {
    // S14 / FB-B-02 — unverified facts MUST NOT persist. The orchestrator
    // synthesizes a user-facing refusal block from this signal.
    return { attempted: false, inserted: 0, updated: 0, failed: 0, skipped_reason: 'cross_check_failed' };
  }
  if (deps.persistObservations === undefined) {
    return { attempted: false, inserted: 0, updated: 0, failed: 0, skipped_reason: 'no_persister' };
  }

  if (result.extraction.document_type !== 'lab_pdf') {
    // Defensive: schema-valid + lab_pdf doc_type should match, but if the
    // shape disagrees (impossible after Zod parse), treat as schema_invalid.
    return { attempted: false, inserted: 0, updated: 0, failed: 0, skipped_reason: 'schema_invalid' };
  }

  // Strip the per-result `citation` envelope before persistence — citations
  // already live in the DocumentReference's `derivedFrom` linkage; carrying
  // them into the Observation row body bloats storage and risks PHI in
  // payload bodies (S11 deny-list applies to spans, not row bodies, but
  // the principle is the same: minimum payload surface).
  const rows = result.extraction.results.map((r) => ({
    test_name: r.test_name,
    loinc: r.loinc,
    value: r.value,
    unit: r.unit,
    reference_range_low: r.reference_range_low,
    reference_range_high: r.reference_range_high,
    reference_range_text: r.reference_range_text,
    collection_date: r.collection_date,
    abnormal_flag: r.abnormal_flag,
  }));

  try {
    const out = await deps.persistObservations({
      patientUuidCanonical: input.patient_uuid,
      docrefUuid: input.docref_uuid,
      results: rows,
    });
    return {
      attempted: true,
      inserted: out.inserted,
      updated: out.updated,
      failed: out.failed,
    };
  } catch (e) {
    console.error('attach_and_extract_persistence_threw', {
      doc_type: input.doc_type,
      docref_uuid_prefix: input.docref_uuid.slice(0, 8),
      error_name: e instanceof Error ? e.name : 'unknown',
    });
    return { attempted: true, inserted: 0, updated: 0, failed: rows.length };
  }
}
