/**
 * §7 / G2-Early-10 — Supervisor handoff event helper.
 *
 * Every supervisor → worker handoff is recorded as a Langfuse event named
 * `handoff.<workerName>` carrying structured metadata:
 *
 *   { from: 'supervisor', to: <worker>, reason: <one-sentence>,
 *     input_summary: <PHI-safe>, decided_at: <ISO> }
 *
 * The reason and input-summary shapes come from W2_ARCHITECTURE.md §7. The
 * helper exists so individual worker tools (`attach_and_extract`,
 * `evidence_retrieve`) emit handoff metadata in a consistent shape — the
 * supervisor's routing decisions are auditable, queryable by turn id, and
 * enforceably PHI-free at the wire boundary.
 *
 * Inspectability guarantee (W2_ARCHITECTURE.md §7): a peer or grader can
 * open any turn in Langfuse, expand the supervisor span, and read every
 * routing decision with rationale.
 */

import type { Observability } from '../observability/index.js';

export type WorkerName = 'intake_extractor' | 'evidence_retriever';

export type HandoffMeta = {
  readonly from: 'supervisor';
  readonly to: WorkerName;
  readonly reason: string;
  readonly input_summary: Readonly<Record<string, unknown>>;
  readonly decided_at: string;
};

/**
 * Build a PHI-safe input summary for a handoff to `intake_extractor`.
 * Only structural / size / type metadata leaves this process — the actual
 * document bytes are summarized into `{ size_bytes, mime }` by the redactor
 * downstream when the worker span fires; here we capture only the supervisor's
 * pre-dispatch knowledge: the docref prefix + doc_type.
 */
export function summarizeIntakeExtractorHandoff(input: {
  readonly docrefUuid: string;
  readonly docType: 'lab_pdf' | 'intake_form';
}): Readonly<Record<string, unknown>> {
  return {
    docref_uuid_prefix: input.docrefUuid.slice(0, 8),
    doc_type: input.docType,
  };
}

/**
 * Build a PHI-safe input summary for a handoff to `evidence_retriever`.
 * The query text itself is PHI-bearing (free-text patient observations
 * concatenated with the question) — capture only its length + the chunk
 * budget so the supervisor's routing decision is inspectable without
 * leaking the question body to the trace.
 */
export function summarizeEvidenceRetrieverHandoff(input: {
  readonly query: string;
  readonly maxChunks: number;
}): Readonly<Record<string, unknown>> {
  return {
    query_chars: input.query.length,
    max_chunks: input.maxChunks,
  };
}

/**
 * One-sentence routing rationales per worker. These map to the explicit
 * branches in `CLINICAL_SYSTEM_PROMPT` so a reviewer can correlate trace
 * entries to the prompt rule that triggered them.
 */
export const HANDOFF_REASONS: Readonly<Record<WorkerName, string>> = {
  intake_extractor:
    'docref_uuid present in turn input; supervisor routed to intake_extractor before answering.',
  evidence_retriever:
    'user question contains evidence-seeking language; supervisor routed to evidence_retriever for guideline grounding.',
};

/**
 * Physician-facing label per worker. Surfaced live above the CUI typing
 * indicator while the worker runs (akin to Claude's "Reading file…" /
 * "Editing file…" affordance — verb + concrete object). Centralized here
 * so the supervisor's two routing decisions and the CUI's two labels stay
 * in lockstep; if a third worker is added the label travels with it.
 */
export const WORKER_LABEL: Readonly<Record<WorkerName, string>> = {
  intake_extractor: 'Reading file',
  evidence_retriever: 'Searching evidence',
};

/**
 * Live-routing emitter. Invoked by each worker tool the moment the
 * supervisor's tool call begins executing — co-located with the
 * `recordSupervisorHandoff` call so the wire signal and the trace event
 * fire from the same point. The orchestrator passes a function bound to
 * the SSE stream's `routing` event; tests pass a no-op.
 *
 * Failure isolation: like `recordSupervisorHandoff`, this is fire-and-
 * forget. Worker tools `await` it so emission ordering is deterministic,
 * but a thrown emitter must never prevent the worker from running.
 */
export type RoutingEvent = {
  readonly worker: WorkerName;
  readonly label: string;
};

export type RoutingEmitter = (event: RoutingEvent) => void | Promise<void>;

/**
 * Emit a handoff event to the observability layer. The event name follows
 * the `handoff.<workerName>` convention so it's filterable in Langfuse.
 *
 * Failure isolation: like the rest of the observability surface, failures
 * inside the SDK never propagate — this helper is fire-and-forget by design
 * (the underlying `recordEvent` already wraps in try/catch).
 */
export async function recordSupervisorHandoff(
  observability: Observability,
  correlationId: string,
  workerName: WorkerName,
  inputSummary: Readonly<Record<string, unknown>>,
  reasonOverride?: string,
): Promise<void> {
  const meta: HandoffMeta = {
    from: 'supervisor',
    to: workerName,
    reason: reasonOverride ?? HANDOFF_REASONS[workerName],
    input_summary: inputSummary,
    decided_at: new Date().toISOString(),
  };
  await observability.recordEvent({
    correlationId,
    name: `handoff.${workerName}`,
    meta: meta as unknown as Record<string, unknown>,
  });
}
