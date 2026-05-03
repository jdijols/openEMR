/**
 * Observability — Langfuse-backed trace surface for the Clinical Copilot.
 *
 * One chat turn = one Langfuse trace, keyed by the request's `correlation_id`.
 * Inside that trace are three step types, each surfaced through a separate
 * method on the `Observability` interface:
 *
 *   - **Spans** (`recordToolCall`)   — tool executions with start + end times
 *                                      and input / output payloads. The caller
 *                                      MUST `await span.end(...)` so latency
 *                                      captures even on failure.
 *   - **Events** (`recordEvent`)     — instantaneous markers: verification
 *                                      gates, security guards, cache hits.
 *                                      No duration, no end call.
 *   - **Generations** (`recordLlmCall`) — LLM calls with model name, token
 *                                      usage, and dollar cost (pulled from
 *                                      Langfuse's model-price database when
 *                                      a canonical model name is passed).
 *
 * Every meta payload runs through the PHI redactor in `redact.ts` before it
 * leaves this process — see OBSERVABILITY.md §"PHI redactor" for the
 * deny-list policy and the deliberate over-redaction trade-off.
 *
 * Failure isolation: every Langfuse SDK call is wrapped in try/catch with a
 * warn-level log fallback. Observability never crashes a chat turn. When the
 * env keys are placeholder values (`replace-me`) or `NODE_ENV=test`, the
 * client is never instantiated and the methods short-circuit to no-ops.
 *
 * Graceful shutdown: `shutdown()` flushes the Langfuse batch queue. Wired into
 * SIGTERM / SIGINT handlers in `index.ts` so traces aren't lost on deploy.
 *
 * Architectural narrative, the four "brief questions" answered, and known
 * limitations live in OBSERVABILITY.md at repo root.
 */

import { Langfuse } from 'langfuse';
import type { Env } from '../env.js';
import { redactPhi } from './redact.js';

export type TurnTraceHandle = {
  readonly id: string;
  readonly correlationId: string;
};

export type ToolSpanHandle = {
  end: (output?: { meta?: Record<string, unknown>; error?: unknown }) => Promise<void>;
};

export type Observability = {
  traceTurn: (input: { correlationId: string; turnName?: string }) => Promise<TurnTraceHandle>;
  /**
   * Open a span for a tool execution. The caller MUST `await span.end(...)`
   * after the tool's work completes (success or failure) so Langfuse can
   * compute latency. Use `recordEvent` for instantaneous markers.
   */
  recordToolCall: (input: {
    correlationId: string;
    toolName: string;
    meta?: Record<string, unknown>;
  }) => Promise<ToolSpanHandle>;
  /** Fire-and-forget marker (cache hits, security guards, verification categories). */
  recordEvent: (input: {
    correlationId: string;
    name: string;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
  recordLlmCall: (input: {
    correlationId: string;
    providerModel: string;
    meta?: Record<string, unknown>;
  }) => Promise<void>;
  /** Flush any pending events and close the underlying client. Call on graceful shutdown. */
  shutdown: () => Promise<void>;
};

const NOOP_SPAN: ToolSpanHandle = { end: async () => {} };

function createDefaultClient(env: Env): Langfuse | null {
  if (env.LANGFUSE_PUBLIC_KEY === 'replace-me' || env.LANGFUSE_SECRET_KEY === 'replace-me') {
    return null;
  }
  // Skip in vitest / NODE_ENV=test so unit tests don't accumulate background
  // batch flushes pointing at the test fixture's loopback URL.
  if (process.env['VITEST'] !== undefined || process.env['NODE_ENV'] === 'test') {
    return null;
  }
  try {
    return new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL,
    });
  } catch (e) {
    console.warn('langfuse_init_failed', { error: String(e) });
    return null;
  }
}

/**
 * Gate 6 — Langfuse-backed observability.
 *
 * Trace IDs are the request `correlationId`, so a single chat turn produces
 * one trace in the Langfuse UI containing every tool span, verification
 * event, and LLM generation. The PHI redactor (`redact.ts`) is applied to
 * every meta payload before it leaves this process.
 *
 * SDK errors never crash a chat turn — every Langfuse call is wrapped in
 * try/catch and warning-logged. Tests pass `{ client: null }` (or rely on
 * `replace-me` keys) to short-circuit network traffic to a no-op.
 */
export function createObservability(
  env: Env,
  options?: { client?: Langfuse | null },
): Observability {
  const client: Langfuse | null =
    options !== undefined && Object.prototype.hasOwnProperty.call(options, 'client')
      ? (options.client ?? null)
      : createDefaultClient(env);

  return {
    async traceTurn({ correlationId, turnName }) {
      if (client !== null) {
        try {
          client.trace({
            id: correlationId,
            name: turnName ?? 'turn',
            metadata: { correlation_id: correlationId },
          });
        } catch (e) {
          console.warn('langfuse_traceTurn_failed', { error: String(e), correlationId });
        }
      }
      return { id: correlationId, correlationId };
    },

    async recordToolCall({ correlationId, toolName, meta }) {
      if (client === null) {
        return NOOP_SPAN;
      }
      try {
        const span = client.span({
          traceId: correlationId,
          name: toolName,
          input: redactPhi(meta ?? {}),
          startTime: new Date(),
        });
        return {
          async end(output) {
            try {
              const endProps: Record<string, unknown> = {
                endTime: new Date(),
                output: redactPhi(output?.meta ?? {}),
              };
              if (output?.error !== undefined) {
                endProps['level'] = 'ERROR';
                endProps['statusMessage'] = String(output.error).slice(0, 500);
              }
              span.end(endProps as never);
            } catch (e) {
              console.warn('langfuse_span_end_failed', {
                error: String(e),
                correlationId,
                toolName,
              });
            }
          },
        };
      } catch (e) {
        console.warn('langfuse_recordToolCall_failed', {
          error: String(e),
          correlationId,
          toolName,
        });
        return NOOP_SPAN;
      }
    },

    async recordEvent({ correlationId, name, meta }) {
      if (client === null) {
        return;
      }
      try {
        client.event({
          traceId: correlationId,
          name,
          metadata: redactPhi(meta ?? {}),
        });
      } catch (e) {
        console.warn('langfuse_recordEvent_failed', { error: String(e), correlationId, name });
      }
    },

    async recordLlmCall({ correlationId, providerModel, meta }) {
      if (client === null) {
        return;
      }
      try {
        const phase = typeof meta?.['phase'] === 'string' ? meta['phase'] : 'unknown';
        const isCompleted =
          phase === 'response_completed' || phase === 'case_presentation_completed';
        const safeMeta = redactPhi(meta ?? {}) as Record<string, unknown>;

        if (!isCompleted) {
          client.event({
            traceId: correlationId,
            name: `llm.${phase}`,
            metadata: { provider_model: providerModel, ...safeMeta },
          });
          return;
        }

        const inputTokens =
          typeof safeMeta['input_tokens'] === 'number' ? safeMeta['input_tokens'] : null;
        const outputTokens =
          typeof safeMeta['output_tokens'] === 'number' ? safeMeta['output_tokens'] : null;
        const costUsd =
          typeof safeMeta['cost_usd'] === 'number' ? safeMeta['cost_usd'] : null;
        const startTimeMs =
          typeof safeMeta['start_time_ms'] === 'number' ? safeMeta['start_time_ms'] : null;

        const endTime = new Date();
        const generationProps: Record<string, unknown> = {
          traceId: correlationId,
          name: phase,
          model: providerModel,
          metadata: safeMeta,
          endTime,
        };
        if (startTimeMs !== null) {
          generationProps['startTime'] = new Date(startTimeMs);
        }
        if (inputTokens !== null || outputTokens !== null) {
          generationProps['usage'] = {
            input: inputTokens ?? 0,
            output: outputTokens ?? 0,
            total: (inputTokens ?? 0) + (outputTokens ?? 0),
            unit: 'TOKENS',
          };
        }
        if (costUsd !== null) {
          generationProps['totalCost'] = costUsd;
        }

        client.generation(generationProps as never);
      } catch (e) {
        console.warn('langfuse_recordLlmCall_failed', {
          error: String(e),
          correlationId,
          providerModel,
        });
      }
    },

    async shutdown() {
      if (client === null) {
        return;
      }
      try {
        await client.shutdownAsync();
      } catch (e) {
        console.warn('langfuse_shutdown_failed', { error: String(e) });
      }
    },
  };
}
