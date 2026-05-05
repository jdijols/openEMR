import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { z } from 'zod';
import { runCasePresentation } from './agent/case_presentation.js';
import { runChatTurn } from './agent/orchestrator.js';
import type { AgentForgeVariables } from './appTypes.js';
import { confirmPendingProposal, rejectPendingProposal } from './conversations/apply_pending_write.js';
import { corsAllowlistMiddleware } from './cors.js';
import type { Env } from './env.js';
import { normalizeErrorHandler } from './errors/normalize.js';
import { redeemBodySchema, redeemLaunchCode } from './handshake/redeem.js';
import { verifySessionToken } from './handshake/sessionToken.js';
import type { Observability } from './observability/index.js';

export type { AgentForgeVariables };

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
}

async function probePostgres(pgPool: Pool): Promise<'ok' | 'degraded'> {
  try {
    await pgPool.query('SELECT 1 FROM agentforge.conversations LIMIT 1');
    return 'ok';
  } catch {
    return 'degraded';
  }
}

/**
 * G6-15 / PRD §5.7.2 — typed misconfiguration thrown by `getChatModel`. Both
 * `/present-patient` and `/chat` translate any of these into a `501
 * misconfigured` so operators get a deterministic signal that the env is wrong
 * (vs. a generic `500 internal_error`).
 */
const LLM_CONFIG_ERROR_NAMES = new Set([
  'unsupported_llm_provider',
  'openai_azure_missing_deployment_id',
  'openai_azure_missing_endpoint',
]);

function isLlmConfigError(message: string): boolean {
  return LLM_CONFIG_ERROR_NAMES.has(message);
}

/**
 * Post-deploy P1 hardening: round-trip the shared secret to the OpenEMR module.
 * Distinguishes `secret_mismatch` (containers running with drifted env) from
 * `unreachable` (network/DNS/down) so the operator can grep `/health` instead
 * of waiting for a confirmed-write to fail in the rail.
 */
const OPENEMR_HEALTH_PROBE_TIMEOUT_MS = 2000;

async function probeOpenEmrModule(env: Env): Promise<'ok' | 'secret_mismatch' | 'unreachable'> {
  const base = env.OPENEMR_MODULE_BASE_URL.replace(/\/$/, '');
  const url = `${base}/health/internal_auth.php`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENEMR_HEALTH_PROBE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Internal-Auth': env.OPENEMR_MODULE_SHARED_SECRET,
      },
      body: '{}',
      signal: controller.signal,
    });
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 200) return 'ok';
  if (res.status === 401) return 'secret_mismatch';
  return 'unreachable';
}

/**
 * Active Langfuse reachability probe. Does NOT validate credentials — just
 * confirms the API container can reach the configured Langfuse host. Returns
 * `not_configured` when keys are still placeholder values (the observability
 * layer short-circuits to no-ops in that case anyway). A non-`ok` result
 * never gates overall `/health.ok` because losing observability does not
 * break the chat surface — see OBSERVABILITY.md §"Failure isolation".
 */
const LANGFUSE_HEALTH_PROBE_TIMEOUT_MS = 1500;

async function probeLangfuse(env: Env): Promise<'ok' | 'unreachable' | 'not_configured'> {
  if (env.LANGFUSE_PUBLIC_KEY === 'replace-me' || env.LANGFUSE_SECRET_KEY === 'replace-me') {
    return 'not_configured';
  }

  const base = env.LANGFUSE_BASE_URL.replace(/\/$/, '');
  const url = `${base}/api/public/health`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LANGFUSE_HEALTH_PROBE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', signal: controller.signal });
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
  }

  // Langfuse Cloud's `/api/public/health` returns 200 with `{"status":"OK"}`
  // when the ingest API is healthy. Self-hosted Langfuse v2 exposes the same
  // path. Anything else means the host responded but the API surface is
  // degraded — treat as `unreachable` from the operator's perspective.
  return res.status === 200 ? 'ok' : 'unreachable';
}

const chatRequestSchema = z.object({
  session_token: z.string().min(1),
  patient_uuid: z.string().min(1),
  message: z.string().min(1),
  conversation_id: z.string().uuid().optional(),
  // §5 / G2-MVP-36 — when present, the supervisor invokes attach_and_extract
  // before answering. Both keys must be supplied together to take effect.
  docref_uuid: z.string().min(1).optional(),
  doc_type: z.enum(['lab_pdf', 'intake_form']).optional(),
});

const presentPatientSchema = z.object({
  session_token: z.string().min(1),
  patient_uuid: z.string().min(1),
  force_refresh: z.boolean().optional(),
});

const proposalDecisionSchema = z.object({
  session_token: z.string().min(1),
  patient_uuid: z.string().min(1),
  proposal_id: z.string().min(1),
});

export function buildApp(
  env: Env,
  observability: Observability,
  pgPool: Pool,
): Hono<{ Variables: AgentForgeVariables }> {
  const app = new Hono<{ Variables: AgentForgeVariables }>();

  app.onError(normalizeErrorHandler);

  app.use('*', async (c, next) => {
    const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
    c.set('correlationId', correlationId);
    c.set('env', env);
    c.set('observability', observability);
    c.set('pgPool', pgPool);
    await next();
    c.header('X-Correlation-Id', correlationId);
  });

  app.use('*', corsAllowlistMiddleware(env));

  app.get('/health', async (c) => {
    const [postgres_probe, openemr_module_probe, langfuse_probe] = await Promise.all([
      probePostgres(pgPool),
      probeOpenEmrModule(env),
      probeLangfuse(env),
    ]);

    return c.json({
      ok: postgres_probe === 'ok' && openemr_module_probe === 'ok',
      version: readPackageVersion(),
      providers: { llm: env.LLM_PROVIDER, stt: env.STT_PROVIDER },
      deps: {
        openemr_module: openemr_module_probe,
        postgres: postgres_probe === 'ok' ? 'reachable' : 'degraded_chat_requires_migrations_or_url',
        langfuse: langfuse_probe,
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

  app.post('/present-patient', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = presentPatientSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const correlationId = c.get('correlationId');
    const obs = c.get('observability');

    try {
      const { blocks, citation_navigation } = await runCasePresentation(
        env,
        obs,
        {
          sessionToken: parsed.data.session_token,
          patientUuid: parsed.data.patient_uuid,
          forceRefresh: parsed.data.force_refresh === true,
        },
        correlationId,
      );
      return c.json({
        ok: true,
        blocks,
        citation_navigation,
        correlation_id: correlationId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (isLlmConfigError(msg)) {
        return c.json({ error: 'misconfigured', correlation_id: correlationId }, 501);
      }
      return c.json({ error: 'internal_error', correlation_id: correlationId }, 500);
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
    const pool = c.get('pgPool');

    try {
      const { blocks, citation_navigation, conversation_id } = await runChatTurn(
        env,
        obs,
        {
          sessionToken: parsed.data.session_token,
          patientUuid: parsed.data.patient_uuid,
          userMessage: parsed.data.message,
          conversation_id: parsed.data.conversation_id,
          docrefUuid: parsed.data.docref_uuid,
          docType: parsed.data.doc_type,
        },
        correlationId,
        { pool },
      );
      return c.json({
        ok: true,
        blocks,
        citation_navigation,
        correlation_id: correlationId,
        conversation_id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      // Print the underlying exception so dev tail can debug without a Langfuse round-trip.
      console.error('chat_internal_error', { correlation_id: correlationId, error: e });
      if (isLlmConfigError(msg)) {
        return c.json({ error: 'misconfigured', correlation_id: correlationId }, 501);
      }
      return c.json({ error: 'internal_error', correlation_id: correlationId }, 500);
    }
  });

  app.post('/conversations/:conversationId/confirm', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = proposalDecisionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');
    const envLocal = c.get('env');

    const out = await confirmPendingProposal(
      envLocal,
      pool,
      parsed.data.proposal_id,
      parsed.data.patient_uuid,
      parsed.data.session_token,
      correlationId,
    );

    if (!out.ok) {
      if (out.error === 'proposal_not_found') {
        return c.json({ error: 'proposal_not_found', correlation_id: correlationId }, 404);
      }
      if (out.error === 'patient_mismatch') {
        return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
      }
      if (out.error === 'not_pending') {
        return c.json({ error: 'not_pending', correlation_id: correlationId }, 409);
      }
      if (out.error === 'missing_encounter_id') {
        return c.json({ error: 'missing_encounter_id', correlation_id: correlationId }, 400);
      }
      if (out.error === 'openemr_error') {
        let code = typeof out.status === 'number' && Number.isFinite(out.status) ? Math.trunc(out.status) : 502;
        if (code < 400 || code > 599) code = 502;
        const status = code as ContentfulStatusCode;
        return c.json(
          { error: 'openemr_error', correlation_id: correlationId, detail: out.detail },
          status,
        );
      }
      return c.json({ error: 'unsupported_target', correlation_id: correlationId }, 500);
    }

    return c.json({
      ok: true,
      accepted: out.accepted,
      ...(out.reason !== undefined ? { reason: out.reason } : {}),
      correlation_id: correlationId,
    });
  });

  app.post('/conversations/:conversationId/reject', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = proposalDecisionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');

    const out = await rejectPendingProposal(pool, parsed.data.proposal_id, parsed.data.patient_uuid);
    if (!out.ok) {
      if (out.error === 'proposal_not_found') {
        return c.json({ error: 'proposal_not_found', correlation_id: correlationId }, 404);
      }
      if (out.error === 'patient_mismatch') {
        return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
      }
      if (out.error === 'not_pending') {
        return c.json({ error: 'not_pending', correlation_id: correlationId }, 409);
      }
      return c.json({ error: 'internal_error', correlation_id: correlationId }, 500);
    }

    return c.json({ ok: true, rejected: true, correlation_id: correlationId });
  });

  return app;
}
