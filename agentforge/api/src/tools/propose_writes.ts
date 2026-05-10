/**
 * PRD §5.4 — propose-write tools (Gate 4 G4-05). Each call mints `proposal_id` and persists a pending row.
 */

import { randomUUID } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Env } from '../env.js';
import type { Observability } from '../observability/index.js';
import { fetchPendingProposal, insertPendingProposal, updatePendingProposalPayload } from '../conversations/store.js';
import { broadcast } from '../conversations/proposal_bus.js';
import { assertBoundPatient } from './_binding.js';

/**
 * Normalize an allergy substance for storage: trim whitespace + capitalize
 * the first character. Mirrors the legacy form's display convention so a
 * physician dictating "fur" or typing "fur" in the dashboard modal lands
 * as "Fur" in `lists.title` (which is what surfaces in chart cards and
 * the FHIR resource narrative).
 */
function normalizeSubstance(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Map whatever the LLM produced for a reaction onto one of the
 * `list_options.list_id='reaction'` option_ids that `lists.reaction`
 * stores. The agent's Zod schema accepts open free-text so the
 * dictation pipeline doesn't reject natural utterances ("shortness of
 * breath", "rash") at the LLM boundary; normalization here keeps the
 * stored value compatible with the PHP allowlist + the modal dropdown.
 * Anything that doesn't map to a known option_id falls through to
 * 'other' (a real list_options row, added in round 11).
 */
function normalizeReactionToOptionId(raw: string): string {
  const norm = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm === '' || norm === 'unassigned' || norm === 'unknown') {
    return 'unassigned';
  }
  if (norm === 'hives' || norm === 'hive' || norm === 'urticaria') {
    return 'hives';
  }
  if (norm === 'nausea' || norm === 'nauseous' || norm === 'nauseated') {
    return 'nausea';
  }
  if (
    norm === 'shortness of breath' ||
    norm === 'shortness_of_breath' ||
    norm === 'sob' ||
    norm === 'dyspnea' ||
    norm === 'difficulty breathing' ||
    norm === 'breathing difficulty'
  ) {
    return 'shortness_of_breath';
  }
  return 'other';
}

const chiefSchema = z.object({
  patient_uuid: z.string().min(1),
  encounter_id: z.number().int().positive(),
  reason: z.string().min(1).max(4000),
});

const clinicalNoteSchema = z.object({
  patient_uuid: z.string().min(1),
  encounter_id: z.number().int().positive(),
  text: z.string().min(1).max(8000),
});

const clinicalNoteEditActionSchema = z.enum(['update', 'delete']);

const clinicalNoteEditSchema = z
  .object({
    patient_uuid: z.string().min(1),
    encounter_id: z.number().int().positive(),
    note_uuid: z.string().min(1),
    action: clinicalNoteEditActionSchema,
    text: z
      .string()
      .min(1)
      .max(8000)
      .optional()
      .describe(
        'Required when action="update" — the new note body that replaces the existing row\'s text. OMIT this field entirely when action="delete" — the soft-delete does not need a text payload. Sending text alongside action="delete" will be rejected by validation.',
      ),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.action === 'update') {
      if (val.text === undefined || val.text.trim() === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'update requires text' });
      }
      return;
    }

    if (val.text !== undefined && val.text !== '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'delete must not include text' });
    }
  });

const vitalsInnerSchema = z
  .object({
    bp: z.string().min(1).optional(),
    hr: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
    temp: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
    pain: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
    weight_lb: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
    height_in: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
  })
  .strict();

const vitalsSchema = z.object({
  patient_uuid: z.string().min(1),
  encounter_id: z.number().int().positive(),
  vitals: vitalsInnerSchema,
});

const vitalsDeleteSchema = z
  .object({
    patient_uuid: z.string().min(1),
    encounter_id: z.number().int().positive(),
    vitals_uuid: z.string().min(1),
  })
  .strict();

const chiefComplaintDeleteSchema = z
  .object({
    patient_uuid: z.string().min(1),
    encounter_id: z.number().int().positive(),
  })
  .strict();

const tobaccoStatusSchema = z.enum([
  'never_smoker',
  'former_smoker',
  'current_every_day',
  'current_some_day',
  'unknown',
]);

const tobaccoSchema = z.object({
  patient_uuid: z.string().min(1),
  status: tobaccoStatusSchema,
});

const allergyActionSchema = z.enum([
  'add',
  // Single-field update actions, dispatched 1:1 to the PHP write port.
  // The dashboard modal submits these sequentially when more than one
  // field changed in a single Save (the legacy form's "save everything
  // at once" UX, just exploded into the granular write pipeline).
  'update_substance',
  'update_reaction',
  'update_severity',
]);

// G2-Early-25 — W2 propose-write schemas. Each mirrors the PHP payload parser; an out-of-enum
// value is rejected at the type system level before the propose tool ever fires.
const medicationAddSchema = z
  .object({
    patient_uuid: z.string().min(1),
    name: z.string().min(2).max(255),
    dose: z.string().min(1).max(1024).optional(),
    frequency: z.string().min(1).max(1024).optional(),
    sig: z.string().min(1).max(1024).optional(),
  })
  .strict();

const medicationDiscontinueSchema = z
  .object({
    patient_uuid: z.string().min(1),
    medication_uuid: z.string().uuid(),
  })
  .strict();

const allergyDeleteSchema = z
  .object({
    patient_uuid: z.string().min(1),
    allergy_uuid: z.string().uuid(),
  })
  .strict();

const familyHistoryRelationSchema = z.enum([
  'mother',
  'father',
  'sibling',
  'brother',
  'sister',
  'offspring',
  'son',
  'daughter',
  'child',
  'spouse',
  'partner',
]);

const familyHistoryAddSchema = z
  .object({
    patient_uuid: z.string().min(1),
    relation: familyHistoryRelationSchema,
    condition: z.string().min(2).max(4000),
  })
  .strict();

const documentDeleteSchema = z
  .object({
    patient_uuid: z.string().min(1),
    docref_uuid: z.string().uuid(),
  })
  .strict();

// G2-Final-12 — propose-demographics-update Zod. All fields optional, but at least one
// non-patient_uuid key must be present (enforced via `superRefine` so the at-least-one rule
// surfaces as a Zod issue rather than mysteriously empty downstream).
const demographicsUpdateSchema = z
  .object({
    patient_uuid: z.string().min(1),
    first_name: z.string().min(1).max(255).optional(),
    last_name: z.string().min(1).max(255).optional(),
    middle_name: z.string().min(1).max(255).optional(),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sex: z.enum(['Male', 'Female', 'Unknown']).optional(),
    contact_phone: z.string().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const fieldKeys = Object.keys(val).filter((k) => k !== 'patient_uuid');
    if (fieldKeys.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one demographic field must be present' });
    }
  });

const allergySchema = z
  .object({
    patient_uuid: z.string().min(1),
    action: allergyActionSchema,
    substance: z.string().min(1).max(255).optional(),
    allergy_uuid: z.string().uuid().optional(),
    reaction: z.string().min(1).max(4000).optional(),
    // Aligned with `list_options.list_id='severity_ccda'` option_ids so
    // the value the agent / modal sends matches what the legacy form
    // stores and what the FHIR encoder reads back. Includes the full
    // option set, not just the modal's curated 5-item dropdown — the
    // agent can pick a subtler grade if the dictation is more specific.
    severity: z
      .enum([
        'unassigned',
        'mild',
        'mild_to_moderate',
        'moderate',
        'moderate_to_severe',
        'severe',
        'life_threatening_severity',
        'fatal',
      ])
      .optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.action === 'add') {
      if (val.substance === undefined || val.substance.trim() === '') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'add requires substance' });
      }
      return;
    }

    if (val.allergy_uuid === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'update requires allergy_uuid' });
      return;
    }

    if (val.action === 'update_substance' && (val.substance === undefined || val.substance.trim() === '')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'update_substance requires substance' });
    }

    if (val.action === 'update_reaction' && (val.reaction === undefined || val.reaction.trim() === '')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'update_reaction requires reaction' });
    }

    if (val.action === 'update_severity' && val.severity === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'update_severity requires severity' });
    }
  });

export type ProposeToolsContext = Readonly<{ conversationInternalId: number }>;

export function createProposeWriteTools(
  env: Env,
  pool: Pool,
  sessionToken: string,
  obs: Observability,
  correlationId: string,
  ctx: ProposeToolsContext,
) {
  return {
    propose_chief_complaint_write: tool({
      description:
        'Propose documenting or updating chief complaint / reason for visit (explicit confirm required before executing).',
      inputSchema: chiefSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_chief_complaint_write',
          meta: {},
        });
        try {
          const proposalId = randomUUID();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: input.encounter_id,
            writeTarget: 'chief_complaint',
            payload: { reason: input.reason.trim() },
          });

          const preview = `Chief complaint (encounter #${input.encounter_id}) → ${input.reason.trim().slice(0, 280)}`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'chief_complaint' } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'chief_complaint',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            encounter_id: input.encounter_id,
            payload: { reason: input.reason.trim() },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    propose_vitals_write: tool({
      description: 'Propose saving vitals (BP, pulse, temperature, pain, weight, height) after explicit clinician confirm.',
      inputSchema: vitalsSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_vitals_write',
          meta: {},
        });
        try {
          const proposalId = randomUUID();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: input.encounter_id,
            writeTarget: 'vitals',
            payload: { ...input.vitals },
          });

          const preview = `Vitals (encounter #${input.encounter_id}) — ${Object.keys(input.vitals).join(', ')}`;

          await span.end({
            meta: {
              proposal_id: proposalId,
              write_target: 'vitals',
              vital_keys: Object.keys(input.vitals),
            },
          });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'vitals',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            encounter_id: input.encounter_id,
            payload: { ...input.vitals },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    propose_tobacco_write: tool({
      description: 'Propose updating tobacco status (strict HIS enum mapped on write).',
      inputSchema: tobaccoSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_tobacco_write',
          meta: {},
        });
        try {
          const proposalId = randomUUID();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'tobacco',
            payload: { status: input.status },
          });

          await span.end({ meta: { proposal_id: proposalId, write_target: 'tobacco' } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'tobacco',
            preview: `Tobacco → ${input.status}`,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload: { status: input.status },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    propose_clinical_note_write: tool({
      description:
        'Propose appending physician-dictated text to the encounter\'s clinical note (Subjective/Objective/Assessment/Plan-style narrative). Use for any new patient observation, history detail, exam finding, plan, or counseling that the physician supplies. Do NOT use for updates to the encounter reason for visit (that is propose_chief_complaint_write). Plain text — no SOAP headings required. The server appends to a canonical physician progress-note row, creating it if missing; existing nursing/intake notes are untouched.',
      inputSchema: clinicalNoteSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_clinical_note_write',
          meta: {},
        });
        try {
          const proposalId = randomUUID();
          const text = input.text.trim();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: input.encounter_id,
            writeTarget: 'clinical_note',
            payload: { text },
          });

          const previewBody = text.length > 280 ? `${text.slice(0, 277)}…` : text;
          const preview = `Clinical note (encounter #${input.encounter_id}) → ${previewBody}`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'clinical_note', text_length: text.length } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'clinical_note',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            encounter_id: input.encounter_id,
            payload: { text },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    propose_clinical_note_edit: tool({
      description:
        'Propose editing a specific existing clinical note row by UUID — either updating its body text (action="update", with replacement text) or soft-deleting it (action="delete", which sets activity=0 in OpenEMR; the row is hidden but preserved for audit). Use this for physician-driven corrections like "remove the note about asthma improving" or "rewrite the dizziness note to say it resolved after rest". Get the note_uuid from a prior get_clinical_notes call (it is the row\'s "uuid" field). The note must belong to the active encounter — cross-encounter edits are rejected. **Field-shape rules:** for action="update" you MUST include text (the replacement body). For action="delete" you MUST OMIT the text field entirely — the soft-delete payload is { patient_uuid, encounter_id, note_uuid, action: "delete" } with no text key. Sending text alongside action="delete" is rejected.',
      inputSchema: clinicalNoteEditSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_clinical_note_edit',
          meta: { action: input.action },
        });
        try {
          const proposalId = randomUUID();
          const noteUuid = input.note_uuid.toLowerCase();
          const writeTarget = input.action === 'delete' ? 'clinical_note_delete' : 'clinical_note_update';

          const payload: Record<string, unknown> = {
            action: input.action,
            note_uuid: noteUuid,
          };
          if (input.action === 'update' && typeof input.text === 'string') {
            payload['text'] = input.text.trim();
          }

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: input.encounter_id,
            writeTarget,
            payload,
          });

          const previewLabel = input.action === 'delete' ? 'Delete clinical note' : 'Update clinical note';
          const previewBody =
            input.action === 'delete' ?
              `note ${noteUuid.slice(0, 8)}…`
            : (() => {
                const t = (input.text ?? '').trim();
                return t.length > 280 ? `${t.slice(0, 277)}…` : t;
              })();
          const preview = `${previewLabel} (encounter #${input.encounter_id}) → ${previewBody}`;

          await span.end({
            meta: { proposal_id: proposalId, write_target: writeTarget, action: input.action },
          });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: writeTarget,
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            encounter_id: input.encounter_id,
            payload,
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    propose_vitals_delete: tool({
      description:
        'Propose voiding (soft-delete) a specific vitals row by UUID. Use this when the physician asks to remove an erroneously dictated vitals entry — e.g. "delete the BP reading I just saved" or "void today\'s vitals, I want to redo them". Get the vitals_uuid from a prior get_vitals call (it is the row\'s "uuid" field). The row is hidden from the chart but preserved with audit (forms.activity = 0) for HIPAA traceability — never hard-deleted. The row must belong to the active encounter — cross-encounter deletes are rejected.',
      inputSchema: vitalsDeleteSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_vitals_delete',
          meta: {},
        });
        try {
          const proposalId = randomUUID();
          const vitalsUuid = input.vitals_uuid.toLowerCase();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: input.encounter_id,
            writeTarget: 'vitals_delete',
            payload: { vitals_uuid: vitalsUuid },
          });

          const preview = `Void vitals (encounter #${input.encounter_id}) → row ${vitalsUuid.slice(0, 8)}…`;

          await span.end({
            meta: { proposal_id: proposalId, write_target: 'vitals_delete' },
          });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'vitals_delete',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            encounter_id: input.encounter_id,
            payload: { vitals_uuid: vitalsUuid },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    propose_chief_complaint_delete: tool({
      description:
        'Propose clearing the chief complaint / reason-for-visit field on the active encounter. Use this only when the physician explicitly asks to remove the chief complaint (e.g. "clear the reason for visit, it was wrong"). For corrections to a non-empty value, prefer propose_chief_complaint_write with the corrected reason — that is the more common workflow. The audit row records write_target=chief_complaint_delete.',
      inputSchema: chiefComplaintDeleteSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_chief_complaint_delete',
          meta: {},
        });
        try {
          const proposalId = randomUUID();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: input.encounter_id,
            writeTarget: 'chief_complaint_delete',
            payload: {},
          });

          const preview = `Clear chief complaint (encounter #${input.encounter_id})`;

          await span.end({
            meta: { proposal_id: proposalId, write_target: 'chief_complaint_delete' },
          });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'chief_complaint_delete',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            encounter_id: input.encounter_id,
            payload: {},
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    propose_allergy_write: tool({
      description:
        'Propose allergy add/update (substance / reaction / severity fields). BEFORE calling with action="add", verify the substance is NOT already in the patient\'s allergy list — call get_allergies if you do not already have it. If the substance is already on file (case-insensitive match), call this tool with action="update_reaction" or "update_severity" and the existing allergy_uuid instead; never add a duplicate. For the reaction field, prefer the controlled vocabulary (Hives, Nausea, "Shortness of breath"); anything outside that set should be passed through and will be normalized to the catch-all "Other" option. Delete is intentionally not represented.',
      inputSchema: allergySchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_allergy_write',
          meta: {},
        });
        try {
          const proposalId = randomUUID();

          const allergyPayload: Record<string, unknown> = { action: input.action };
          if (input.substance !== undefined) {
            allergyPayload['substance'] = normalizeSubstance(input.substance);
          }

          if (input.allergy_uuid !== undefined) {
            allergyPayload['allergy_uuid'] = input.allergy_uuid.toLowerCase();
          }

          if (input.reaction !== undefined) {
            // Normalize whatever the LLM produced ("shortness of breath",
            // "Hives", "rash") into one of the controlled
            // `list_options.list_id='reaction'` option_ids the PHP write
            // path accepts. Free text would hit the PHP allowlist as
            // `invalid_allergy_payload`; mapping here keeps the round-trip
            // alive even when the model picks natural language over the
            // exact option_id token.
            allergyPayload['reaction'] = normalizeReactionToOptionId(input.reaction);
          }

          if (input.severity !== undefined) {
            allergyPayload['severity'] = input.severity;
          }

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'allergy',
            payload: allergyPayload,
          });

          await span.end({
            meta: { proposal_id: proposalId, write_target: 'allergy', action: input.action },
          });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'allergy',
            preview: `${input.action}`,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload: allergyPayload,
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    // G2-Early-25 — propose adding a new active medication. Goes to lists.type='medication'
    // on confirm (write_target='medication_add'). Patient-scoped (no encounter binding) since
    // medications are problem-list-shaped data, not encounter-shaped.
    propose_medication_add: tool({
      description:
        'Propose adding a new active medication to the patient\'s med list. Use for any new prescription mentioned by the physician (e.g. "start Lisinopril 10 mg PO daily"). On confirm, lands as a new lists row with type=medication and activity=1; the dose / frequency / sig are captured in the row\'s comments field as a free-text composite. To stop an existing medication, use propose_medication_discontinue instead.',
      inputSchema: medicationAddSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_medication_add',
          meta: {},
        });
        try {
          const proposalId = randomUUID();
          const payload: Record<string, unknown> = { name: input.name.trim() };
          if (input.dose !== undefined) {
            payload['dose'] = input.dose.trim();
          }
          if (input.frequency !== undefined) {
            payload['frequency'] = input.frequency.trim();
          }
          if (input.sig !== undefined) {
            payload['sig'] = input.sig.trim();
          }

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'medication_add',
            payload,
          });

          const previewParts = [input.name.trim()];
          if (input.dose !== undefined) {
            previewParts.push(input.dose.trim());
          }
          if (input.frequency !== undefined) {
            previewParts.push(input.frequency.trim());
          }
          const preview = `Medication → ${previewParts.join(' · ')}`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'medication_add' } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'medication_add',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload,
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    // G2-Early-25 — propose discontinuing an existing medication (soft-delete). The lists row
    // is preserved with activity=0 + enddate=NOW() for HIPAA audit. Get the medication_uuid
    // from a prior get_medications call.
    propose_medication_discontinue: tool({
      description:
        'Propose discontinuing an existing active medication (soft-delete on the lists row). Use this when the physician asks to stop a medication ("d/c Lisinopril, replacing with Losartan"). The row is hidden from the active med list but preserved with audit (activity=0, enddate=NOW()) — never hard-deleted. Get medication_uuid from a prior get_medications call.',
      inputSchema: medicationDiscontinueSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_medication_discontinue',
          meta: {},
        });
        try {
          const proposalId = randomUUID();
          const medicationUuid = input.medication_uuid.toLowerCase();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'medication_discontinue',
            payload: { medication_uuid: medicationUuid },
          });

          const preview = `Discontinue medication → row ${medicationUuid.slice(0, 8)}…`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'medication_discontinue' } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'medication_discontinue',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload: { medication_uuid: medicationUuid },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    // G2-Early-25 — propose soft-deleting an existing allergy row. Mirrors the medication
    // discontinue shape since allergies live on the same lists table.
    propose_allergy_delete: tool({
      description:
        'Propose soft-deleting an existing allergy row from the patient\'s allergy list. Use this only when the physician explicitly asks to remove an allergy (e.g. "she\'s no longer allergic to penicillin, take it off the list"). For allergy add or update use propose_allergy_write. The row is hidden via activity=0 but preserved for audit. Get allergy_uuid from a prior get_allergies call.',
      inputSchema: allergyDeleteSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_allergy_delete',
          meta: {},
        });
        try {
          const proposalId = randomUUID();
          const allergyUuid = input.allergy_uuid.toLowerCase();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'allergy_delete',
            payload: { allergy_uuid: allergyUuid },
          });

          const preview = `Remove allergy → row ${allergyUuid.slice(0, 8)}…`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'allergy_delete' } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'allergy_delete',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload: { allergy_uuid: allergyUuid },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    // G2-Early-25 — propose appending a family-history entry (e.g. "mother — T2DM"). Idempotent
    // on the backend: if the same condition already appears in the relative's history column,
    // the apply step is a no-op accept.
    propose_family_history_add: tool({
      description:
        'Propose adding a family-history entry to the patient\'s history form (e.g. "mother had Type 2 Diabetes"). The relation must be one of: mother / father / sibling (or brother / sister) / offspring (or son / daughter / child) / spouse (or partner). Conditions are appended as free text; idempotent — adding the same condition twice for the same relation is a no-op accept.',
      inputSchema: familyHistoryAddSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_family_history_add',
          meta: { relation: input.relation },
        });
        try {
          const proposalId = randomUUID();
          const payload = {
            relation: input.relation,
            condition: input.condition.trim(),
          };

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'family_history_add',
            payload,
          });

          const preview = `Family history → ${input.relation}: ${input.condition.trim().slice(0, 200)}`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'family_history_add' } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'family_history_add',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload,
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    // G2-Final-12 — propose updating partial demographics fields on patient_data. Use only
    // when the physician explicitly asks to correct a name / DOB / sex / contact phone.
    propose_demographics_update: tool({
      description:
        'Propose a partial-update to the patient\'s demographics row (`patient_data`). Use only when the physician explicitly corrects a name, DOB, sex, or contact phone — never to fill empty fields silently. At least one demographic field must be supplied; unknown fields are rejected. `dob` must be in `YYYY-MM-DD` form. `sex` must be one of `Male` / `Female` / `Unknown` (OpenEMR option list).',
      inputSchema: demographicsUpdateSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'propose_demographics_update',
          meta: {},
        });
        try {
          const proposalId = randomUUID();

          const payload: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(input)) {
            if (key === 'patient_uuid' || value === undefined) {
              continue;
            }
            payload[key] = typeof value === 'string' ? value.trim() : value;
          }

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'demographics_update',
            payload,
          });

          const fields = Object.keys(payload);
          const preview = `Demographics update → ${fields.join(', ')}`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'demographics_update', fields } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'demographics_update',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload,
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    // G2-Early-25 — propose soft-deleting a previously-uploaded document (with cascade to its
    // extracted observations). Use this when the physician realizes they uploaded the wrong
    // file (wrong patient, mis-scanned page) and wants to start over.
    delete_uploaded_document: tool({
      description:
        'Propose soft-deleting a previously-uploaded document (e.g. mis-uploaded intake form, wrong-patient lab). Cascades to every Observation extracted from that document — they are also soft-deleted, not orphaned. Get docref_uuid from the upload acknowledgment or a prior list. The bytes + sidecar metadata are preserved for HIPAA audit; reads after delete return 404. To re-upload, repeat the original upload — a fresh DocRef will be minted (the deleted one is not resurrected).',
      inputSchema: documentDeleteSchema,
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'delete_uploaded_document',
          meta: {},
        });
        try {
          const proposalId = randomUUID();
          const docrefUuid = input.docref_uuid.toLowerCase();

          await insertPendingProposal(pool, {
            proposalId,
            conversationInternalId: ctx.conversationInternalId,
            patientUuid: input.patient_uuid.toLowerCase(),
            encounterId: null,
            writeTarget: 'document_delete',
            payload: { docref_uuid: docrefUuid },
          });

          const preview = `Delete uploaded document → ${docrefUuid.slice(0, 8)}…`;

          await span.end({ meta: { proposal_id: proposalId, write_target: 'document_delete' } });
          return {
            ok: true as const,
            proposal_id: proposalId,
            write_target: 'document_delete',
            preview,
            patient_uuid: input.patient_uuid.toLowerCase(),
            payload: { docref_uuid: docrefUuid },
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),

    // Update an existing pending proposal in place. The dashboard modal and
    // the CUI rail both observe the same row over SSE — the agent calls this
    // whenever the physician supplies a follow-up field after a propose_*_write.
    // Shallow-merge semantics; last-write-wins per top-level key. Same
    // proposal_id can be updated multiple times until the physician confirms
    // or rejects.
    update_proposal: tool({
      description:
        'Update an existing pending proposal with additional fields the physician has now supplied. Use after a propose_*_write call when the physician answers follow-up questions (e.g. "what was the reaction?" or "moderate or severe?"). The same proposal_id can be updated multiple times until the physician confirms or rejects. Shallow-merge: top-level keys in `payload` overwrite the matching keys on the existing proposal; absent keys are preserved.',
      inputSchema: z
        .object({
          patient_uuid: z.string().min(1),
          proposal_id: z.string().uuid(),
          payload: z.record(z.string(), z.unknown()),
        })
        .strict(),
      execute: async (input) => {
        const bound = assertBoundPatient(env, sessionToken, input.patient_uuid);
        if (!bound.ok) {
          return { ok: false as const, error: bound.error };
        }

        const span = await obs.recordToolCall({
          correlationId,
          toolName: 'update_proposal',
          meta: { proposal_id: input.proposal_id },
        });
        try {
          const existing = await fetchPendingProposal(pool, input.proposal_id);
          if (existing === null) {
            await span.end({ meta: { proposal_id: input.proposal_id, outcome: 'not_found' } });
            return { ok: false as const, error: 'proposal_not_found' as const };
          }

          if (existing.patientUuid.toLowerCase() !== input.patient_uuid.toLowerCase()) {
            await span.end({ meta: { proposal_id: input.proposal_id, outcome: 'patient_mismatch' } });
            return { ok: false as const, error: 'patient_mismatch' as const };
          }

          if (existing.status !== 'pending') {
            await span.end({ meta: { proposal_id: input.proposal_id, outcome: 'not_pending' } });
            return { ok: false as const, error: 'not_pending' as const };
          }

          const updated = await updatePendingProposalPayload(pool, input.proposal_id, input.payload);
          if (updated === null) {
            // Race: row finalized between fetch and update.
            await span.end({ meta: { proposal_id: input.proposal_id, outcome: 'not_pending' } });
            return { ok: false as const, error: 'not_pending' as const };
          }

          broadcast(input.proposal_id, 'payload_updated', {
            proposal_id: updated.proposalId,
            payload: updated.payload,
          });

          await span.end({
            meta: {
              proposal_id: updated.proposalId,
              write_target: updated.writeTarget,
              merged_keys: Object.keys(input.payload),
            },
          });

          return {
            ok: true as const,
            proposal_id: updated.proposalId,
            payload: updated.payload,
          };
        } catch (e) {
          await span.end({ error: e });
          throw e;
        }
      },
    }),
  };
}

export const exportedSchemasGate4 = {
  chiefSchema,
  chiefComplaintDeleteSchema,
  clinicalNoteSchema,
  clinicalNoteEditSchema,
  vitalsSchema,
  vitalsDeleteSchema,
  tobaccoSchema,
  allergySchema,
  medicationAddSchema,
  medicationDiscontinueSchema,
  allergyDeleteSchema,
  familyHistoryAddSchema,
  documentDeleteSchema,
  demographicsUpdateSchema,
};
