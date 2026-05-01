/**
 * Gate 4 G4-09 — proposal confirm posts to `/conversations/{id}/confirm`.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MessageList } from './MessageList.js';
import type { ChatMessage } from '../types/chat.js';

const FETCH = globalThis.fetch;

describe('ProposalCard UX (§6.5.3 button path)', () => {
  beforeEach(() => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee' as `${string}-${string}-${string}-${string}-${string}`,
    );
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, accepted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = FETCH;
    vi.restoreAllMocks();
  });

  it('POSTs proposal confirm with external conversation thread id', async () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'proposal',
            proposal_id: 'prop-test-77',
            write_target: 'vitals',
            preview: 'BP 132/84, HR 78',
          },
        ],
      },
    ];

    const fetchMock = globalThis.fetch as unknown as Mock;

    render(
      <MessageList
        messages={messages}
        boundPatientUuid="pat-uu"
        proposalEnv={{
          apiBase: 'http://localhost:7777/',
          sessionToken: 'sess.tok',
          patientUuid: 'pat-uu',
          conversationId: 'conv-ext-aaa',
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(fetchMock.mock.calls.some((call) => `${call[0]}`.includes('/conversations/conv-ext-aaa/confirm'))).toBe(true);
    const bodyCalls = fetchMock.mock.calls.find((call) => `${call[0]}`.includes('/confirm'));
    expect(bodyCalls).toBeTruthy();
    const [, init] = bodyCalls!;
    expect(JSON.parse((init as { body?: string }).body ?? '{}')).toEqual({
      session_token: 'sess.tok',
      patient_uuid: 'pat-uu',
      proposal_id: 'prop-test-77',
    });
    await waitFor(() => {
      expect(screen.getByText(/Accepted/u)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    });
  });
});
