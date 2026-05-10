import type { ChatMessage } from '../types/chat.js';

/**
 * One unresolved proposal block, lifted out of `messages` for queue rendering.
 * Stable shape for the affordance, voice-confirm, and the head-only broadcast effect.
 */
export type QueuedProposal = Readonly<{
  proposalId: string;
  writeTarget: string;
  preview: string;
}>;

/** Result of walking the chat thread for unresolved proposals. */
export type ProposalQueue = Readonly<{
  /** Oldest unresolved proposal (FIFO head), or `null` when queue is empty. */
  head: QueuedProposal | null;
  /** Total unresolved proposals across all assistant messages. */
  count: number;
  /** Every unresolved proposal in FIFO order — `[0]` is the head. */
  all: ReadonlyArray<QueuedProposal>;
}>;

/**
 * Walk `messages` forward (oldest first) and collect every unresolved proposal block.
 *
 * Replaces the prior `findLatestOpenProposalId` LIFO scan, which had two
 * problems: (a) "latest" picked the freshest proposal even when older ones
 * were still pending, so the affordance and voice confirm targeted whichever
 * proposal arrived most recently rather than working through the queue in
 * order; (b) it returned the latest proposal_id whether or not `b.resolved`
 * was set, meaning a voice "confirm" could re-target an already-resolved
 * proposal (latent bug).
 *
 * FIFO matches the physician's mental model — they dictate in order, they
 * resolve in order — and the resolved filter ensures we never act on a
 * proposal that already landed.
 */
export function findProposalQueue(messages: readonly ChatMessage[]): ProposalQueue {
  const all: QueuedProposal[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') {
      continue;
    }
    for (const b of m.blocks) {
      if (b.type === 'proposal' && b.resolved === undefined) {
        all.push({
          proposalId: b.proposal_id,
          writeTarget: b.write_target,
          preview: b.preview,
        });
      }
    }
  }
  return {
    head: all[0] ?? null,
    count: all.length,
    all,
  };
}
