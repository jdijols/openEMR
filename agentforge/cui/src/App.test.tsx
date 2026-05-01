/**
 * App-level regression tests.
 *
 * Currently scoped to the post-deploy P3 fix: clicking "Refresh chart" must
 * fire `postPresentPatient(..., force_refresh=true)` *before* reloading the
 * iframe so the agent-side 30-minute brief cache is busted (otherwise a stale
 * blank brief survives the reload and pins the operator to a blank rail for
 * the full TTL — the exact P3 reproducer).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_RELOAD = window.location.reload;

function setDocumentHints(launchCode: string, patientUuid: string): void {
  document.documentElement.setAttribute('data-launch-code', launchCode);
  document.documentElement.setAttribute('data-patient-uuid', patientUuid);
}

function clearDocumentHints(): void {
  document.documentElement.removeAttribute('data-launch-code');
  document.documentElement.removeAttribute('data-patient-uuid');
}

beforeEach(() => {
  window.__AGENTFORGE_CUI__ = { apiBase: 'http://api.local' };
  setDocumentHints('lc-app-test', 'pat-app-test');
  // jsdom's window.location.reload is read-only; replace via Object.defineProperty.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

afterEach(() => {
  clearDocumentHints();
  delete (window as Partial<Window>).__AGENTFORGE_CUI__;
  globalThis.fetch = ORIGINAL_FETCH;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: ORIGINAL_RELOAD },
  });
  vi.restoreAllMocks();
});

function presentPatientCalls(
  fetchMock: ReturnType<typeof vi.fn>,
): { url: string; init: RequestInit }[] {
  return fetchMock.mock.calls
    .map(([input, init]) => ({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url,
      init: (init ?? {}) as RequestInit,
    }))
    .filter(({ url }) => url.endsWith('/present-patient'));
}

describe('App — Refresh chart button (P3 cache-bust)', () => {
  it('fires postPresentPatient with force_refresh: true before reloading the iframe', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/handshake/redeem')) {
        return new Response(
          JSON.stringify({
            session_token: 'tok.app-test',
            identity: { user_id: 1, patient_uuid_present: true, encounter_id_present: true },
            expires_at: '2099-01-01T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/present-patient')) {
        return new Response(
          JSON.stringify({ ok: true, blocks: [{ type: 'text', text: 'brief' }], correlation_id: 'cp' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    const refreshBtn = await waitFor(() => screen.getByRole('button', { name: /refresh chart binding/i }));

    const before = presentPatientCalls(fetchMock).length;
    fireEvent.click(refreshBtn);

    // The cache-bust call is fire-and-forget but is issued synchronously
    // before reload. Wait for it to land in the mock.
    await waitFor(() => {
      expect(presentPatientCalls(fetchMock).length).toBe(before + 1);
    });

    const calls = presentPatientCalls(fetchMock);
    const last = calls[calls.length - 1]!;
    const body = JSON.parse(last.init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      session_token: 'tok.app-test',
      patient_uuid: 'pat-app-test',
      force_refresh: true,
    });

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads even when the cache-bust call rejects (fire-and-forget tolerance)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/handshake/redeem')) {
        return new Response(
          JSON.stringify({
            session_token: 'tok.app-test-2',
            identity: { user_id: 1, patient_uuid_present: true, encounter_id_present: true },
            expires_at: '2099-01-01T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/present-patient')) {
        // Reject every /present-patient call — the explicit cache-bust
        // failure must NOT block the reload.
        throw new TypeError('network down');
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);
    const refreshBtn = await waitFor(() => screen.getByRole('button', { name: /refresh chart binding/i }));

    fireEvent.click(refreshBtn);

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});
