import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Env } from './env.js';
import type { Observability } from './observability/index.js';

export type AgentForgeVariables = {
  correlationId: string;
};

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
}

export function buildApp(env: Env, _obs: Observability): Hono<{ Variables: AgentForgeVariables }> {
  const app = new Hono<{ Variables: AgentForgeVariables }>();

  app.use('*', async (c, next) => {
    const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
    c.set('correlationId', correlationId);
    await next();
    c.header('X-Correlation-Id', correlationId);
  });

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

  return app;
}
