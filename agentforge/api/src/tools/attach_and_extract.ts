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

export type AttachAndExtractDeps = {
  readonly env: Env;
  readonly sessionToken: string;
  readonly correlationId: string;
  readonly observability: Observability;
  readonly fetchBytes: DocumentBytesFetcher;
  readonly extractorDeps: IntakeExtractorDeps;
};

export type AttachAndExtractOutput =
  | {
      readonly ok: true;
      readonly result: IntakeExtractorResult;
    }
  | {
      readonly ok: false;
      readonly error: 'active_chart_mismatch' | 'document_not_found' | 'openemr_error';
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
  const bound = assertBoundPatient(deps.env, deps.sessionToken, input.patient_uuid);
  if (!bound.ok) {
    return { ok: false, error: 'active_chart_mismatch' };
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
      return { ok: false, error: 'document_not_found' };
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
      },
    });

    return { ok: true, result };
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
    return { ok: false, error: 'openemr_error' };
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
