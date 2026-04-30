/**
 * G2-07 — Vercel AI SDK tools.
 *
 * Cross-patient block (S1) is exhaustively covered by binding-and-token.test.ts;
 * here we verify the on-success shape `{ok:true,data,source_packs}` plus the
 * "no HTTP on mismatch" invariant per tool, and that OpenEmrCallError is mapped
 * to a typed `{ok:false,error:'openemr_error'}` (no exception leaks to the model).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mintSessionToken } from '../../src/handshake/sessionToken.js';
import { createObservability } from '../../src/observability/index.js';
import { createGetAllergiesTool } from '../../src/tools/get_allergies.js';
import { createGetIdentityTool } from '../../src/tools/get_identity.js';
import { testEnv } from '../helpers/env-fixture.js';

const PATIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER = 'ffffffff-1111-2222-3333-444444444444';

function tokenFor(env: ReturnType<typeof testEnv>, patientUuid: string | null): string {
  return mintSessionToken(
    { user_id: 1, patient_uuid: patientUuid, encounter_id: null },
    env.SESSION_TOKEN_SECRET,
    Math.floor(Date.now() / 1000),
    600,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const SOURCE_PACK = {
  resource_family: 'patient',
  table: 'patient_data',
  row_id: 1,
  uuid: 'sp-1',
  as_of: '2026-04-29T00:00:00Z',
  retrieval_path: 'context/identity.php',
  navigation_hint: { kind: 'patient', params: {} },
};

describe('get_identity tool (PRD §5.4 / §5.5)', () => {
  it('returns {ok:true,data,source_packs} on bound patient', async () => {
    const env = testEnv();
    const obs = createObservability(env);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: { first_name: 'A', last_name: 'B', dob: '1990-01-01', source_pack: SOURCE_PACK },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const t = createGetIdentityTool(env, tokenFor(env, PATIENT), obs, 'corr');
    const res = await t.execute!({ patient_uuid: PATIENT }, { toolCallId: 'tc1', messages: [] });

    expect(res).toMatchObject({
      ok: true,
      data: expect.objectContaining({ first_name: 'A' }),
      source_packs: [expect.objectContaining({ uuid: 'sp-1' })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns active_chart_mismatch and makes ZERO HTTP calls on cross-patient args (S1)', async () => {
    const env = testEnv();
    const obs = createObservability(env);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const t = createGetIdentityTool(env, tokenFor(env, PATIENT), obs, 'corr');
    const res = await t.execute!({ patient_uuid: OTHER }, { toolCallId: 'tc2', messages: [] });

    expect(res).toEqual({ ok: false, error: 'active_chart_mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps OpenEmrCallError to typed openemr_error (no exception leak)', async () => {
    const env = testEnv();
    const obs = createObservability(env);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'oops' }), { status: 500 })),
    );

    const t = createGetIdentityTool(env, tokenFor(env, PATIENT), obs, 'corr');
    const res = await t.execute!({ patient_uuid: PATIENT }, { toolCallId: 'tc3', messages: [] });
    expect(res).toEqual({ ok: false, error: 'openemr_error' });
  });
});

describe('get_allergies tool (PRD §5.4 / §5.5)', () => {
  it('returns {ok:true,data,source_packs} with array data', async () => {
    const env = testEnv();
    const obs = createObservability(env);
    const allergyPack = { ...SOURCE_PACK, resource_family: 'allergy_intolerance', uuid: 'sp-2' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: [
              {
                substance: 'Penicillin',
                reaction: 'Hives',
                severity: 'mod',
                status: 'active',
                source_pack: allergyPack,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const t = createGetAllergiesTool(env, tokenFor(env, PATIENT), obs, 'corr');
    const res = (await t.execute!({ patient_uuid: PATIENT }, { toolCallId: 'tc4', messages: [] })) as unknown as {
      ok: true;
      data: unknown[];
      source_packs: { uuid: string }[];
    };

    expect(res.ok).toBe(true);
    expect(res.data).toHaveLength(1);
    expect(res.source_packs.map((p) => p.uuid)).toEqual(['sp-2']);
  });

  it('blocks cross-patient before HTTP (S1)', async () => {
    const env = testEnv();
    const obs = createObservability(env);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const t = createGetAllergiesTool(env, tokenFor(env, PATIENT), obs, 'corr');
    const res = await t.execute!({ patient_uuid: OTHER }, { toolCallId: 'tc5', messages: [] });
    expect(res).toEqual({ ok: false, error: 'active_chart_mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
