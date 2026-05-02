/**
 * App-level regression tests.
 *
 * Covers:
 *   - Post-deploy P3 fix: the panel refresh control fires
 *     `postPresentPatient(..., force_refresh=true)` *before* reloading the
 *     iframe so the agent-side 2-hour brief cache is busted.
 *   - Brief-consistency-cache fix (G3-11 v2): the CUI now self-triggers the
 *     auto-brief on chart bind (no host postMessage), replays from the
 *     per-tab payload cache on remount, and surfaces a Retry button on
 *     failure instead of pinning the rail blank.
 */
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { briefPayloadStorageKey } from './chat/brief_cache.js';
import { conversationPayloadStorageKey } from './chat/conversation_cache.js';
import type { ChatMessage } from './types/chat.js';

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
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

/** Mock fetch for the brief auto-fire flow: handshake + present-patient. */
function makeBriefFetch(opts: {
  briefText?: string;
  presentResponse?: () => Promise<Response> | Response;
}): ReturnType<typeof vi.fn> {
  const briefText = opts.briefText ?? 'auto brief';
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/handshake/redeem')) {
      return new Response(
        JSON.stringify({
          session_token: 'tok.auto-fire',
          identity: { user_id: 1, patient_uuid_present: true, encounter_id_present: true },
          expires_at: '2099-01-01T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/present-patient')) {
      if (opts.presentResponse !== undefined) {
        return opts.presentResponse();
      }
      return new Response(
        JSON.stringify({
          ok: true,
          blocks: [{ type: 'text', text: briefText }],
          correlation_id: 'cp-auto',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
}

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

describe('App — panel refresh control (P3 cache-bust)', () => {
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

    const refreshBtn = await waitFor(() => screen.getByRole('button', { name: /refresh clinical co-pilot/i }));

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
    const refreshBtn = await waitFor(() => screen.getByRole('button', { name: /refresh clinical co-pilot/i }));

    fireEvent.click(refreshBtn);

    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('App — brief auto-trigger (G3-11 v2)', () => {
  it('renders the brief once when the handshake reaches ready', async () => {
    const fetchMock = makeBriefFetch({ briefText: 'auto-fire-once' });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    await screen.findByText(/auto-fire-once/);
    expect(presentPatientCalls(fetchMock)).toHaveLength(1);
    const body = JSON.parse(presentPatientCalls(fetchMock)[0]!.init.body as string) as Record<string, unknown>;
    // The auto-trigger must NOT pass force_refresh — that path is only for
    // the explicit panel refresh control (P3 cache-bust).
    expect(body.force_refresh).toBeUndefined();
  });

  it('does NOT double-prepend the brief under React StrictMode', async () => {
    const fetchMock = makeBriefFetch({ briefText: 'strict-once' });
    globalThis.fetch = fetchMock as typeof fetch;

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await screen.findByText(/strict-once/);
    // The brief renders inside an assistant message; under StrictMode the
    // double-effect previously caused a double-prepend (visible as two
    // identical text blocks). The state machine + briefInFlightRef pair
    // collapses both runs into a single network call AND a single render.
    const briefMatches = await screen.findAllByText(/strict-once/);
    expect(briefMatches).toHaveLength(1);
    expect(presentPatientCalls(fetchMock)).toHaveLength(1);
  });

  it('replays from sessionStorage cache without firing a network call on remount', async () => {
    const fetchMock = makeBriefFetch({ briefText: 'should-not-fire' });
    globalThis.fetch = fetchMock as typeof fetch;

    // Pre-populate the per-tab payload cache as if a prior mount had
    // already fetched and stored the brief.
    window.sessionStorage.setItem(
      briefPayloadStorageKey('pat-app-test'),
      JSON.stringify({
        blocks: [{ type: 'text', text: 'cached-replay' }],
        citation_navigation: {},
        storedAt: Date.now(),
      }),
    );

    render(<App />);

    await screen.findByText(/cached-replay/);
    // Crucially: NO /present-patient call. The cache replay path paints
    // the rail without a network round-trip — the failure mode that used
    // to leave the rail blank on every iframe re-mount.
    expect(presentPatientCalls(fetchMock)).toHaveLength(0);
  });

  it('renders a Retry brief button when the auto-fire fails, and recovers on click', async () => {
    let presentCallNumber = 0;
    const fetchMock = makeBriefFetch({
      presentResponse: () => {
        presentCallNumber += 1;
        if (presentCallNumber === 1) {
          throw new TypeError('first attempt fails');
        }
        return new Response(
          JSON.stringify({
            ok: true,
            blocks: [{ type: 'text', text: 'recovered after retry' }],
            correlation_id: 'cp-retry',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    const retryBtn = await screen.findByRole('button', { name: /retry brief/i });
    expect(presentPatientCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    await screen.findByText(/recovered after retry/);
    expect(presentPatientCalls(fetchMock)).toHaveLength(2);
  });

  it('does not auto-fire while no patient is bound (handshake stays in error)', async () => {
    clearDocumentHints();
    document.documentElement.setAttribute('data-launch-code', 'lc-no-patient');
    // No data-patient-uuid → handshake refuses with no_chart_bound.
    const fetchMock = makeBriefFetch({});
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    // The chart-required UI surfaces; the brief must NOT auto-fire.
    await screen.findByText(/Open a patient chart to begin/);
    expect(presentPatientCalls(fetchMock)).toHaveLength(0);
  });
});

/**
 * Conversation persistence across hard reload — mirrors the brief cache
 * pattern (per-tab sessionStorage, keyed on patient_uuid only), but
 * persists the full `messages` array so a Refresh-chart click no longer
 * wipes an in-progress dialog. Resolved proposal cards survive the
 * reload via the new `resolved` field on `ChatBlock`, lifted out of
 * `ProposalBlock`'s component-local `useState`.
 */
describe('App — conversation cache replay (post-Refresh-chart persistence)', () => {
  it('replays a cached conversation on mount and skips /present-patient', async () => {
    const cached: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: 'cached brief from earlier' }] },
      { role: 'user', blocks: [{ type: 'text', text: 'follow-up question' }] },
      { role: 'assistant', blocks: [{ type: 'text', text: 'cached follow-up answer' }] },
    ];
    window.sessionStorage.setItem(
      conversationPayloadStorageKey('pat-app-test'),
      JSON.stringify({ messages: cached, storedAt: Date.now() }),
    );

    const fetchMock = makeBriefFetch({ briefText: 'should-not-fire-server-side' });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    await screen.findByText(/cached brief from earlier/);
    expect(screen.getByText(/follow-up question/)).toBeInTheDocument();
    expect(screen.getByText(/cached follow-up answer/)).toBeInTheDocument();
    // Crucially: the cached conversation supersedes the brief auto-fire,
    // so /present-patient is never called. This is the path that proves
    // a Refresh-chart reload does not nuke an in-progress dialog.
    expect(presentPatientCalls(fetchMock)).toHaveLength(0);
  });

  it('cached conversation supersedes the brief cache on remount', async () => {
    // Both caches are populated. The conversation cache wins because
    // it's the more specific replay (the brief is already inside the
    // conversation messages, and only the conversation cache preserves
    // a resolved proposal's `resolved` field).
    window.sessionStorage.setItem(
      briefPayloadStorageKey('pat-app-test'),
      JSON.stringify({
        blocks: [{ type: 'text', text: 'brief-cache-content' }],
        citation_navigation: {},
        storedAt: Date.now(),
      }),
    );
    const conv: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: 'conv-cache-content' }] },
    ];
    window.sessionStorage.setItem(
      conversationPayloadStorageKey('pat-app-test'),
      JSON.stringify({ messages: conv, storedAt: Date.now() }),
    );

    const fetchMock = makeBriefFetch({});
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    await screen.findByText(/conv-cache-content/);
    expect(screen.queryByText(/brief-cache-content/)).toBeNull();
    expect(presentPatientCalls(fetchMock)).toHaveLength(0);
  });

  it('renders a cached proposal with resolved=accepted as already accepted (no action buttons)', async () => {
    const cached: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'proposal',
            proposal_id: 'prop-already-resolved',
            write_target: 'vitals',
            preview: 'BP 132/84',
            resolved: { phase: 'accepted' },
          },
        ],
      },
    ];
    window.sessionStorage.setItem(
      conversationPayloadStorageKey('pat-app-test'),
      JSON.stringify({ messages: cached, storedAt: Date.now() }),
    );

    const fetchMock = makeBriefFetch({});
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    // The proposal preview text renders as part of the cached card.
    await screen.findByText(/BP 132\/84/);
    // Buttons are gone because the card is already in its terminal
    // `accepted` phase (initialized from `block.resolved` rather than
    // defaulting to `idle`).
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    // The "Accepted." status pill is the user-visible signal that the
    // resolution survived the reload.
    expect(screen.getByText(/Accepted\./)).toBeInTheDocument();
  });

  it('persists the resolved field to the conversation cache after Confirm so a subsequent mount sees it accepted', async () => {
    // Seed a conversation with an UNRESOLVED proposal — the user is
    // about to click Confirm, and we'll verify the cache picks up the
    // resolution before the next reload.
    const seed: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'proposal',
            proposal_id: 'prop-stamp-1',
            write_target: 'vitals',
            preview: 'BP 118/72',
          },
        ],
      },
    ];
    window.sessionStorage.setItem(
      conversationPayloadStorageKey('pat-app-test'),
      JSON.stringify({ messages: seed, storedAt: Date.now() }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/handshake/redeem')) {
        return new Response(
          JSON.stringify({
            session_token: 'tok.confirm-stamp',
            identity: { user_id: 1, patient_uuid_present: true, encounter_id_present: true },
            expires_at: '2099-01-01T00:00:00Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/confirm')) {
        return new Response(JSON.stringify({ ok: true, accepted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    render(<App />);

    const confirmBtn = await screen.findByRole('button', { name: 'Confirm' });

    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // Wait for the card to flip into its terminal "accepted" phase.
    await waitFor(() => {
      expect(screen.getByText(/Accepted\./)).toBeInTheDocument();
    });

    // The conversation-cache write effect runs whenever `messages`
    // changes, so the resolved field must now be in sessionStorage. A
    // subsequent mount would replay the proposal as already accepted —
    // exactly the property that prevents a "double-confirm" UX bug
    // after a Refresh-chart reload.
    await waitFor(() => {
      const raw = window.sessionStorage.getItem(conversationPayloadStorageKey('pat-app-test'));
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw ?? '{}') as { messages: ChatMessage[] };
      const block = parsed.messages[0]?.blocks[0];
      expect(block).toMatchObject({
        type: 'proposal',
        proposal_id: 'prop-stamp-1',
        resolved: { phase: 'accepted' },
      });
    });
  });
});
