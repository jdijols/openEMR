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
import { buildRecapPayload } from './conversations/recap.js';
import {
  fetchConversationByExternalId,
  listAssistantTurnBodies,
  listPendingProposalsForConversation,
} from './conversations/store.js';
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

const chatRequestSchema = z.object({
  session_token: z.string().min(1),
  patient_uuid: z.string().min(1),
  message: z.string().min(1),
  conversation_id: z.string().uuid().optional(),
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
    let postgres_probe: 'ok' | 'degraded';
    try {
      await pgPool.query('SELECT 1 FROM agentforge.conversations LIMIT 1');
      postgres_probe = 'ok';
    } catch {
      postgres_probe = 'degraded';
    }

    return c.json({
      ok: postgres_probe === 'ok',
      version: readPackageVersion(),
      providers: { llm: env.LLM_PROVIDER, stt: env.STT_PROVIDER },
      deps: {
        openemr_module: 'unknown',
        postgres: postgres_probe === 'ok' ? 'reachable' : 'degraded_chat_requires_migrations_or_url',
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
      if (msg === 'unsupported_llm_provider_gate2') {
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
      if (msg === 'unsupported_llm_provider_gate2') {
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

  /**
   * UC-C recap (PRD §5.9). Session in `Authorization: Bearer` + `X-Patient-Uuid` — never in query (S5).
   */
  app.get('/conversations/:conversationId/recap', async (c) => {
    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');
    const envLocal = c.get('env');

    const authHeader = (c.req.header('Authorization') ?? '').trim();
    const bearer = /^Bearer\s+(.+)$/iu.exec(authHeader);
    const token = bearer?.[1]?.trim();
    const patientUuid = (c.req.header('X-Patient-Uuid') ?? '').trim();
    const conversationExternalId = c.req.param('conversationId')?.trim() ?? '';

    if (
      token === undefined ||
      token === '' ||
      patientUuid === '' ||
      conversationExternalId === ''
    ) {
      return c.json({ error: 'invalid_request', correlation_id: correlationId }, 400);
    }

    const sess = verifySessionToken(token, envLocal.SESSION_TOKEN_SECRET);
    if (sess === null) {
      return c.json({ error: 'unauthenticated', correlation_id: correlationId }, 401);
    }
    if (sess.patient_uuid?.toLowerCase() !== patientUuid.toLowerCase()) {
      return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
    }

    const conv = await fetchConversationByExternalId(pool, conversationExternalId);
    if (conv === null) {
      return c.json({ error: 'conversation_not_found', correlation_id: correlationId }, 404);
    }
    if (conv.patientUuid.toLowerCase() !== patientUuid.toLowerCase()) {
      return c.json({ error: 'conversation_patient_mismatch', correlation_id: correlationId }, 403);
    }

    const proposals = await listPendingProposalsForConversation(pool, conv.internalId);
    const assistantBodies = await listAssistantTurnBodies(pool, conv.internalId);
    const { items, counts } = buildRecapPayload({ proposals, assistantBodies });

    return c.json({
      ok: true,
      items,
      counts,
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
