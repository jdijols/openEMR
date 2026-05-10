import { z } from 'zod';
import type { Env } from '../env.js';
import {
  allergiesResponseSchema,
  chartContextRowsResponseSchema,
  identityResponseSchema,
  type AllergyRow,
  type ContextRow,
  type IdentityDataRow,
} from './types.js';

export type OpenEmrClientContext = {
  sessionToken: string;
  correlationId: string;
};

export class OpenEmrCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'OpenEmrCallError';
  }
}

const errorBodySchema = z.object({ error: z.string().optional() }).passthrough();

async function postContext(
  env: Env,
  relativePath: string,
  body: Record<string, unknown>,
  ctx: OpenEmrClientContext,
): Promise<unknown> {
  const base = env.OPENEMR_MODULE_BASE_URL.replace(/\/$/, '');
  const url = `${base}/${relativePath.replace(/^\//, '')}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Correlation-Id': ctx.correlationId,
        'X-Session-Token': ctx.sessionToken,
        'X-Internal-Auth': env.OPENEMR_MODULE_SHARED_SECRET,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OpenEmrCallError('openemr_network_error', 503);
  }

  let json: unknown;
  let rawText = '';
  try {
    rawText = await res.text();
    json = JSON.parse(rawText);
  } catch {
    // Non-JSON body. Log the head + tail so we can see what PHP actually
    // returned (PHP warnings/notices interspersed with JSON, HTML error
    // pages, empty bodies, etc.).
    console.error('openemr_invalid_json', {
      url,
      status: res.status,
      content_type: res.headers.get('content-type'),
      body_length: rawText.length,
      body_head: rawText.slice(0, 600),
      body_tail: rawText.length > 600 ? rawText.slice(-200) : '',
    });
    throw new OpenEmrCallError('openemr_invalid_json', res.status, {
      body_head: rawText.slice(0, 600),
      body_length: rawText.length,
    });
  }

  if (!res.ok) {
    const eb = errorBodySchema.safeParse(json);
    throw new OpenEmrCallError(eb.success ? (eb.data.error ?? 'openemr_error') : 'openemr_error', res.status, json);
  }

  return json;
}

/**
 * Authenticated POST to AgentForge PHP module endpoints (`public/write`, `public/context`).
 */
export async function postModuleJson(
  env: Env,
  relativePhpPath: string,
  ctx: OpenEmrClientContext,
  body: Record<string, unknown>,
): Promise<unknown> {
  return postContext(env, relativePhpPath, body, ctx);
}

/**
 * PRD §5.3 — Context Service read; S2S auth headers + JSON body mirror §4.4.
 */
export async function getIdentity(
  env: Env,
  ctx: OpenEmrClientContext,
  patientUuid: string,
): Promise<IdentityDataRow> {
  const raw = await postContext(
    env,
    'context/identity.php',
    { session_token: ctx.sessionToken, patient_uuid: patientUuid },
    ctx,
  );
  const parsed = identityResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OpenEmrCallError('openemr_schema_identity', 500, raw);
  }
  return parsed.data.data;
}

export async function getAllergies(
  env: Env,
  ctx: OpenEmrClientContext,
  patientUuid: string,
): Promise<readonly AllergyRow[]> {
  const raw = await postContext(
    env,
    'context/allergies.php',
    { session_token: ctx.sessionToken, patient_uuid: patientUuid },
    ctx,
  );
  const parsed = allergiesResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OpenEmrCallError('openemr_schema_allergies', 500, raw);
  }
  return parsed.data.data;
}

export async function getChartContextRows(
  env: Env,
  ctx: OpenEmrClientContext,
  patientUuid: string,
  relativePhpPath: string,
): Promise<readonly ContextRow[]> {
  const raw = await postContext(
    env,
    relativePhpPath,
    { session_token: ctx.sessionToken, patient_uuid: patientUuid },
    ctx,
  );
  const parsed = chartContextRowsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OpenEmrCallError('openemr_schema_context_rows', 500, raw);
  }
  return parsed.data.data;
}
