import { describe, expect, it, vi } from 'vitest';
import { assertBoundPatient } from '../../src/tools/_binding.js';
import { mintSessionToken, verifySessionToken } from '../../src/handshake/sessionToken.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('assertBoundPatient (PRD §5.5.3, S1)', () => {
  it('returns active_chart_mismatch for wrong patient and performs no downstream work', async () => {
    const env = testEnv();
    const now = Math.floor(Date.now() / 1000);
    const token = mintSessionToken(
      { user_id: 1, patient_uuid: 'abc-123', encounter_id: null },
      env.SESSION_TOKEN_SECRET,
      now,
      600,
    );

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = assertBoundPatient(env, token, 'xyz-999');
    expect(result).toEqual({ ok: false, error: 'active_chart_mismatch' });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('accepts matching patient_uuid', () => {
    const env = testEnv();
    const now = Math.floor(Date.now() / 1000);
    const token = mintSessionToken(
      { user_id: 1, patient_uuid: 'abc-123', encounter_id: null },
      env.SESSION_TOKEN_SECRET,
      now,
      600,
    );
    expect(assertBoundPatient(env, token, 'abc-123')).toEqual({ ok: true, patient_uuid: 'abc-123' });
  });
});

describe('session token round-trip', () => {
  it('verifySessionToken accepts minted token', () => {
    const env = testEnv();
    const now = Math.floor(Date.now() / 1000);
    const token = mintSessionToken(
      { user_id: 42, patient_uuid: 'p-1', encounter_id: 9 },
      env.SESSION_TOKEN_SECRET,
      now,
      1800,
    );
    const v = verifySessionToken(token, env.SESSION_TOKEN_SECRET);
    expect(v).not.toBeNull();
    expect(v?.user_id).toBe(42);
    expect(v?.patient_uuid).toBe('p-1');
    expect(v?.encounter_id).toBe(9);
  });
});
