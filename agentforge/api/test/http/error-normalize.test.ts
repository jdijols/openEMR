import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createObservability } from '../../src/observability/index.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('error normalization (PRD §5.11, S6)', () => {
  it('returns generic internal_error with correlation_id and no stack or SQL in body', async () => {
    const env = testEnv();
    const app = buildApp(env, createObservability(env));
    app.get('/boom', () => {
      throw new Error(
        'SQLSTATE[42S02] Base table or view not found; stack at /app/x.php Jane Doe DOB 1980-01-01',
      );
    });
    const res = await app.request('/boom', { headers: { 'x-correlation-id': 'err-cid-99' } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('internal_error');
    expect(body.correlation_id).toBe('err-cid-99');
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/SQLSTATE|stack at|Jane Doe|1980-01-01|\\n\\s+at\\s/i);
  });
});
