import { tool } from 'ai';
import { z } from 'zod';
import type { Env } from '../env.js';
import { OpenEmrCallError, getAllergies } from '../openemr/client.js';
import type { Observability } from '../observability/index.js';
import { assertBoundPatient } from './_binding.js';

export function createGetAllergiesTool(
  env: Env,
  sessionToken: string,
  obs: Observability,
  correlationId: string,
) {
  return tool({
    description: 'Load structured allergy list for the chart-bound patient (substance, reaction, severity, status).',
    inputSchema: z.object({ patient_uuid: z.string().min(1) }),
    execute: async ({ patient_uuid }) => {
      const bound = assertBoundPatient(env, sessionToken, patient_uuid);
      if (!bound.ok) {
        return { ok: false as const, error: bound.error };
      }

      await obs.recordToolCall({ correlationId, toolName: 'get_allergies', meta: {} });

      try {
        const ctx = { sessionToken, correlationId };
        const rows = await getAllergies(env, ctx, patient_uuid);
        return {
          ok: true as const,
          data: rows,
          source_packs: rows.map((r) => r.source_pack),
        };
      } catch (e) {
        if (e instanceof OpenEmrCallError) {
          return { ok: false as const, error: 'openemr_error' as const };
        }
        throw e;
      }
    },
  });
}
