import type { Pool } from 'pg';
import type { Env } from '../env.js';
import { OpenEmrCallError, postModuleJson, type OpenEmrClientContext } from '../openemr/client.js';
import { fetchPendingProposal, markProposalFinal } from './store.js';

const WRITE_TARGETS = ['chief_complaint', 'vitals', 'tobacco', 'allergy'] as const;
export type WriteTarget = (typeof WRITE_TARGETS)[number];

function isWriteTarget(v: string): v is WriteTarget {
  return (WRITE_TARGETS as readonly string[]).includes(v);
}

const RELATIVE_PATH: Record<WriteTarget, string> = {
  chief_complaint: 'write/chief_complaint.php',
  vitals: 'write/vitals.php',
  tobacco: 'write/tobacco.php',
  allergy: 'write/allergy.php',
};

/** Build `{ session_token, patient_uuid, proposal_id, encounter_id?, payload }` for oe-module-agentforge writes. */
export function buildOpenEmrWriteBody(
  row: {
    readonly proposalId: string;
    readonly patientUuid: string;
    readonly encounterId: number | null;
    readonly writeTarget: WriteTarget;
    readonly payload: Record<string, unknown>;
  },
  session_token: string,
): Record<string, unknown> {
  if (row.writeTarget === 'chief_complaint' || row.writeTarget === 'vitals') {
    const eid = row.encounterId;
    if (eid === null || eid <= 0) {
      throw Object.assign(new Error('missing_encounter_id'), { code: 'missing_encounter_id' });
    }

    return {
      session_token,
      patient_uuid: row.patientUuid.toLowerCase(),
      proposal_id: row.proposalId,
      encounter_id: eid,
      payload: row.payload,
    };
  }

  return {
    session_token,
    patient_uuid: row.patientUuid.toLowerCase(),
    proposal_id: row.proposalId,
    payload: row.payload,
  };
}

export type ConfirmOutcome =
  | { ok: true; accepted: boolean; reason?: string; detail?: unknown }
  | {
      ok: false;
      error:
        | 'proposal_not_found'
        | 'patient_mismatch'
        | 'not_pending'
        | 'unsupported_target'
        | 'missing_encounter_id'
        | 'openemr_error';
      status?: number;
      detail?: unknown;
    };

/**
 * Applies a clinician-confirmed UC-B proposal by POSTing to the OpenEMR module (`public/write/*.php`).
 * Marks Postgres row **confirmed** when OpenEMR returns HTTP 200 (whether `accepted:true` — module encodes clinician-visible outcome in JSON body).
 */
export async function confirmPendingProposal(
  env: Env,
  pool: Pool,
  proposalId: string,
  requestedPatientUuid: string,
  sessionToken: string,
  correlationId: string,
): Promise<ConfirmOutcome> {
  const rowRaw = await fetchPendingProposal(pool, proposalId);

  if (rowRaw === null) {
    return { ok: false, error: 'proposal_not_found' };
  }

  if (rowRaw.patientUuid.toLowerCase() !== requestedPatientUuid.toLowerCase()) {
    return { ok: false, error: 'patient_mismatch' };
  }

  if (rowRaw.status !== 'pending') {
    return { ok: false, error: 'not_pending' };
  }

  const candidateTarget = rowRaw.writeTarget;
  if (!isWriteTarget(candidateTarget)) {
    return { ok: false, error: 'unsupported_target' };
  }

  const rowForWrite = {
    proposalId: rowRaw.proposalId,
    patientUuid: rowRaw.patientUuid,
    encounterId: rowRaw.encounterId,
    writeTarget: candidateTarget,
    payload: rowRaw.payload,
  };

  let bodyJson: Record<string, unknown>;

  try {
    bodyJson = buildOpenEmrWriteBody(rowForWrite, sessionToken);
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'missing_encounter_id') {
      return { ok: false, error: 'missing_encounter_id' };
    }

    throw e;
  }

  const ctx: OpenEmrClientContext = { sessionToken, correlationId };
  const path = RELATIVE_PATH[candidateTarget];

  let raw: unknown;
  try {
    raw = await postModuleJson(env, path, ctx, bodyJson);
  } catch (e) {
    const code = e instanceof OpenEmrCallError ? e : undefined;

    return {
      ok: false,
      error: 'openemr_error',
      status: code?.status ?? 502,
      detail: code?.detail,
    };
  }

  const parsedAccept =
    raw !== null &&
    typeof raw === 'object' &&
    typeof (raw as Record<string, unknown>)['accepted'] === 'boolean' ?
      (raw as Record<string, unknown>)['accepted'] === true
    : false;

  await markProposalFinal(pool, proposalId, 'confirmed');

  const reason =
    raw !== null && typeof raw === 'object' && typeof (raw as { reason?: unknown }).reason === 'string' ?
      (raw as { reason: string }).reason
    : undefined;

  return {
    ok: true,
    accepted: parsedAccept,
    ...(reason !== undefined ? { reason } : {}),
    ...(parsedAccept === false ? { detail: raw } : {}),
  };
}

export async function rejectPendingProposal(
  pool: Pool,
  proposalId: string,
  requestedPatientUuid: string,
): Promise<ConfirmOutcome> {
  const rowRaw = await fetchPendingProposal(pool, proposalId);
  if (rowRaw === null) {
    return { ok: false, error: 'proposal_not_found' };
  }

  if (rowRaw.patientUuid.toLowerCase() !== requestedPatientUuid.toLowerCase()) {
    return { ok: false, error: 'patient_mismatch' };
  }

  const ok = await markProposalFinal(pool, proposalId, 'rejected');
  if (!ok) {
    return { ok: false, error: 'not_pending' };
  }

  return { ok: true, accepted: false, reason: 'rejected_by_clinician' };
}
