/**
 * HMAC session token — must match `OpenEMR\Modules\AgentForge\Security\SessionTokenVerifier` (PRD §5.2).
 *
 * `facility_tz` was added in the post-deploy P2 fix: the OpenEMR-configured
 * `gbl_time_zone` is captured at handshake time and carried through every turn
 * so the agent's "today" calendar date matches the operator's local clock
 * instead of UTC. Optional + nullable so old tokens (and tests) still verify.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type SessionTokenIdentity = {
  user_id: number;
  patient_uuid: string | null;
  encounter_id: number | null;
  facility_tz?: string | null;
};

export type SessionTokenPayload = Required<Pick<SessionTokenIdentity, 'user_id' | 'patient_uuid' | 'encounter_id'>> & {
  facility_tz: string | null;
  iat: number;
  exp: number;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecodeToString(b64: string): string {
  return Buffer.from(b64, 'base64url').toString('utf8');
}

function hmacSha256Base64Url(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function mintSessionToken(
  identity: SessionTokenIdentity,
  secret: string,
  nowSec: number,
  ttlSec: number,
): string {
  if (secret.length < 32) {
    throw new Error('SESSION_TOKEN_SECRET too short');
  }
  const payload: SessionTokenPayload = {
    user_id: identity.user_id,
    patient_uuid: identity.patient_uuid,
    encounter_id: identity.encounter_id,
    facility_tz: identity.facility_tz ?? null,
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = hmacSha256Base64Url(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string, secret: string): SessionTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  const [payloadB64, sig] = parts;
  const expected = hmacSha256Base64Url(payloadB64, secret);
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecodeToString(payloadB64)) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (
    typeof o.user_id !== 'number' ||
    typeof o.iat !== 'number' ||
    typeof o.exp !== 'number' ||
    !('patient_uuid' in o) ||
    (o.patient_uuid !== null && typeof o.patient_uuid !== 'string') ||
    !('encounter_id' in o) ||
    (o.encounter_id !== null && typeof o.encounter_id !== 'number')
  ) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now < o.iat || now > o.exp) {
    return null;
  }
  // facility_tz is optional + nullable for backward compatibility with tokens
  // minted before the post-deploy P2 fix; reject only when present-but-malformed.
  let facility_tz: string | null = null;
  if ('facility_tz' in o) {
    if (o.facility_tz === null) {
      facility_tz = null;
    } else if (typeof o.facility_tz === 'string') {
      facility_tz = o.facility_tz;
    } else {
      return null;
    }
  }
  return {
    user_id: o.user_id,
    patient_uuid: o.patient_uuid as string | null,
    encounter_id: o.encounter_id as number | null,
    facility_tz,
    iat: o.iat,
    exp: o.exp,
  };
}
