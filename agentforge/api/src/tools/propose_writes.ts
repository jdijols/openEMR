/**
 * PRD §5.4 — propose-write tools (Gate 4 G4-05). Each call mints `proposal_id` and persists a pending row.
 */

import { randomUUID } from 'node:crypto';
import { tool } from 'ai';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Env } from '../env.js';
import type { Observability } from '../observability/index.js';
import { insertPendingProposal } from '../conversations/store.js';
import { assertBoundPatient } from './_binding.js';

const chiefSchema = z.object({
  patient_uuid: z.string().min(1),
  encounter_id: z.number().int().positive(),
  reason: z.string().min(1).max(4000),
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

const allergyActionSchema = z.enum(['add', 'update_reaction', 'update_severity']);

const allergySchema = z
  .object({
    patient_uuid: z.string().min(1),
    action: allergyActionSchema,
    substance: z.string().min(1).max(255).optional(),
    allergy_uuid: z.string().uuid().optional(),
    reaction: z.string().min(1).max(4000).optional(),
    severity: z.enum(['mild', 'moderate', 'severe', 'life_threatening', 'unknown']).optional(),
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

    propose_allergy_write: tool({
      description: 'Propose allergy add/update (reaction / severity fields). Delete is intentionally not represented.',
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
            allergyPayload['substance'] = input.substance;
          }

          if (input.allergy_uuid !== undefined) {
            allergyPayload['allergy_uuid'] = input.allergy_uuid.toLowerCase();
          }

          if (input.reaction !== undefined) {
            allergyPayload['reaction'] = input.reaction;
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
  };
}

export const exportedSchemasGate4 = {
  chiefSchema,
  vitalsSchema,
  tobaccoSchema,
  allergySchema,
};
