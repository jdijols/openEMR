import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
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
import { broadcast, subscribe } from './conversations/proposal_bus.js';
import {
  fetchConversationByExternalId,
  fetchPendingProposal,
  insertConversationRow,
  insertPendingProposal,
  setSectionRejected,
  updatePendingProposalPayload,
} from './conversations/store.js';
import { corsAllowlistMiddleware } from './cors.js';
import type { Env } from './env.js';
import { normalizeErrorHandler } from './errors/normalize.js';
import { redeemBodySchema, redeemLaunchCode } from './handshake/redeem.js';
import { verifySessionToken } from './handshake/sessionToken.js';
import { loadEvalStatus } from './observability/eval_status.js';
import { runPhiRedactionProbe } from './observability/phi_redaction_probe.js';
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

// /proposals lifecycle — used by the React modal in the patient dashboard
// AND the CUI rail to read/write the same pending row. Schema deliberately
// stays loose on `payload` because the same surface serves every write_target
// (allergy / medication / vitals / …) and Zod validation lives in the agent
// tools that own the canonical shape.
const proposalCreateBodySchema = z
  .object({
    session_token: z.string().min(1).optional(),
    patient_uuid: z.string().min(1),
    write_target: z.literal('allergy'),
    payload: z.record(z.string(), z.unknown()),
    conversation_external_id: z.string().min(1).optional(),
  })
  .strict();

const proposalPatchBodySchema = z
  .object({
    session_token: z.string().min(1).optional(),
    patient_uuid: z.string().min(1).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

// Phase 4 — body shape for `POST /proposals/:id/items/{reject,restore}`.
// `section_id` and `item_id` are STABLE slugs (the bundle assembler asserts
// they don't contain `::` so the synthetic-id fan-out works), so the
// server resolves the array index by id rather than positional index —
// concurrent agent updates that re-order sections don't break a pending
// reject toggle.
const proposalSectionDecisionBodySchema = z
  .object({
    session_token: z.string().min(1).optional(),
    patient_uuid: z.string().min(1).optional(),
    section_id: z.string().min(1),
    item_id: z.string().min(1).optional(),
  })
  .strict();

const proposalDecisionBodySchema = z
  .object({
    session_token: z.string().min(1).optional(),
    patient_uuid: z.string().min(1),
  })
  .strict();

/**
 * Session token comes from `Authorization: Bearer <token>`, an
 * `x-agentforge-session: <token>` header, or a `session_token` body field
 * (POST/PATCH only). Returns null when no token is present so the handler can
 * 401 without further parsing.
 */
function readSessionToken(req: Request, bodyToken: string | undefined): string | null {
  const auth = req.headers.get('authorization');
  if (auth !== null && auth !== '') {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m !== null && typeof m[1] === 'string' && m[1] !== '') {
      return m[1];
    }
  }
  const headerToken = req.headers.get('x-agentforge-session');
  if (typeof headerToken === 'string' && headerToken !== '') {
    return headerToken;
  }
  if (typeof bodyToken === 'string' && bodyToken !== '') {
    return bodyToken;
  }
  return null;
}

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

  // G2-Final-FB-A-04 — eval-gate badge endpoint. Reads the most-recent
  // file from `agentforge/api/eval/reports/` and returns a PHI-safe
  // summary (counts + per-category pass rates + breach count). Returns
  // 503 when no reports exist (CUI badge falls back to "unknown").
  const evalReportsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'eval', 'reports');
  app.get('/health/eval-status', async (c) => {
    const status = loadEvalStatus(evalReportsDir);
    if (!status.ok) {
      return c.json(status, 503);
    }
    return c.json(status);
  });

  // G2-Final-FB-A-06 — PHI-redaction probe. Runs the live `redactPhi`
  // against a synthetic-PHI fixture and returns side-by-side input vs
  // redacted output + per-pattern caught/missed bookkeeping. Endpoint
  // can never drift from production behavior because it IS production
  // behavior. Synthetic fixture only — no real patient data ever flows
  // through this route.
  app.get('/health/phi-redaction', async (c) => {
    return c.json(runPhiRedactionProbe());
  });

  // G2-Final-FB-C-02 — public status pill payload. First thing a reviewer
  // can hit after a deploy lands to verify the API is reachable + Postgres
  // is up + Langfuse is configured. PHI-safe (no patient identifiers, no
  // auth required). Differs from /health in shape (pills vs. detailed
  // probes) and stability (the status page is cacheable and bookmarkable).
  app.get('/status', async (c) => {
    const [postgres_probe, openemr_module_probe, langfuse_probe] = await Promise.all([
      probePostgres(pgPool),
      probeOpenEmrModule(env),
      probeLangfuse(env),
    ]);
    const apiVariant: 'green' = 'green'; // we got this far → API is up
    let postgresVariant: 'green' | 'yellow' | 'red';
    if (postgres_probe === 'ok') {
      postgresVariant = 'green';
    } else {
      postgresVariant = 'red';
    }
    let openemrVariant: 'green' | 'yellow' | 'red';
    switch (openemr_module_probe) {
      case 'ok':
        openemrVariant = 'green';
        break;
      case 'secret_mismatch':
        openemrVariant = 'yellow';
        break;
      default:
        openemrVariant = 'red';
        break;
    }
    let langfuseVariant: 'green' | 'unconfigured' | 'red';
    switch (langfuse_probe) {
      case 'ok':
        langfuseVariant = 'green';
        break;
      case 'not_configured':
        langfuseVariant = 'unconfigured';
        break;
      default:
        langfuseVariant = 'red';
        break;
    }
    return c.json({
      api: apiVariant,
      postgres: postgresVariant,
      openemr_module: openemrVariant,
      langfuse: langfuseVariant,
      last_seen: new Date().toISOString(),
      version: readPackageVersion(),
    });
  });

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
    // Parse + validate BEFORE entering streamSSE so malformed requests still
    // return a 400 with a JSON body (the CUI's existing transport-error path
    // depends on HTTP-status discrimination for these). Once we enter the SSE
    // body the response is committed to 200 + text/event-stream and every
    // outcome — success, misconfigured, internal_error — is communicated via
    // SSE events.
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

    return streamSSE(c, async (stream) => {
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
          {
            pool,
            // Wire the supervisor's routing decisions to the SSE stream the
            // moment a worker tool begins executing. Each event arrives with
            // worker name + physician-facing label so the CUI swaps the
            // typing indicator's bare ellipsis for "Reading file" /
            // "Searching evidence" before the I/O lands. The post-hoc
            // `agent_step` blocks in the final payload are the audit shadow;
            // they're hidden in the UI but preserved on the wire.
            onRouting: async (event) => {
              await stream.writeSSE({
                event: 'routing',
                data: JSON.stringify(event),
              });
            },
          },
        );
        await stream.writeSSE({
          event: 'final',
          data: JSON.stringify({
            ok: true,
            blocks,
            citation_navigation,
            correlation_id: correlationId,
            conversation_id,
          }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'error';
        // Print the underlying exception so dev tail can debug without a Langfuse round-trip.
        console.error('chat_internal_error', { correlation_id: correlationId, error: e });
        const errorKind = isLlmConfigError(msg) ? 'misconfigured' : 'internal_error';
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: errorKind, correlation_id: correlationId }),
        });
      }
    });
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
      ...(out.detail !== undefined ? { detail: out.detail } : {}),
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

  // -------------------------------------------------------------------------
  // /proposals lifecycle (PRD §5.4 — dashboard modal + CUI rail share rows)
  //
  // The dashboard opens the modal with NO agent involvement (just a session
  // token + patient_uuid + draft payload), so we mint a row directly. The CUI
  // path keeps using its existing `propose_*_write` agent tools — those
  // continue to write through `insertPendingProposal` with a real conversation
  // id. Both surfaces converge on `/proposals/:id` for read / patch / SSE /
  // confirm / reject.
  //
  // pending_proposals.conversation_internal_id is BIGINT NOT NULL today, so a
  // dashboard-initiated proposal still needs a conversation row. When
  // `conversation_external_id` is supplied we look it up; otherwise we mint a
  // synthetic conversation (same shape as the chat orchestrator's fallback).
  // No DB migration required.
  // -------------------------------------------------------------------------

  app.post('/proposals', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = proposalCreateBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const sessionToken = readSessionToken(c.req.raw, parsed.data.session_token);
    if (sessionToken === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
    if (claims === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    if (claims.patient_uuid !== null && claims.patient_uuid !== parsed.data.patient_uuid) {
      return c.json({ error: 'patient_mismatch' }, 403);
    }

    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');

    let conversationInternalId: number;
    try {
      if (parsed.data.conversation_external_id !== undefined) {
        const conv = await fetchConversationByExternalId(pool, parsed.data.conversation_external_id);
        if (conv === null) {
          return c.json({ error: 'conversation_not_found', correlation_id: correlationId }, 404);
        }
        if (conv.patientUuid.toLowerCase() !== parsed.data.patient_uuid.toLowerCase()) {
          return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
        }
        conversationInternalId = conv.internalId;
      } else {
        // Dashboard-only path: mint a synthetic conversation so the NOT NULL
        // FK constraint on pending_proposals is satisfied without a DB
        // migration. Mirrors the existing runChatTurn fallback (orchestrator.ts).
        const synthetic = await insertConversationRow(pool, randomUUID(), parsed.data.patient_uuid);
        conversationInternalId = synthetic.internalId;
      }
    } catch (e) {
      const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
      if (code === 'conversation_patient_mismatch') {
        return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
      }
      console.error('proposals_create_internal_error', { correlation_id: correlationId, error: e });
      return c.json({ error: 'internal_error', correlation_id: correlationId }, 500);
    }

    const proposalId = randomUUID();
    try {
      await insertPendingProposal(pool, {
        proposalId,
        conversationInternalId,
        patientUuid: parsed.data.patient_uuid.toLowerCase(),
        encounterId: null,
        writeTarget: parsed.data.write_target,
        payload: parsed.data.payload,
      });
    } catch (e) {
      console.error('proposals_create_internal_error', { correlation_id: correlationId, error: e });
      return c.json({ error: 'internal_error', correlation_id: correlationId }, 500);
    }

    return c.json(
      {
        proposal_id: proposalId,
        payload: parsed.data.payload,
        status: 'pending' as const,
        correlation_id: correlationId,
      },
      201,
    );
  });

  app.get('/proposals/:id', async (c) => {
    const proposalId = c.req.param('id');
    const requestedPatientUuid = c.req.query('patient_uuid');
    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');

    const row = await fetchPendingProposal(pool, proposalId);
    if (row === null) {
      return c.json({ error: 'proposal_not_found', correlation_id: correlationId }, 404);
    }

    if (
      typeof requestedPatientUuid === 'string' &&
      requestedPatientUuid !== '' &&
      row.patientUuid.toLowerCase() !== requestedPatientUuid.toLowerCase()
    ) {
      return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
    }

    return c.json({
      proposal_id: row.proposalId,
      patient_uuid: row.patientUuid,
      write_target: row.writeTarget,
      payload: row.payload,
      status: row.status,
      correlation_id: correlationId,
    });
  });

  app.patch('/proposals/:id', async (c) => {
    const proposalId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = proposalPatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const sessionToken = readSessionToken(c.req.raw, parsed.data.session_token);
    if (sessionToken === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
    if (claims === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');

    const existing = await fetchPendingProposal(pool, proposalId);
    if (existing === null) {
      return c.json({ error: 'proposal_not_found', correlation_id: correlationId }, 404);
    }
    if (claims.patient_uuid !== null && claims.patient_uuid !== existing.patientUuid) {
      return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
    }
    if (
      parsed.data.patient_uuid !== undefined &&
      parsed.data.patient_uuid.toLowerCase() !== existing.patientUuid.toLowerCase()
    ) {
      return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
    }
    if (existing.status !== 'pending') {
      return c.json({ error: 'not_pending', correlation_id: correlationId }, 409);
    }

    const updated = await updatePendingProposalPayload(pool, proposalId, parsed.data.payload);
    if (updated === null) {
      // Race: row finalized between fetch and update.
      return c.json({ error: 'not_pending', correlation_id: correlationId }, 409);
    }

    broadcast(proposalId, 'payload_updated', {
      proposal_id: updated.proposalId,
      payload: updated.payload,
    });

    return c.json({
      proposal_id: updated.proposalId,
      payload: updated.payload,
      correlation_id: correlationId,
    });
  });

  // Phase 4 — per-section reject / restore for bundle proposals. Used by the
  // dashboard's `BundleReviewModal` to flip a single section/item leaf's
  // `rejected` flag without racing the agent's top-level `update_proposal`
  // PATCHes (which would shallow-merge the entire `sections` array). The
  // server resolves the leaf path via stable IDs and runs `jsonb_set` on
  // the indexed path — concurrent agent edits to other sections don't
  // collide with the user's local toggle. Two routes (reject / restore)
  // share one shape; differ only in the boolean we write into the leaf.
  for (const cfg of [
    { path: '/proposals/:id/items/reject' as const, rejected: true },
    { path: '/proposals/:id/items/restore' as const, rejected: false },
  ]) {
    app.post(cfg.path, async (c) => {
      const proposalId = c.req.param('id');

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid_request' }, 400);
      }

      const parsed = proposalSectionDecisionBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json({ error: 'invalid_request' }, 400);
      }

      const sessionToken = readSessionToken(c.req.raw, parsed.data.session_token);
      if (sessionToken === null) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
      if (claims === null) {
        return c.json({ error: 'unauthorized' }, 401);
      }

      const correlationId = c.get('correlationId');
      const pool = c.get('pgPool');

      const existing = await fetchPendingProposal(pool, proposalId);
      if (existing === null) {
        return c.json({ error: 'proposal_not_found', correlation_id: correlationId }, 404);
      }
      if (claims.patient_uuid !== null && claims.patient_uuid !== existing.patientUuid) {
        return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
      }
      if (
        parsed.data.patient_uuid !== undefined &&
        parsed.data.patient_uuid.toLowerCase() !== existing.patientUuid.toLowerCase()
      ) {
        return c.json({ error: 'patient_mismatch', correlation_id: correlationId }, 403);
      }
      if (existing.status !== 'pending') {
        return c.json({ error: 'not_pending', correlation_id: correlationId }, 409);
      }

      const updated = await setSectionRejected(
        pool,
        proposalId,
        parsed.data.section_id,
        parsed.data.item_id ?? null,
        cfg.rejected,
      );
      if (updated === null) {
        return c.json({ error: 'section_not_found', correlation_id: correlationId }, 404);
      }

      // Live update for any subscribed bundle modal so other tabs / surfaces
      // reflect the toggle in real time.
      broadcast(proposalId, 'payload_updated', {
        proposal_id: updated.proposalId,
        payload: updated.payload,
      });

      return c.json({
        proposal_id: updated.proposalId,
        section_id: parsed.data.section_id,
        item_id: parsed.data.item_id ?? null,
        rejected: cfg.rejected,
        payload: updated.payload,
        correlation_id: correlationId,
      });
    });
  }

  app.get('/proposals/:id/stream', (c) => {
    const proposalId = c.req.param('id');
    const pool = c.get('pgPool');

    return streamSSE(c, async (stream) => {
      const initial = await fetchPendingProposal(pool, proposalId);
      if (initial === null) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'proposal_not_found', proposal_id: proposalId }),
        });
        return;
      }

      // Fan-in queue: subscriber.write enqueues, the SSE loop dequeues. Keeps
      // the bus's synchronous broadcast simple while still serializing writes
      // onto the streaming response.
      const queue: Array<{ event: string; data: string }> = [];
      let waker: (() => void) | null = null;
      let closed = false;

      const wake = (): void => {
        const w = waker;
        waker = null;
        if (w !== null) {
          w();
        }
      };

      const unsubscribe = subscribe(proposalId, {
        write: (event, data) => {
          queue.push({ event, data: JSON.stringify(data) });
          wake();
        },
        close: () => {
          closed = true;
          wake();
        },
      });

      // Initial snapshot.
      await stream.writeSSE({
        event: 'snapshot',
        data: JSON.stringify({
          proposal_id: initial.proposalId,
          payload: initial.payload,
          status: initial.status,
        }),
      });

      // If the proposal was already finalized when we connected, surface the
      // terminal state immediately and let the stream close.
      if (initial.status !== 'pending') {
        await stream.writeSSE({
          event: 'status_changed',
          data: JSON.stringify({ proposal_id: initial.proposalId, status: initial.status }),
        });
        unsubscribe();
        return;
      }

      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake();
      });

      try {
        // Drain loop. When `closed` flips and the queue is empty, the stream
        // ends. closeProposal() in apply_pending_write triggers this.
        while (!closed) {
          while (queue.length > 0) {
            const next = queue.shift();
            if (next === undefined) {
              break;
            }
            await stream.writeSSE({ event: next.event, data: next.data });
          }
          if (closed) {
            break;
          }
          await new Promise<void>((resolve) => {
            waker = resolve;
          });
        }
        // Flush any events that landed after `close()` fired.
        while (queue.length > 0) {
          const next = queue.shift();
          if (next === undefined) {
            break;
          }
          await stream.writeSSE({ event: next.event, data: next.data });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.post('/proposals/:id/confirm', async (c) => {
    const proposalId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = proposalDecisionBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const sessionToken = readSessionToken(c.req.raw, parsed.data.session_token);
    if (sessionToken === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');
    const envLocal = c.get('env');

    const out = await confirmPendingProposal(
      envLocal,
      pool,
      proposalId,
      parsed.data.patient_uuid,
      sessionToken,
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
      // Phase 4 — bundle proposals carry per-leaf outcomes on `detail`. The
      // dashboard's BundleReviewModal renders per-section "✓ Wrote" / "✗ <reason>"
      // badges from this; the affordance falls back to the top-level `reason`
      // summary above. Single-write proposals don't populate detail.
      ...(out.detail !== undefined ? { detail: out.detail } : {}),
      correlation_id: correlationId,
    });
  });

  app.post('/proposals/:id/reject', async (c) => {
    const proposalId = c.req.param('id');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const parsed = proposalDecisionBodySchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request' }, 400);
    }

    const sessionToken = readSessionToken(c.req.raw, parsed.data.session_token);
    if (sessionToken === null) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const correlationId = c.get('correlationId');
    const pool = c.get('pgPool');

    const out = await rejectPendingProposal(pool, proposalId, parsed.data.patient_uuid);
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
