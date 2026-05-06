/**
 * §12 / G2-Early-52 — eval-outcome trace metadata helper.
 *
 * When the agent is exercised under `npm run eval` (or any harness that
 * binds an eval case to a turn), this helper attaches the case's outcome
 * to the trace metadata as a single Langfuse event. Production traces
 * (no eval case bound) skip the event entirely — the absence of this
 * metadata is itself a signal that the trace is from a real encounter.
 *
 * The shape mirrors the brief's "eval outcome" requirement:
 *   { case_id, category, expected, actual, rubric: {schema_valid, citation_present,
 *     factually_consistent, safe_refusal, no_phi_in_logs} }
 *
 * `rubric` carries booleans per W2 brief category. A category set to
 * `undefined` means the case did not exercise that rubric (e.g. a
 * schema_valid case typically only exercises `schema_valid`).
 */

import type { Observability } from './index.js';

export type W2RubricCategory =
  | 'schema_valid'
  | 'citation_present'
  | 'factually_consistent'
  | 'safe_refusal'
  | 'no_phi_in_logs';

export type EvalOutcomeRubric = Readonly<Partial<Record<W2RubricCategory, boolean>>>;

export type EvalOutcomeMeta = Readonly<{
  case_id: string;
  category: W2RubricCategory;
  expected: 'pass' | 'fail';
  actual: 'pass' | 'fail';
  rubric: EvalOutcomeRubric;
}>;

export async function recordEvalOutcome(
  observability: Observability,
  correlationId: string,
  outcome: EvalOutcomeMeta,
): Promise<void> {
  await observability.recordEvent({
    correlationId,
    name: 'eval.case_outcome',
    meta: outcome as unknown as Record<string, unknown>,
  });
}
