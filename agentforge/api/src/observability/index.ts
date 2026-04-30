import type { Env } from '../env.js';

export type TurnTraceHandle = {
  readonly id: string;
  readonly correlationId: string;
};

export type Observability = {
  traceTurn: (input: { correlationId: string; turnName?: string }) => Promise<TurnTraceHandle>;
  recordToolCall: (input: {
    correlationId: string;
    toolName: string;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
  recordLlmCall: (input: {
    correlationId: string;
    providerModel: string;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
};

/**
 * Langfuse wiring lands in Gate 6; if optional client factory throws, we keep serving turns.
 */
export function createObservability(
  _env: Env,
  options?: {
    createLangfuseClient?: () => unknown;
  },
): Observability {
  let langfuseReady = false;
  if (options?.createLangfuseClient !== undefined) {
    try {
      const client = options.createLangfuseClient();
      langfuseReady = client != null;
    } catch {
      langfuseReady = false;
    }
  }

  return {
    async traceTurn(input) {
      if (langfuseReady) {
        // Gate 6 — map to Langfuse trace API
      }
      return { id: 'noop', correlationId: input.correlationId };
    },
    async recordToolCall(_input) {
      if (langfuseReady) {
        // Gate 6
      }
    },
    async recordLlmCall(_input) {
      if (langfuseReady) {
        // Gate 6
      }
    },
  };
}
