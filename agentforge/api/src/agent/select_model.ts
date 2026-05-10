/**
 * §7 / G2-Early-11 — Per-worker model selection.
 *
 * Each worker invocation passes through `selectModel(workerName)` rather than
 * calling a globally-pinned model. The map below is the single source of
 * truth for which Anthropic model each worker uses; swapping a worker's
 * model is a one-line change here without touching call sites.
 *
 * Phase 4 — bumped from Haiku 4.5 to Sonnet 4.6 across the board. The QA
 * harness exercises 8 intake / lab forms with diverse layouts; Sonnet's
 * extraction quality on under-specified or unusual form layouts is
 * meaningfully higher than Haiku's, which dominates the cost difference
 * for our workload (a handful of forms per QA pass, not a high-throughput
 * inference loop). Latency cost (~2× Haiku) is acceptable because intake
 * extraction is one-shot per upload, not a per-keystroke round-trip.
 *
 * `evidence_retriever` is intentionally `null` — it is deterministic
 * post-processing (sparse + dense + Cohere rerank), no LLM in the worker.
 * Supervisor synthesis happens in the supervisor's own LLM call, not here.
 */

export type WorkerName =
  | 'supervisor'
  | 'intake_extractor'
  | 'evidence_retriever'
  | 'critic';

export type WorkerModel = string | null;

const WORKER_MODELS: Readonly<Record<WorkerName, WorkerModel>> = {
  supervisor: 'claude-sonnet-4-6',
  intake_extractor: 'claude-sonnet-4-6',
  evidence_retriever: null,
  critic: null,
};

export class UnknownWorkerError extends Error {
  override readonly name = 'UnknownWorkerError';
  readonly worker: string;
  constructor(worker: string) {
    super(`unknown worker: ${worker}`);
    this.worker = worker;
  }
}

/**
 * Returns the configured model for a worker, or `null` for workers that do
 * not call an LLM. Throws `UnknownWorkerError` for any worker name not in
 * the registry — fail loud rather than silently fall back to a default.
 */
export function selectModel(workerName: WorkerName | string): WorkerModel {
  if (!Object.prototype.hasOwnProperty.call(WORKER_MODELS, workerName)) {
    throw new UnknownWorkerError(String(workerName));
  }
  return WORKER_MODELS[workerName as WorkerName];
}

export const WORKER_MODELS_FOR_TEST: typeof WORKER_MODELS = WORKER_MODELS;
