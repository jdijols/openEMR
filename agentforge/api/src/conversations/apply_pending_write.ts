import type { Pool } from 'pg';
import type { Env } from '../env.js';
import { OpenEmrCallError, postModuleJson, type OpenEmrClientContext } from '../openemr/client.js';
import { broadcast, closeProposal } from './proposal_bus.js';
import { fetchPendingProposal, markProposalFinal } from './store.js';

const WRITE_TARGETS = [
  'chief_complaint',
  'chief_complaint_delete',
  'vitals',
  'vitals_delete',
  'tobacco',
  'allergy',
  'clinical_note',
  'clinical_note_update',
  'clinical_note_delete',
  // G2-Early-25 / G2-Final-12 — W2 propose-write targets.
  'medication_add',
  'medication_discontinue',
  'allergy_delete',
  'family_history_add',
  'document_delete',
  'demographics_update',
] as const;
export type WriteTarget = (typeof WRITE_TARGETS)[number];

function isWriteTarget(v: string): v is WriteTarget {
  return (WRITE_TARGETS as readonly string[]).includes(v);
}

const RELATIVE_PATH: Record<WriteTarget, string> = {
  chief_complaint: 'write/chief_complaint.php',
  chief_complaint_delete: 'write/chief_complaint_delete.php',
  vitals: 'write/vitals.php',
  vitals_delete: 'write/vitals_delete.php',
  tobacco: 'write/tobacco.php',
  allergy: 'write/allergy.php',
  clinical_note: 'write/clinical_note.php',
  clinical_note_update: 'write/clinical_note_edit.php',
  clinical_note_delete: 'write/clinical_note_edit.php',
  medication_add: 'write/medication_add.php',
  medication_discontinue: 'write/medication_discontinue.php',
  allergy_delete: 'write/allergy_delete.php',
  family_history_add: 'write/family_history_add.php',
  document_delete: 'document/delete.php',
  demographics_update: 'write/demographics_update.php',
};

const ENCOUNTER_REQUIRED_TARGETS: ReadonlySet<WriteTarget> = new Set([
  'chief_complaint',
  'chief_complaint_delete',
  'vitals',
  'vitals_delete',
  'clinical_note',
  'clinical_note_update',
  'clinical_note_delete',
]);

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
  if (ENCOUNTER_REQUIRED_TARGETS.has(row.writeTarget)) {
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

  // Notify any SSE subscribers (dashboard modal, CUI rail) that the proposal
  // has been finalized. Best-effort — broadcast errors never fail the apply.
  broadcast(proposalId, 'status_changed', { proposal_id: proposalId, status: 'confirmed' });
  closeProposal(proposalId);

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

  broadcast(proposalId, 'status_changed', { proposal_id: proposalId, status: 'rejected' });
  closeProposal(proposalId);

  return { ok: true, accepted: false, reason: 'rejected_by_clinician' };
}
