import type { MiddlewareHandler } from 'hono';
import type { Env } from './env.js';

/**
 * Strict allowlist CORS (PRD §5.1 / §8.4) — never reflect unknown Origin.
 */
export function corsAllowlistMiddleware(env: Env): MiddlewareHandler {
  const allowed = new Set(
    env.CUI_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  return async (c, next) => {
    const origin = c.req.header('Origin') ?? '';

    if (c.req.method === 'OPTIONS') {
      if (origin && allowed.has(origin)) {
        c.header('Access-Control-Allow-Origin', origin);
        c.header('Vary', 'Origin');
        // PATCH added for the proposal-lifecycle API (POST/GET/PATCH).
        c.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
        // x-agentforge-session added for the proposal-lifecycle API; the
        // legacy /chat and /conversations endpoints carry the token in the
        // body, but the proposals routes use the header form for cleanliness.
        c.header(
          'Access-Control-Allow-Headers',
          'Content-Type, X-Correlation-Id, X-Session-Token, x-agentforge-session, Authorization',
        );
        c.header('Access-Control-Max-Age', '86400');
      }
      return c.body(null, 204);
    }

    await next();

    if (origin && allowed.has(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  };
}
