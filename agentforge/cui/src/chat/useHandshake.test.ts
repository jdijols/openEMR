/**
 * G2-09 — handshake hook.
 *
 * Variant: data-attribute consumer (PRD §6.2 allows postMessage OR data-attr;
 * panel.php uses the data-attr path so launch codes never travel via URL).
 *
 * Verifies:
 *  - missing API base / launch code / patient context produce typed error states
 *  - happy path redeems and exposes the session token in memory only
 *  - no `localStorage` / `sessionStorage` writes happen in any branch (S5)
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHandshake } from './useHandshake.js';

function spyStorages(): { local: ReturnType<typeof vi.spyOn>; session: ReturnType<typeof vi.spyOn> } {
  const local = vi.spyOn(Storage.prototype, 'setItem');
  const session = vi.spyOn(Storage.prototype, 'setItem');
  return { local, session };
}

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  window.__AGENTFORGE_CUI__ = { apiBase: 'http://api.local' };
});

afterEach(() => {
  delete (window as Partial<Window>).__AGENTFORGE_CUI__;
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('useHandshake (PRD §6.2 / G2-09)', () => {
  it('reports missing_api_base when window injection is empty', async () => {
    delete (window as Partial<Window>).__AGENTFORGE_CUI__;
    const { result } = renderHook(() => useHandshake('lc-1', 'pat-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'error', message: 'missing_api_base' });
  });

  it('reports no_patient_context when patient uuid missing', async () => {
    const { result } = renderHook(() => useHandshake('lc-1', null));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'error', message: 'no_patient_context' });
  });

  it('reports missing_launch_code when no launch code is present', async () => {
    const { result } = renderHook(() => useHandshake(null, 'pat-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'error', message: 'missing_launch_code' });
  });

  it('redeems and exposes session_token in memory; no Web Storage writes (S5)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session_token: 'tok.in.memory',
          identity: { user_id: 1, patient_uuid_present: true, encounter_id_present: false },
          expires_at: '2026-04-30T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const storage = spyStorages();
    const { result } = renderHook(() => useHandshake('lc-good', 'pat-1'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current).toEqual({ status: 'ready', sessionToken: 'tok.in.memory' });

    expect(storage.local).not.toHaveBeenCalled();
    expect(storage.session).not.toHaveBeenCalled();
  });

  it('reports handshake_failed on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_launch_code' }), { status: 401 }),
    ) as typeof fetch;
    const { result } = renderHook(() => useHandshake('bad', 'pat-1'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'error', message: 'handshake_failed' });
  });
});

describe('useHandshake (G3-09 / PRD §6.6)', () => {
  it('enters no_chart_bound when redeem returns patient_uuid_present false', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session_token: 'tok.no-chart',
          identity: {
            user_id: 1,
            patient_uuid_present: false,
            encounter_id_present: false,
          },
          expires_at: '2099-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const { result } = renderHook(() => useHandshake('lc-chartless', 'pat-attr'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toEqual({ status: 'error', message: 'no_chart_bound' });
  });
});
