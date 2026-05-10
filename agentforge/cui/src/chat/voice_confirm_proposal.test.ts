/**
 * Gate 5 G4-09/G5-04 — voice confirm invokes proposal confirm.
 */

import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { tryConfirmProposalFromDictation } from './voice_confirm_proposal.js';

const FETCH = globalThis.fetch;

describe('tryConfirmProposalFromDictation', () => {
  afterEach(() => {
    globalThis.fetch = FETCH;
    vi.restoreAllMocks();
  });

  it('POSTs confirm when dictation matches confirm intent and a proposal id is present', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, accepted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;

    const ok = await tryConfirmProposalFromDictation('confirm that', 'prop-z', {
      apiBase: 'http://localhost:5010/',
      sessionToken: 'sess',
      patientUuid: 'patient-1',
      conversationId: '00000000-0000-4000-8000-000000000099',
    });

    expect(ok).toBe(true);
    const mockFetch = globalThis.fetch as unknown as Mock;
    expect(mockFetch.mock.calls.some((c) => `${c[0]}`.includes('/confirm'))).toBe(true);
  });

  it('does not fetch when phrase does not indicate confirm', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ok = await tryConfirmProposalFromDictation('maybe later', 'prop-z', {
      apiBase: 'http://localhost:5010/',
      sessionToken: 'sess',
      patientUuid: 'patient-1',
      conversationId: '00000000-0000-4000-8000-000000000099',
    });
    expect(ok).toBe(false);
    expect((globalThis.fetch as unknown as Mock).mock.calls.length).toBe(0);
  });

  // Phase 1 — voice "confirm" with an empty queue is a no-op (no fetch).
  // The Bus contract: App.tsx looks up the head via `findProposalQueue`; when
  // the queue is empty `head` is null, the lookup short-circuits to null, and
  // `tryConfirmProposalFromDictation` returns false without hitting the API.
  // Without this guard, a stray "confirm" utterance after the queue drains
  // could re-target a stale proposal id (the prior `findLatestOpenProposalId`
  // didn't filter resolved blocks — see proposal_lookup.test.ts).
  it('returns false without fetching when no proposal is at the head of the queue', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const ok = await tryConfirmProposalFromDictation('confirm that', null, {
      apiBase: 'http://localhost:5010/',
      sessionToken: 'sess',
      patientUuid: 'patient-1',
      conversationId: '00000000-0000-4000-8000-000000000099',
    });
    expect(ok).toBe(false);
    expect((globalThis.fetch as unknown as Mock).mock.calls.length).toBe(0);
  });

  it('targets the head proposal id supplied by the caller (FIFO contract)', async () => {
    // App.tsx is responsible for FIFO selection (findProposalQueue.head);
    // the voice helper just confirms whichever proposal_id arrives. This
    // test pins the helper's contract: it builds a /confirm URL containing
    // the EXACT id passed in, so the App.tsx integration is sound when it
    // passes the queue head.
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, accepted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;

    const ok = await tryConfirmProposalFromDictation('confirm that', 'prop-OLDEST', {
      apiBase: 'http://localhost:5010/',
      sessionToken: 'sess',
      patientUuid: 'patient-1',
      conversationId: '00000000-0000-4000-8000-000000000099',
    });

    expect(ok).toBe(true);
    const mockFetch = globalThis.fetch as unknown as Mock;
    // The lifecycle endpoint is /conversations/:cid/confirm — the proposal_id
    // travels in the JSON body, not the URL.
    const [url, init] = mockFetch.mock.calls[0] ?? [];
    expect(`${url}`).toContain('/confirm');
    const body = JSON.parse(`${(init as RequestInit | undefined)?.body ?? '{}'}`);
    expect(body.proposal_id).toBe('prop-OLDEST');
  });
});
