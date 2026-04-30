import { verifySessionToken } from '../handshake/sessionToken.js';
import type { Env } from '../env.js';

export type BoundPatientResult =
  | { ok: true; patient_uuid: string | null }
  | { ok: false; error: 'active_chart_mismatch' };

/**
 * PRD §5.5 — defense in depth on the agent; blocks cross-patient tools before HTTP.
 */
export function assertBoundPatient(
  env: Env,
  sessionToken: string,
  requestedPatientUuid: string,
): BoundPatientResult {
  const claims = verifySessionToken(sessionToken, env.SESSION_TOKEN_SECRET);
  if (claims === null) {
    return { ok: false, error: 'active_chart_mismatch' };
  }
  if (claims.patient_uuid !== null && claims.patient_uuid !== requestedPatientUuid) {
    return { ok: false, error: 'active_chart_mismatch' };
  }
  if (claims.patient_uuid === null && requestedPatientUuid !== '') {
    return { ok: false, error: 'active_chart_mismatch' };
  }
  return { ok: true, patient_uuid: claims.patient_uuid };
}
