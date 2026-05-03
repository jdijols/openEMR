import { tool } from 'ai';
import { z } from 'zod';
import type { Env } from '../env.js';
import { OpenEmrCallError, getChartContextRows, type OpenEmrClientContext } from '../openemr/client.js';
import type { Observability } from '../observability/index.js';
import { assertBoundPatient } from './_binding.js';

function readTool(
  env: Env,
  sessionToken: string,
  obs: Observability,
  correlationId: string,
  toolName: string,
  path: string,
  description: string,
) {
  return tool({
    description,
    inputSchema: z.object({ patient_uuid: z.string().min(1) }),
    execute: async ({ patient_uuid }: { readonly patient_uuid: string }) => {
      const bound = assertBoundPatient(env, sessionToken, patient_uuid);
      if (!bound.ok) {
        return { ok: false as const, error: bound.error };
      }

      const span = await obs.recordToolCall({ correlationId, toolName, meta: {} });
      try {
        const ctx: OpenEmrClientContext = { sessionToken, correlationId };
        const rows = await getChartContextRows(env, ctx, patient_uuid, path);
        await span.end({ meta: { row_count: rows.length } });
        return {
          ok: true as const,
          data: rows,
          source_packs: rows.map((r) => r.source_pack),
        };
      } catch (e) {
        if (e instanceof OpenEmrCallError) {
          await span.end({ meta: { outcome: 'openemr_error' } });
          return { ok: false as const, error: 'openemr_error' as const };
        }

        await span.end({ error: e });
        throw e;
      }
    },
  });
}

/** Gate 3 — bounded OpenEMR Agent Context reads (PRD §4.4 remainder). */
export function createChartContextReadTools(env: Env, sessionToken: string, obs: Observability, correlationId: string) {
  return {
    get_encounters: readTool(env, sessionToken, obs, correlationId, 'get_encounters', 'context/encounters.php', 'Recent encounters with citation-ready packs'),
    get_problems: readTool(env, sessionToken, obs, correlationId, 'get_problems', 'context/problems.php', 'Active medical problems with packs'),
    get_meds: readTool(env, sessionToken, obs, correlationId, 'get_meds', 'context/meds.php', 'Active medications unified view'),
    get_vitals: readTool(env, sessionToken, obs, correlationId, 'get_vitals', 'context/vitals.php', 'Recent vitals with packs'),
    get_labs: readTool(env, sessionToken, obs, correlationId, 'get_labs', 'context/labs.php', 'Recent labs with packs'),
    get_notes_metadata: readTool(env, sessionToken, obs, correlationId, 'get_notes_metadata', 'context/notes_metadata.php', 'Note/document metadata rows only'),
    get_clinical_notes: readTool(env, sessionToken, obs, correlationId, 'get_clinical_notes', 'context/clinical_notes.php', 'Clinical Notes Form bodies (intake, progress, nursing) with narrative description text and citation packs'),
    get_social_history: readTool(env, sessionToken, obs, correlationId, 'get_social_history', 'context/social_history.php', 'Social history snapshots'),
  };
}
