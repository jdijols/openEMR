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
});
