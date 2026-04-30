/**
 * G2-06 — typed Context Service client.
 *
 * Verifies (PRD §5.3 + §4.4 / §4.5 wire contract):
 *  - Zod rejection on malformed module response.
 *  - Correlation id, session token, and shared-secret header propagation on every call.
 *  - Source-pack shape preserved through the typed surface.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { OpenEmrCallError, getAllergies, getIdentity } from '../../src/openemr/client.js';
import { testEnv } from '../helpers/env-fixture.js';

const CTX = { sessionToken: 'sess-tok', correlationId: 'corr-42' };
const PATIENT = '11111111-2222-3333-4444-555555555555';

const SOURCE_PACK = {
  resource_family: 'allergy_intolerance',
  table: 'lists',
  row_id: 17,
  uuid: 'src-uuid-1',
  as_of: '2026-04-29T00:00:00Z',
  retrieval_path: 'context/allergies.php',
  navigation_hint: { kind: 'list', params: { type: 'allergy' } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenEMR client header propagation (PRD §5.3)', () => {
  it('sends X-Correlation-Id, X-Session-Token, X-Internal-Auth on getIdentity', async () => {
    const env = testEnv();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        correlation_id: CTX.correlationId,
        data: {
          first_name: 'Jane',
          last_name: 'Doe',
          dob: '1980-01-01',
          source_pack: { ...SOURCE_PACK, resource_family: 'patient', retrieval_path: 'context/identity.php' },
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const row = await getIdentity(env, CTX, PATIENT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${env.OPENEMR_MODULE_BASE_URL}/context/identity.php`);
    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('X-Correlation-Id')).toBe(CTX.correlationId);
    expect(headers.get('X-Session-Token')).toBe(CTX.sessionToken);
    expect(headers.get('X-Internal-Auth')).toBe(env.OPENEMR_MODULE_SHARED_SECRET);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      session_token: CTX.sessionToken,
      patient_uuid: PATIENT,
    });
    expect(row.source_pack.resource_family).toBe('patient');
  });

  it('sends the same header trio on getAllergies and preserves array data', async () => {
    const env = testEnv();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        correlation_id: CTX.correlationId,
        data: [
          {
            substance: 'Penicillin',
            reaction: 'Hives',
            severity: 'moderate',
            status: 'active',
            source_pack: SOURCE_PACK,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rows = await getAllergies(env, CTX, PATIENT);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.substance).toBe('Penicillin');
    expect(rows[0]?.source_pack.uuid).toBe('src-uuid-1');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('X-Internal-Auth')).toBe(env.OPENEMR_MODULE_SHARED_SECRET);
  });
});

describe('OpenEMR client error mapping', () => {
  it('throws OpenEmrCallError(503) on network failure (no 5xx leakage)', async () => {
    const env = testEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:8300');
      }),
    );
    await expect(getIdentity(env, CTX, PATIENT)).rejects.toBeInstanceOf(OpenEmrCallError);
    await expect(getIdentity(env, CTX, PATIENT)).rejects.toMatchObject({
      message: 'openemr_network_error',
      status: 503,
    });
  });

  it('throws OpenEmrCallError on non-200 with module error body', async () => {
    const env = testEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'active_chart_mismatch' }, 403)),
    );
    await expect(getIdentity(env, CTX, PATIENT)).rejects.toMatchObject({
      message: 'active_chart_mismatch',
      status: 403,
    });
  });

  it('rejects malformed module shape via Zod (G2-06 negative)', async () => {
    const env = testEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          data: { first_name: 'Jane' /* missing source_pack */ },
        }),
      ),
    );
    await expect(getIdentity(env, CTX, PATIENT)).rejects.toMatchObject({
      message: 'openemr_schema_identity',
      status: 500,
    });
  });

  it('rejects malformed allergies array shape (G2-06 negative)', async () => {
    const env = testEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          data: [{ substance: 'Penicillin' /* missing severity, source_pack */ }],
        }),
      ),
    );
    await expect(getAllergies(env, CTX, PATIENT)).rejects.toMatchObject({
      message: 'openemr_schema_allergies',
      status: 500,
    });
  });
});
