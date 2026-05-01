/**
 * Gate 5 — GET /conversations/:id/recap (Bearer session, PRD §5.9 / S5-safe).
 */

import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createObservability } from '../../src/observability/index.js';
import { mintSessionToken } from '../../src/handshake/sessionToken.js';
import { testEnv } from '../helpers/env-fixture.js';
import type { Pool } from 'pg';

describe('GET /conversations/:id/recap', () => {
  it('returns classified items when session + patient match', async () => {
    const env = testEnv();
    const now = Math.floor(Date.now() / 1000);
    const patient = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const convExt = '99999999-bbbb-4ccc-dddd-eeeeeeeeeeee';
    const token = mintSessionToken(
      { user_id: 7, patient_uuid: patient, encounter_id: 1 },
      env.SESSION_TOKEN_SECRET,
      now,
      3600,
    );

    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const s = sql.toLowerCase();
      if (s.includes('from agentforge.conversations') && s.includes('external_id')) {
        expect(params?.[0]).toBe(convExt);
        return {
          rows: [{ id: '42', external_id: convExt, patient_uuid: patient, ended_at: null }],
        };
      }
      if (s.includes('from agentforge.pending_proposals')) {
        return {
          rows: [
            {
              proposal_id: 'pr1',
              conversation_internal_id: '42',
              patient_uuid: patient,
              encounter_id: null,
              write_target: 'vitals',
              payload: { preview: 'BP 120/80' },
              status: 'confirmed',
            },
          ],
        };
      }
      if (s.includes('from agentforge.turns')) {
        return {
          rows: [{ body: { blocks: [{ type: 'refusal', reason: 'No.' }] } }],
        };
      }
      return { rows: [] };
    });

    const pool = {
      query,
      connect: vi.fn(async () => ({
        query,
        release: vi.fn(),
      })),
    } as unknown as Pool;
    const app = buildApp(env, createObservability(env), pool);

    const res = await app.request(`/conversations/${encodeURIComponent(convExt)}/recap`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Patient-Uuid': patient,
      },
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean; items?: unknown[]; counts?: Record<string, number> };
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.counts?.confirmed).toBe(1);
    expect(json.counts?.refusal).toBe(1);
  });
});
