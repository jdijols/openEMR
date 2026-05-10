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

/**
 * Lift any leading-underscore metadata keys (e.g. `_source_docref_uuid`)
 * out of the proposal's inner business payload up to top-level body
 * fields. Lets the agent stash provenance metadata at propose time
 * without polluting the strict allowlists that PHP-side payload parsers
 * apply to the inner `payload` object.
 *
 * UI-only keys (`preview` — Phase 2's persisted affordance string) are
 * dropped entirely: they belong in `pending_proposals.payload` so the
 * dashboard, the chat-cache replay, and the affordance can read a
 * canonical preview, but PHP write handlers neither need nor accept
 * them. Adding `preview` to the strict allowlists in every per-target
 * PHP payload parser would be churn for a field PHP never reads, so the
 * apply step strips it here instead.
 */
function liftMetadataKeys(payload: Record<string, unknown>): {
  cleanedPayload: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const cleanedPayload: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (k === 'preview') {
      // UI-only — never sent to PHP, never lifted to top-level body.
      continue;
    }
    if (k.startsWith('_') && k !== '_') {
      // Strip the leading underscore so the body field reads naturally
      // on the PHP side (`source_docref_uuid` rather than `_source_docref_uuid`).
      metadata[k.slice(1)] = v;
    } else {
      cleanedPayload[k] = v;
    }
  }
  return { cleanedPayload, metadata };
}

/** Build `{ session_token, patient_uuid, proposal_id, encounter_id?, payload, ...metadata }` for oe-module-agentforge writes. */
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
  const { cleanedPayload, metadata } = liftMetadataKeys(row.payload);

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
      payload: cleanedPayload,
      ...metadata,
    };
  }

  return {
    session_token,
    patient_uuid: row.patientUuid.toLowerCase(),
    proposal_id: row.proposalId,
    payload: cleanedPayload,
    ...metadata,
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

  // Phase 4 — bundle fan-out. `intake_bundle` (and any future bundle targets)
  // hold an N-section payload; the apply step iterates the sections and
  // POSTs each non-rejected leaf to its own per-target write endpoint with
  // a SYNTHETIC proposal_id (`${parentBundleId}::${section_id}[::${item_id}]`)
  // so the PHP idempotency ledger keeps each leaf uniquely de-duplicable —
  // re-applying the bundle is a no-op per leaf, never a partial silent
  // re-write.
  if (rowRaw.writeTarget === 'intake_bundle' || rowRaw.payload['kind'] === 'bundle') {
    return await applyBundleFanOut(env, pool, rowRaw, sessionToken, correlationId);
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

/**
 * Phase 4 — outcome of a single leaf write inside a bundle fan-out. Returned
 * to the caller (and broadcast over SSE) so the dashboard's
 * `BundleReviewModal` can render per-row "✓ wrote N of M" badges.
 */
type BundleSectionOutcome = Readonly<{
  section_id: string;
  item_id: string | null;
  write_target: string;
  ok: boolean;
  reason?: string;
}>;

type BundleLeaf = Readonly<{
  section_id: string;
  item_id: string | null;
  write_target: string;
  encounter_id: number | null;
  payload: Record<string, unknown>;
}>;

/** Walk a bundle payload and return every non-rejected leaf, in section/item order. */
function collectBundleLeaves(payload: Record<string, unknown>): BundleLeaf[] {
  const leaves: BundleLeaf[] = [];
  const sections = Array.isArray(payload['sections']) ? (payload['sections'] as ReadonlyArray<unknown>) : [];
  for (const s of sections) {
    if (s === null || typeof s !== 'object') {
      continue;
    }
    const section = s as Record<string, unknown>;
    const sectionId = typeof section['section_id'] === 'string' ? (section['section_id'] as string) : null;
    if (sectionId === null || sectionId === '' || sectionId.includes('::')) {
      // Slug-style only — a section_id with `::` would collide with the
      // synthetic proposal_id separator and produce ambiguous ledger rows.
      continue;
    }
    const items = Array.isArray(section['items']) ? (section['items'] as ReadonlyArray<unknown>) : null;
    if (items !== null) {
      for (const it of items) {
        if (it === null || typeof it !== 'object') {
          continue;
        }
        const item = it as Record<string, unknown>;
        if (item['rejected'] === true) {
          continue;
        }
        const itemId = typeof item['item_id'] === 'string' ? (item['item_id'] as string) : null;
        const writeTarget = typeof item['write_target'] === 'string' ? (item['write_target'] as string) : null;
        const itemPayload =
          item['payload'] !== null && typeof item['payload'] === 'object' && !Array.isArray(item['payload']) ?
            (item['payload'] as Record<string, unknown>)
          : null;
        if (itemId === null || itemId === '' || itemId.includes('::') || writeTarget === null || itemPayload === null) {
          continue;
        }
        const eid = item['encounter_id'];
        leaves.push({
          section_id: sectionId,
          item_id: itemId,
          write_target: writeTarget,
          encounter_id: typeof eid === 'number' && Number.isFinite(eid) && eid > 0 ? eid : null,
          payload: itemPayload,
        });
      }
      continue;
    }
    if (section['rejected'] === true) {
      continue;
    }
    const writeTarget = typeof section['write_target'] === 'string' ? (section['write_target'] as string) : null;
    const sectionPayload =
      section['payload'] !== null && typeof section['payload'] === 'object' && !Array.isArray(section['payload']) ?
        (section['payload'] as Record<string, unknown>)
      : null;
    if (writeTarget === null || sectionPayload === null) {
      continue;
    }
    const eid = section['encounter_id'];
    leaves.push({
      section_id: sectionId,
      item_id: null,
      write_target: writeTarget,
      encounter_id: typeof eid === 'number' && Number.isFinite(eid) && eid > 0 ? eid : null,
      payload: sectionPayload,
    });
  }
  return leaves;
}

/**
 * Phase 4 — server-side fan-out for `kind: 'bundle'` proposals.
 *
 * Walks every non-rejected leaf, mints a synthetic `proposal_id` of the
 * form `${parentBundleId}::${section_id}[::${item_id}]`, and POSTs each
 * leaf to its per-target PHP write endpoint. The synthetic IDs are stable
 * across re-applies (deterministic from the bundle id + slug IDs) so the
 * PHP `agentforge_completed_write_proposal` ledger short-circuits any
 * leaf that already wrote on a prior attempt — exactly the per-leaf
 * idempotency the W1 single-write path gets for free.
 *
 * Marks the bundle row `confirmed` regardless of partial leaf failures —
 * the per-leaf ledger has the truth of which writes landed, and the
 * caller surfaces the per-leaf outcome so the dashboard can render
 * "8 wrote, 2 failed" instead of a single binary verdict.
 */
async function applyBundleFanOut(
  env: Env,
  pool: Pool,
  row: { proposalId: string; patientUuid: string; payload: Record<string, unknown> },
  sessionToken: string,
  correlationId: string,
): Promise<ConfirmOutcome> {
  const leaves = collectBundleLeaves(row.payload);
  const outcomes: BundleSectionOutcome[] = [];

  for (const leaf of leaves) {
    if (!isWriteTarget(leaf.write_target)) {
      outcomes.push({
        section_id: leaf.section_id,
        item_id: leaf.item_id,
        write_target: leaf.write_target,
        ok: false,
        reason: 'unsupported_target',
      });
      continue;
    }

    const syntheticId =
      leaf.item_id === null ?
        `${row.proposalId}::${leaf.section_id}`
      : `${row.proposalId}::${leaf.section_id}::${leaf.item_id}`;

    let body: Record<string, unknown>;
    try {
      body = buildOpenEmrWriteBody(
        {
          proposalId: syntheticId,
          patientUuid: row.patientUuid,
          encounterId: leaf.encounter_id,
          writeTarget: leaf.write_target,
          payload: leaf.payload,
        },
        sessionToken,
      );
    } catch (e) {
      const reason =
        typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'missing_encounter_id' ?
          'missing_encounter_id'
        : 'invalid_payload';
      outcomes.push({
        section_id: leaf.section_id,
        item_id: leaf.item_id,
        write_target: leaf.write_target,
        ok: false,
        reason,
      });
      continue;
    }

    const ctx: OpenEmrClientContext = { sessionToken, correlationId };
    try {
      const raw = await postModuleJson(env, RELATIVE_PATH[leaf.write_target], ctx, body);
      const accepted =
        raw !== null &&
        typeof raw === 'object' &&
        (raw as Record<string, unknown>)['accepted'] === true;
      const reason =
        raw !== null && typeof raw === 'object' && typeof (raw as { reason?: unknown }).reason === 'string' ?
          ((raw as { reason: string }).reason)
        : undefined;
      outcomes.push({
        section_id: leaf.section_id,
        item_id: leaf.item_id,
        write_target: leaf.write_target,
        ok: accepted,
        ...(accepted === false && reason !== undefined ? { reason } : {}),
      });
    } catch (e) {
      const code = e instanceof OpenEmrCallError ? e : undefined;
      outcomes.push({
        section_id: leaf.section_id,
        item_id: leaf.item_id,
        write_target: leaf.write_target,
        ok: false,
        reason: code?.status !== undefined ? `http_${code.status}` : 'openemr_error',
      });
    }
  }

  await markProposalFinal(pool, row.proposalId, 'confirmed');
  // The bundle row is `confirmed` (the user reached a terminal decision)
  // even when individual leaves failed. The per-leaf detail rides on the
  // SSE event so any open BundleReviewModal renders accurate per-section
  // outcome badges.
  broadcast(row.proposalId, 'status_changed', {
    proposal_id: row.proposalId,
    status: 'confirmed',
    sections: outcomes,
  });
  closeProposal(row.proposalId);

  // Structured server-side log of the per-leaf result so a `docker logs
  // agentforge-api | grep bundle_fan_out_outcomes` immediately surfaces
  // which leaf rejected and why. PHI-safe — only structural fields
  // (section_id / item_id / write_target / reason). The PHP write
  // handlers' `reason` strings ("invalid_allergy_payload",
  // "unsupported_payload", "duplicate_proposal", etc.) are the most
  // actionable diagnostic for the bundle-confirm refusal path.
  const ok = outcomes.filter((o) => o.ok).length;
  const failed = outcomes.length - ok;
  console.error('bundle_fan_out_outcomes', {
    bundle_proposal_id: row.proposalId,
    leaves_total: outcomes.length,
    leaves_ok: ok,
    leaves_failed: failed,
    outcomes: outcomes.map((o) => ({
      section_id: o.section_id,
      item_id: o.item_id,
      write_target: o.write_target,
      ok: o.ok,
      ...(o.reason !== undefined ? { reason: o.reason } : {}),
    })),
  });

  // Aggregate reason summary for surfaces that can't render the per-leaf
  // detail (the affordance error pill, the chat receipt). Lists the
  // failing section ids + their reasons so the user can fix at a glance.
  const failingSummary = outcomes
    .filter((o) => !o.ok)
    .slice(0, 5) // cap so the toast doesn't balloon
    .map((o) => {
      const path = o.item_id !== null ? `${o.section_id}/${o.item_id}` : o.section_id;
      return `${path}: ${o.reason ?? 'rejected'}`;
    })
    .join('; ');
  const reason =
    failed === 0 ?
      undefined
    : failed === outcomes.length ?
      `All ${failed} sections rejected — ${failingSummary}`
    : `${failed} of ${outcomes.length} sections rejected — ${failingSummary}`;

  const anyOk = ok > 0;
  return {
    ok: true,
    accepted: anyOk,
    ...(reason !== undefined ? { reason } : {}),
    detail: { sections: outcomes },
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
