/** Shared helpers for inspecting AI SDK `tool-result` payloads. */

export type AiToolResultLike = {
  readonly type?: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
  readonly input?: unknown;
  readonly output?: unknown;
};

export function isToolResultLike(v: unknown): v is AiToolResultLike {
  return v !== null && typeof v === 'object' && (v as { type?: unknown }).type === 'tool-result';
}
