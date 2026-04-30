import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { runChatTurn } from './agent/orchestrator.js';
import type { AgentForgeVariables } from './appTypes.js';
import { corsAllowlistMiddleware } from './cors.js';
import type { Env } from './env.js';
import { normalizeErrorHandler } from './errors/normalize.js';
import { redeemBodySchema, redeemLaunchCode } from './handshake/redeem.js';
import type { Observability } from './observability/index.js';

export type { AgentForgeVariables };

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
}

const chatRequestSchema = z.object({
  session_token: z.string().min(1),
  patient_uuid: z.string().min(1),
  message: z.string().min(1),
});

export function buildApp(env: Env, observability: Observability): Hono<{ Variables: AgentForgeVariables }> {
  const app = new Hono<{ Variables: AgentForgeVariables }>();

  app.onError(normalizeErrorHandler);

  app.use('*', async (c, next) => {
    const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
    c.set('correlationId', correlationId);
    c.set('env', env);
    c.set('observability', observability);
    await next();
    c.header('X-Correlation-Id', correlationId);
  });

  app.use('*', corsAllowlistMiddleware(env));

  app.get('/health', (c) => {
    return c.json({
      ok: true,
      version: readPackageVersion(),
      providers: { llm: env.LLM_PROVIDER, stt: env.STT_PROVIDER },
      deps: {
        openemr_module: 'unknown',
        postgres: 'unknown',
        langfuse: 'unknown',
      },
    });
  });

  app.post('/handshake/redeem', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_launch_code' }, 401);
    }
    const parsed = redeemBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_launch_code' }, 401);
    }

    const correlationId = c.get('correlationId');
    try {
      const result = await redeemLaunchCode(env, parsed.data.launch_code, correlationId);
      if (!result.ok) {
        return c.json(result.body, result.status);
      }
      return c.json({
        session_token: result.session_token,
        identity: result.identity,
        expires_at: result.expires_at,
      });
    } catch {
      return c.json({ error: 'invalid_launch_code' }, 401);
    }
  });

  app.post('/chat', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const correlationId = c.get('correlationId');
    const obs = c.get('observability');

    try {
      const { blocks } = await runChatTurn(
        env,
        obs,
        {
          sessionToken: parsed.data.session_token,
          patientUuid: parsed.data.patient_uuid,
          userMessage: parsed.data.message,
        },
        correlationId,
      );
      return c.json({ ok: true, blocks, correlation_id: correlationId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (msg === 'unsupported_llm_provider_gate2') {
        return c.json({ error: 'misconfigured', correlation_id: correlationId }, 501);
      }
      return c.json({ error: 'internal_error', correlation_id: correlationId }, 500);
    }
  });

  return app;
}
