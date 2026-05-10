/**
 * Phase 1 — `findProposalQueue` is the FIFO + resolved-aware replacement for
 * the prior `findLatestOpenProposalId` LIFO scan. These tests pin down the
 * three behaviors that fix the latent bugs in the old helper:
 *
 *   1. FIFO order — the head is the OLDEST unresolved proposal across the
 *      whole thread (not the freshest), so the affordance and voice confirm
 *      target whichever proposal arrived first.
 *   2. Resolved-aware — proposals stamped with `resolved: { phase: ... }` are
 *      skipped so voice "confirm" can't re-target an already-landed proposal.
 *   3. Count is total unresolved across all assistant messages, used for the
 *      "1 of N" indicator on the affordance header.
 */

import { describe, expect, it } from 'vitest';
import { findProposalQueue } from './proposal_lookup.js';
import type { ChatMessage } from '../types/chat.js';

function userMsg(text: string): ChatMessage {
  return { role: 'user', blocks: [{ type: 'text', text }] };
}

function proposalMsg(
  ...proposals: ReadonlyArray<{
    id: string;
    target?: string;
    preview?: string;
    resolved?: 'accepted' | 'declined';
  }>
): ChatMessage {
  return {
    role: 'assistant',
    blocks: proposals.map((p) =>
      p.resolved !== undefined ?
        {
          type: 'proposal' as const,
          proposal_id: p.id,
          write_target: p.target ?? 'allergy',
          preview: p.preview ?? `preview-${p.id}`,
          resolved: { phase: p.resolved },
        }
      : {
          type: 'proposal' as const,
          proposal_id: p.id,
          write_target: p.target ?? 'allergy',
          preview: p.preview ?? `preview-${p.id}`,
        },
    ),
  };
}

describe('findProposalQueue', () => {
  it('returns an empty queue for an empty messages array', () => {
    const q = findProposalQueue([]);
    expect(q.head).toBeNull();
    expect(q.count).toBe(0);
    expect(q.all).toHaveLength(0);
  });

  it('returns null head when no proposal blocks exist', () => {
    const messages: ChatMessage[] = [
      userMsg('hello'),
      { role: 'assistant', blocks: [{ type: 'text', text: 'hi' }] },
    ];
    expect(findProposalQueue(messages).head).toBeNull();
  });

  it('returns the only unresolved proposal as head with count 1', () => {
    const messages: ChatMessage[] = [proposalMsg({ id: 'prop-A' })];
    const q = findProposalQueue(messages);
    expect(q.head?.proposalId).toBe('prop-A');
    expect(q.count).toBe(1);
    expect(q.all).toHaveLength(1);
  });

  it('FIFO: head is the OLDEST unresolved proposal, not the freshest (regression vs findLatestOpenProposalId)', () => {
    // Two unresolved allergy proposals dictated in sequence. The previous
    // helper walked backwards and returned `prop-B`; the affordance/voice
    // confirm therefore acted on the most recent proposal even though
    // `prop-A` was still pending. FIFO fixes this.
    const messages: ChatMessage[] = [
      proposalMsg({ id: 'prop-A' }),
      { role: 'assistant', blocks: [{ type: 'text', text: 'okay' }] },
      proposalMsg({ id: 'prop-B' }),
    ];
    const q = findProposalQueue(messages);
    expect(q.head?.proposalId).toBe('prop-A');
    expect(q.count).toBe(2);
    expect(q.all.map((p) => p.proposalId)).toEqual(['prop-A', 'prop-B']);
  });

  it('skips resolved proposals; head is the next unresolved one', () => {
    // `prop-A` was confirmed; queue should advance to `prop-B`. The prior
    // `findLatestOpenProposalId` did NOT filter `b.resolved` (latent bug),
    // so a voice "confirm" while `prop-B` was the head could re-target
    // an already-landed `prop-A`.
    const messages: ChatMessage[] = [
      proposalMsg({ id: 'prop-A', resolved: 'accepted' }),
      proposalMsg({ id: 'prop-B' }),
    ];
    const q = findProposalQueue(messages);
    expect(q.head?.proposalId).toBe('prop-B');
    expect(q.count).toBe(1);
  });

  it('returns null head when every proposal is resolved', () => {
    const messages: ChatMessage[] = [
      proposalMsg({ id: 'prop-A', resolved: 'accepted' }),
      proposalMsg({ id: 'prop-B', resolved: 'declined' }),
    ];
    const q = findProposalQueue(messages);
    expect(q.head).toBeNull();
    expect(q.count).toBe(0);
  });

  it('ignores user messages even if they mention proposals', () => {
    const messages: ChatMessage[] = [
      userMsg('I want to confirm the prop-X allergy'),
      proposalMsg({ id: 'prop-A' }),
    ];
    expect(findProposalQueue(messages).head?.proposalId).toBe('prop-A');
  });

  it('ignores non-proposal blocks (text, agent_step, tool_result) within an assistant message', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          { type: 'text', text: 'Here is the allergy.' },
          { type: 'tool_call', name: 'propose_allergy_write' },
          {
            type: 'proposal',
            proposal_id: 'prop-A',
            write_target: 'allergy',
            preview: 'Penicillin · Hives · Severe',
          },
          { type: 'text', text: 'Confirm?' },
        ],
      },
    ];
    const q = findProposalQueue(messages);
    expect(q.head?.proposalId).toBe('prop-A');
    expect(q.count).toBe(1);
  });

  it('preserves write_target and preview on the head', () => {
    const messages: ChatMessage[] = [
      proposalMsg({
        id: 'prop-A',
        target: 'vitals',
        preview: 'BP 120/80 · HR 72',
      }),
    ];
    const q = findProposalQueue(messages);
    expect(q.head?.writeTarget).toBe('vitals');
    expect(q.head?.preview).toBe('BP 120/80 · HR 72');
  });

  it('returns multi-message FIFO order across the entire thread', () => {
    const messages: ChatMessage[] = [
      proposalMsg({ id: 'prop-1' }),
      userMsg('continue'),
      proposalMsg({ id: 'prop-2' }, { id: 'prop-3' }),
      userMsg('and more'),
      proposalMsg({ id: 'prop-4', resolved: 'accepted' }, { id: 'prop-5' }),
    ];
    const q = findProposalQueue(messages);
    expect(q.all.map((p) => p.proposalId)).toEqual([
      'prop-1',
      'prop-2',
      'prop-3',
      'prop-5',
    ]);
    expect(q.head?.proposalId).toBe('prop-1');
    expect(q.count).toBe(4);
  });
});
