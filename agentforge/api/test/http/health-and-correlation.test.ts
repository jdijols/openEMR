import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createObservability } from '../../src/observability/index.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('correlation + health', () => {
  const env = testEnv();
  const app = buildApp(env, createObservability(env));

  it('every response includes X-Correlation-Id', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('preserves inbound X-Correlation-Id', async () => {
    const res = await app.request('/health', { headers: { 'x-correlation-id': 'prefixed-cid' } });
    expect(res.headers.get('x-correlation-id')).toBe('prefixed-cid');
  });

  it('GET /health returns documented Gate 0 shape (deps unknown)', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.version).toBeTruthy();
    expect(body.providers).toEqual({ llm: env.LLM_PROVIDER, stt: env.STT_PROVIDER });
    expect(body.deps).toEqual({
      openemr_module: 'unknown',
      postgres: 'unknown',
      langfuse: 'unknown',
    });
  });
});
