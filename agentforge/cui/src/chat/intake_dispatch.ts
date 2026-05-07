/**
 * G2-Early-26 — IntakeProposalCard Confirm dispatcher.
 *
 * Browser-side fan-out from the unified Confirm button to the OpenEMR module's per-section
 * write endpoints (the same endpoints the W1 propose-write flow targets). Each section row
 * is one HTTP POST. proposal_id is minted client-side; the module endpoint records it in
 * the agentforge_completed_write_proposal ledger so a re-apply is a no-op.
 *
 * Intentional design choice: dispatch goes browser → module write endpoint directly, not
 * via the agentforge API or the LLM propose-write tool path. The user has already reviewed
 * and confirmed the card; round-tripping through the LLM would be both slow and lose UI
 * coherence (the LLM has no state to add).
 *
 * Dispatch matrix per W2_ARCHITECTURE.md §9:
 *   chief_concern      → write/chief_complaint.php  (encounter-bound — needs boundEncounterId)
 *   allergies[]        → write/allergy.php          (one POST per allergy, action='add')
 *   current_medications[] → write/medication_add.php (one POST per med)
 *   family_history[]   → write/family_history_add.php (one POST per entry)
 *   demographics       → deferred (G2-Final-11/12 propose_demographics_update)
 */

import type { IntakeProposalData } from './IntakeProposalCard.js';
import { postModuleWrite } from '../api/client.js';

export type IntakeDispatchEnv = Readonly<{
  moduleBase: string;
  sessionToken: string;
  patientUuid: string;
  /** From the appointment-encounter binder; null if no bound encounter (rail launched without one). */
  boundEncounterId: number | null;
}>;

export type SectionKey =
  | 'chief_concern'
  | 'allergies'
  | 'current_medications'
  | 'family_history'
  | 'demographics';

export type RowOutcome =
  | { ok: true }
  | { ok: false; reason: string };

export type SectionOutcome = Readonly<{
  section: SectionKey;
  attempted: number;
  succeeded: number;
  /** Per-row outcomes when more than one POST per section. Mirror order of the source data. */
  rows: ReadonlyArray<RowOutcome>;
  skippedReason?: string;
}>;

export type IntakeDispatchOutcome = Readonly<{
  totalAttempted: number;
  totalSucceeded: number;
  sections: ReadonlyArray<SectionOutcome>;
}>;

function mintProposalId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cui-prop-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

async function safePost(
  env: IntakeDispatchEnv,
  relativeScriptPath: string,
  payload: Record<string, unknown>,
  encounterId?: number,
): Promise<RowOutcome> {
  try {
    const body: Parameters<typeof postModuleWrite>[2] = {
      sessionToken: env.sessionToken,
      patientUuid: env.patientUuid,
      proposalId: mintProposalId(),
      payload,
    };
    if (encounterId !== undefined) {
      body.encounterId = encounterId;
    }
    const res = await postModuleWrite(env.moduleBase, relativeScriptPath, body);
    if (res.accepted) {
      return { ok: true };
    }
    return { ok: false, reason: res.reason ?? 'rejected' };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'network error';
    return { ok: false, reason: message };
  }
}

/**
 * Run the per-section fan-out. Always returns a fully-populated outcome — exceptions are caught
 * per row so a single failure never aborts the rest. The caller renders the per-section result.
 */
export async function dispatchIntakeConfirm(
  env: IntakeDispatchEnv,
  data: IntakeProposalData,
): Promise<IntakeDispatchOutcome> {
  const sections: SectionOutcome[] = [];

  // chief_concern — encounter-bound. Skip if no encounter bound.
  if (data.chief_concern.text.trim() !== '') {
    if (env.boundEncounterId === null) {
      sections.push({
        section: 'chief_concern',
        attempted: 0,
        succeeded: 0,
        rows: [],
        skippedReason: 'No bound encounter',
      });
    } else {
      const outcome = await safePost(
        env,
        'write/chief_complaint.php',
        { reason: data.chief_concern.text.trim() },
        env.boundEncounterId,
      );
      sections.push({
        section: 'chief_concern',
        attempted: 1,
        succeeded: outcome.ok ? 1 : 0,
        rows: [outcome],
      });
    }
  }

  // allergies — one POST per row, action='add'. Forwards onset_date + comments
  // alongside the W1-shape (substance/reaction/severity) so the AllergyWritePayload
  // expansion lands begdate + a longer comments body.
  if (data.allergies.length > 0) {
    const rows: RowOutcome[] = [];
    for (const a of data.allergies) {
      const payload: Record<string, unknown> = { action: 'add', substance: a.substance.trim() };
      if (a.reaction !== null && a.reaction !== undefined && a.reaction !== '') {
        payload['reaction'] = a.reaction.trim();
      }
      if (a.severity !== null && a.severity !== undefined && a.severity !== '') {
        payload['severity'] = a.severity.trim();
      }
      if (a.onset_date !== null && a.onset_date !== undefined && a.onset_date !== '') {
        payload['onset_date'] = a.onset_date.trim();
      }
      if (a.comments !== null && a.comments !== undefined && a.comments !== '') {
        payload['comments'] = a.comments.trim();
      }
      rows.push(await safePost(env, 'write/allergy.php', payload));
    }
    sections.push({
      section: 'allergies',
      attempted: rows.length,
      succeeded: rows.filter((r) => r.ok).length,
      rows,
    });
  }

  // current_medications — one POST per row. Forwards the schema-expanded fields
  // (sig, indication, begdate, enddate) alongside name/dose/frequency.
  if (data.current_medications.length > 0) {
    const rows: RowOutcome[] = [];
    for (const m of data.current_medications) {
      const payload: Record<string, unknown> = { name: m.name.trim() };
      if (m.dose !== null && m.dose !== undefined && m.dose !== '') {
        payload['dose'] = m.dose.trim();
      }
      if (m.frequency !== null && m.frequency !== undefined && m.frequency !== '') {
        payload['frequency'] = m.frequency.trim();
      }
      if (m.sig !== null && m.sig !== undefined && m.sig !== '') {
        payload['sig'] = m.sig.trim();
      }
      if (m.indication !== null && m.indication !== undefined && m.indication !== '') {
        payload['indication'] = m.indication.trim();
      }
      if (m.begdate !== null && m.begdate !== undefined && m.begdate !== '') {
        payload['begdate'] = m.begdate.trim();
      }
      if (m.enddate !== null && m.enddate !== undefined && m.enddate !== '') {
        payload['enddate'] = m.enddate.trim();
      }
      rows.push(await safePost(env, 'write/medication_add.php', payload));
    }
    sections.push({
      section: 'current_medications',
      attempted: rows.length,
      succeeded: rows.filter((r) => r.ok).length,
      rows,
    });
  }

  // family_history — one POST per row. Forwards age_of_onset + deceased so the
  // history_data column write captures "Father — MI age 52, deceased" verbatim.
  if (data.family_history.length > 0) {
    const rows: RowOutcome[] = [];
    for (const f of data.family_history) {
      const payload: Record<string, unknown> = {
        relation: f.relation.trim().toLowerCase(),
        condition: f.condition.trim(),
      };
      if (f.age_of_onset !== null && f.age_of_onset !== undefined && f.age_of_onset !== '') {
        payload['age_of_onset'] = f.age_of_onset.trim();
      }
      if (f.deceased === true) {
        payload['deceased'] = true;
      } else if (f.deceased === false) {
        payload['deceased'] = false;
      }
      rows.push(await safePost(env, 'write/family_history_add.php', payload));
    }
    sections.push({
      section: 'family_history',
      attempted: rows.length,
      succeeded: rows.filter((r) => r.ok).length,
      rows,
    });
  }

  // demographics — schema-driven update via DemographicsUpdatePayload. Sends every
  // non-null field the form supplied; the PHP payload validates each. One POST per
  // patient (not per row); section count is 1 if any field was extracted, else skip.
  const demographicsPayload = buildDemographicsPayload(data.demographics);
  if (Object.keys(demographicsPayload).length > 0) {
    const rows: RowOutcome[] = [
      await safePost(env, 'write/demographics_update.php', demographicsPayload),
    ];
    sections.push({
      section: 'demographics',
      attempted: 1,
      succeeded: rows[0]!.ok ? 1 : 0,
      rows,
    });
  }

  const totalAttempted = sections.reduce((sum, s) => sum + s.attempted, 0);
  const totalSucceeded = sections.reduce((sum, s) => sum + s.succeeded, 0);

  return { totalAttempted, totalSucceeded, sections };
}

/**
 * Build the demographics payload that the `write/demographics_update.php` endpoint
 * accepts (per `DemographicsUpdatePayload::ALLOWED_KEYS`). Skips empty / null fields
 * so we don't clobber existing chart data with empty strings on a re-run.
 */
function buildDemographicsPayload(d: IntakeProposalData['demographics']): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  // Prefer the split name fields; fall back to the legacy combined `name` for backward compat.
  if (d.legal_name_first !== null && d.legal_name_first !== undefined && d.legal_name_first !== '') {
    payload['first_name'] = d.legal_name_first.trim();
  }
  if (d.legal_name_last !== null && d.legal_name_last !== undefined && d.legal_name_last !== '') {
    payload['last_name'] = d.legal_name_last.trim();
  }
  if (d.legal_name_middle !== null && d.legal_name_middle !== undefined && d.legal_name_middle !== '') {
    payload['middle_name'] = d.legal_name_middle.trim();
  }
  if (d.dob !== null && d.dob !== undefined && d.dob !== '') {
    payload['dob'] = d.dob.trim();
  }
  if (d.sex !== null && d.sex !== undefined && d.sex !== '') {
    payload['sex'] = d.sex.trim();
  }
  if (d.contact_phone !== null && d.contact_phone !== undefined && d.contact_phone !== '') {
    payload['contact_phone'] = d.contact_phone.trim();
  }
  return payload;
}
