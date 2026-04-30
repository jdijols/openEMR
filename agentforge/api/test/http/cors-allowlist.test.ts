import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createObservability } from '../../src/observability/index.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('CORS allowlist (PRD §8.4)', () => {
  it('does not set Access-Control-Allow-Origin for disallowed origins', async () => {
    const env = testEnv({ CUI_ALLOWED_ORIGINS: 'http://allowed.example' });
    const app = buildApp(env, createObservability(env));
    const res = await app.request('http://localhost/handshake/redeem', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('sets ACAO for allowed origin', async () => {
    const env = testEnv({ CUI_ALLOWED_ORIGINS: 'http://allowed.example' });
    const app = buildApp(env, createObservability(env));
    const res = await app.request('http://localhost/health', {
      headers: { Origin: 'http://allowed.example' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://allowed.example');
  });
});
