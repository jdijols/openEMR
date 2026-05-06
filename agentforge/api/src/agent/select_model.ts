/**
 * §7 / G2-Early-11 — Per-worker model selection.
 *
 * Each worker invocation passes through `selectModel(workerName)` rather than
 * calling a globally-pinned model. The map below is the single source of
 * truth for which Anthropic model each worker uses; swapping a worker's
 * model is a one-line change here without touching call sites.
 *
 * For W2 MVP every LLM-bearing worker uses Haiku 4.5. The capability to
 * assign different models per worker is built in from day one — adding a
 * critic worker on Sonnet 4.6 in a future cycle stays additive.
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
  supervisor: 'claude-haiku-4-5',
  intake_extractor: 'claude-haiku-4-5',
  evidence_retriever: null,
  critic: null, // placeholder — would map to 'claude-sonnet-4-6' when added
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
