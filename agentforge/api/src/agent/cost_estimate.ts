/**
 * Gate 3 (G3-13) — tiny in-repo heuristic rates (USD). Not invoicing-grade; PHI-free.
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
