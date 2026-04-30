import type { Context } from 'hono';
import type { AgentForgeVariables } from '../appTypes.js';

/**
 * PRD §5.11 — safe JSON errors only (stop-the-line S6).
 */
export function normalizeErrorHandler(err: Error, c: Context<{ Variables: AgentForgeVariables }>) {
  const correlationId = c.get('correlationId');
  console.error('agentforge-api error', { correlationId, name: err.name, message: err.message });

  return c.json({ error: 'internal_error', correlation_id: correlationId }, 500);
}
