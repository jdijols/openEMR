/**
 * Gate 3 (G3-13) — tiny in-repo heuristic rates (USD). Not invoicing-grade; PHI-free.
 *
 * These rates are keyed by provider, NOT by canonical model name, so they are a
 * coarse approximation. The Langfuse-side cost (computed against Langfuse's
 * model-price database keyed on the model name we pass via `getProviderModelId`)
 * is the authoritative number — see OBSERVABILITY.md §Q4 for that path.
 *
 * The values below are the V1 default-deployment rates:
 *   - `anthropic`     → claude-sonnet-4-6 ($3 / $15 per Mtok input / output)
 *   - `openai_azure`  → operator-supplied deployment id, no canonical model;
 *                       leave at a conservative GPT-4-class default until a
 *                       per-deployment table is added
 *   - `openai`        → same conservative default as openai_azure
 *
 * If the operator changes Anthropic's default model (back to Haiku for
 * cheaper bulk inference, or up to Opus for accuracy-critical workloads),
 * update this table or move to a per-model lookup. Langfuse's per-model
 * price database is the authoritative billing source — these rates only
 * power the in-repo dev-tail estimate.
 */

const RATES_USD_PER_MTOK: Partial<Record<string, { input: number; output: number }>> = {
  anthropic: { input: 3.0, output: 15.0 },
  openai_azure: { input: 5.0, output: 15.0 },
  openai: { input: 5.0, output: 15.0 },
};

/**
 * Estimate LLM USD from token counts ($ / 1M tokens). Returns null when unknown provider or counts missing.
 */
export function estimateUsdForProviderTokens(
  providerKey: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | null {
  const r = RATES_USD_PER_MTOK[providerKey.trim().toLowerCase()];
  if (!r || inputTokens === undefined || outputTokens === undefined) {
    return null;
  }

  const inPart = (inputTokens / 1_000_000) * r.input;
  const outPart = (outputTokens / 1_000_000) * r.output;

  return Math.round((inPart + outPart) * 1_000_000) / 1_000_000;
}
