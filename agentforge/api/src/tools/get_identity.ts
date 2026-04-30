import { tool } from 'ai';
import { z } from 'zod';
import type { Env } from '../env.js';
import { OpenEmrCallError, getIdentity } from '../openemr/client.js';
import type { Observability } from '../observability/index.js';
import { assertBoundPatient } from './_binding.js';

export function createGetIdentityTool(
  env: Env,
  sessionToken: string,
  obs: Observability,
  correlationId: string,
) {
  return tool({
    description:
      'Load patient demographics for the chart-bound patient. Every clinical claim must cite a source_pack from tools.',
    inputSchema: z.object({ patient_uuid: z.string().min(1) }),
    execute: async ({ patient_uuid }) => {
      const bound = assertBoundPatient(env, sessionToken, patient_uuid);
      if (!bound.ok) {
        return { ok: false as const, error: bound.error };
      }

      await obs.recordToolCall({ correlationId, toolName: 'get_identity', meta: {} });

      try {
        const ctx = { sessionToken, correlationId };
        const row = await getIdentity(env, ctx, patient_uuid);
        return {
          ok: true as const,
          data: row,
          source_packs: [row.source_pack],
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
