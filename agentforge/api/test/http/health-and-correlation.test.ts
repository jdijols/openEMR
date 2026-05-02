import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createObservability } from '../../src/observability/index.js';
import { testEnv } from '../helpers/env-fixture.js';
import { createStubPgPool } from '../helpers/stub-pg-pool.js';

const ORIGINAL_FETCH = globalThis.fetch;

function stubProbeFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): void {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(typeof input === 'string' ? input : input.toString(), init ?? {}),
  ) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('correlation + health', () => {
  const env = testEnv();
  let app = buildApp(env, createObservability(env), createStubPgPool());

  beforeEach(() => {
    app = buildApp(env, createObservability(env), createStubPgPool());
    stubProbeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it('every response includes X-Correlation-Id', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('preserves inbound X-Correlation-Id', async () => {
    const res = await app.request('/health', { headers: { 'x-correlation-id': 'prefixed-cid' } });
    expect(res.headers.get('x-correlation-id')).toBe('prefixed-cid');
  });

  it('GET /health returns version, providers, and dep readiness for Gate 4 chat', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.version).toBeTruthy();
    expect(body.providers).toEqual({ llm: env.LLM_PROVIDER, stt: env.STT_PROVIDER });
    expect(body.deps).toEqual({
      openemr_module: 'ok',
      postgres: 'reachable',
      langfuse: 'ok',
    });
  });
});

describe('GET /health — Langfuse reachability probe', () => {
  const env = testEnv();

  it('reports langfuse: "ok" when the public health endpoint returns 200', async () => {
    stubProbeFetch((url) => {
      if (url.includes('/api/public/health')) {
        return new Response(JSON.stringify({ status: 'OK' }), { status: 200 });
      }
      // OpenEMR module probe path — return 200 so it doesn't dominate the assertion.
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const app = buildApp(env, createObservability(env), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.langfuse).toBe('ok');
    expect(body.ok).toBe(true);
  });

  it('reports langfuse: "unreachable" on non-200 response without flipping overall ok', async () => {
    stubProbeFetch((url) => {
      if (url.includes('/api/public/health')) {
        return new Response('boom', { status: 503 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const app = buildApp(env, createObservability(env), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.langfuse).toBe('unreachable');
    // Losing observability does not break the chat surface — overall ok stays true.
    expect(body.ok).toBe(true);
  });

  it('reports langfuse: "unreachable" when the probe fetch rejects', async () => {
    stubProbeFetch((url) => {
      if (url.includes('/api/public/health')) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const app = buildApp(env, createObservability(env), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.langfuse).toBe('unreachable');
    expect(body.ok).toBe(true);
  });

  it('reports langfuse: "not_configured" when keys are placeholder values', async () => {
    stubProbeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const placeholderEnv = {
      ...env,
      LANGFUSE_PUBLIC_KEY: 'replace-me',
      LANGFUSE_SECRET_KEY: 'replace-me',
    };
    const app = buildApp(placeholderEnv, createObservability(placeholderEnv), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.langfuse).toBe('not_configured');
    // Placeholder Langfuse keys are a deploy-time concern, not a runtime failure.
    expect(body.ok).toBe(true);
  });
});

describe('GET /health — OpenEMR module shared-secret probe (P1 hardening)', () => {
  const env = testEnv();

  beforeEach(() => {
    // baseline: every test starts with no fetch stub; each test installs its own
  });

  it('reports openemr_module: "ok" when the module returns 200 to the probe', async () => {
    stubProbeFetch((url, init) => {
      expect(url).toBe(`${env.OPENEMR_MODULE_BASE_URL}/health/internal_auth.php`);
      const headers = new Headers(init.headers as Record<string, string>);
      expect(headers.get('X-Internal-Auth')).toBe(env.OPENEMR_MODULE_SHARED_SECRET);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const app = buildApp(env, createObservability(env), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.openemr_module).toBe('ok');
    expect(body.ok).toBe(true);
  });

  it('reports openemr_module: "secret_mismatch" on 401 from the probe and flips ok=false', async () => {
    stubProbeFetch(() =>
      new Response(JSON.stringify({ error: 'invalid_internal_auth' }), { status: 401 }),
    );
    const app = buildApp(env, createObservability(env), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.openemr_module).toBe('secret_mismatch');
    expect(body.ok).toBe(false);
  });

  it('reports openemr_module: "unreachable" when fetch rejects (network down / DNS)', async () => {
    stubProbeFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    const app = buildApp(env, createObservability(env), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.openemr_module).toBe('unreachable');
    expect(body.ok).toBe(false);
  });

  it('reports openemr_module: "unreachable" on unexpected non-200/401 status (e.g. 500)', async () => {
    stubProbeFetch(() => new Response('boom', { status: 500 }));
    const app = buildApp(env, createObservability(env), createStubPgPool());

    const body = (await (await app.request('/health')).json()) as { ok: boolean; deps: Record<string, string> };
    expect(body.deps.openemr_module).toBe('unreachable');
    expect(body.ok).toBe(false);
  });
});
