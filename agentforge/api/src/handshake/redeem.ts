import { z } from 'zod';
import { mintSessionToken } from './sessionToken.js';
import type { Env } from '../env.js';

export const redeemBodySchema = z.object({
  launch_code: z.string().min(1),
});

const moduleOkSchema = z.object({
  user_id: z.number(),
  patient_uuid: z.string().nullable(),
  encounter_id: z.number().nullable().optional(),
  /**
   * OpenEMR-configured facility timezone (`gbl_time_zone`), captured at
   * handshake so the agent's "today" is the operator's local calendar date,
   * not UTC. Nullable so the module may omit it on installs without
   * `gbl_time_zone` set; the agent then falls back to UTC.
   */
  facility_tz: z.string().min(1).nullable().optional(),
});

export async function redeemLaunchCode(
  env: Env,
  launchCode: string,
  correlationId: string,
): Promise<
  | {
      ok: true;
      session_token: string;
      identity: { user_id: number; patient_uuid_present: boolean; encounter_id_present: boolean };
      expires_at: string;
    }
  | { ok: false; status: 401; body: { error: string } }
> {
  const base = env.OPENEMR_MODULE_BASE_URL.replace(/\/$/, '');
  const url = `${base}/handshake_redeem.php`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Auth': env.OPENEMR_MODULE_SHARED_SECRET,
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({ launch_code: launchCode }),
    });
  } catch {
    return { ok: false, status: 401, body: { error: 'invalid_launch_code' } };
  }

  if (!res.ok) {
    return { ok: false, status: 401, body: { error: 'invalid_launch_code' } };
  }

  let rawJson: unknown;
  try {
    rawJson = await res.json();
  } catch {
    return { ok: false, status: 401, body: { error: 'invalid_launch_code' } };
  }

  const parsed = moduleOkSchema.safeParse(rawJson);
  if (!parsed.success) {
    return { ok: false, status: 401, body: { error: 'invalid_launch_code' } };
  }

  const json = parsed.data;

  const now = Math.floor(Date.now() / 1000);
  const ttl = 30 * 60;
  const sessionToken = mintSessionToken(
    {
      user_id: json.user_id,
      patient_uuid: json.patient_uuid,
      encounter_id: json.encounter_id ?? null,
      facility_tz: json.facility_tz ?? null,
    },
    env.SESSION_TOKEN_SECRET,
    now,
    ttl,
  );

  return {
    ok: true,
    session_token: sessionToken,
    identity: {
      user_id: json.user_id,
      patient_uuid_present: json.patient_uuid !== null && json.patient_uuid !== '',
      encounter_id_present: (json.encounter_id ?? 0) > 0,
    },
    expires_at: new Date((now + ttl) * 1000).toISOString(),
  };
}

export { verifySessionToken } from './sessionToken.js';
