import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createObservability } from '../../src/observability/index.js';
import { testEnv } from '../helpers/env-fixture.js';
import { createStubPgPool } from '../helpers/stub-pg-pool.js';

describe('POST /handshake/redeem', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'should-not-hit' }), { status: 500 });
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('returns 401 invalid_launch_code on malformed body', async () => {
    const env = testEnv();
    const app = buildApp(env, createObservability(env), createStubPgPool());
    const res = await app.request('/handshake/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('mints session token when module redeems successfully', async () => {
    const env = testEnv();
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          user_id: 7,
          patient_uuid: 'pat-u',
          encounter_id: 3,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = buildApp(env, createObservability(env), createStubPgPool());
    const res = await app.request('/handshake/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch_code: 'abcd' }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('X-Internal-Auth')).toBe(env.OPENEMR_MODULE_SHARED_SECRET);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.session_token).toBe('string');
    expect((body.session_token as string).includes('.')).toBe(true);
    expect(body.identity).toEqual({
      user_id: 7,
      patient_uuid_present: true,
      encounter_id_present: true,
    });
  });

  it('maps module auth failures to generic 401', async () => {
    const env = testEnv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ error: 'invalid_launch_code' }), { status: 403 });
      }),
    );
    const app = buildApp(env, createObservability(env), createStubPgPool());
    const res = await app.request('/handshake/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch_code: 'x' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('invalid_launch_code');
  });
});
