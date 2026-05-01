import type { ChatMessage } from '../types/chat.js';

/** Latest assistant proposal in thread order (for voice confirm — PRD §6.5). */
export function findLatestOpenProposalId(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') {
      continue;
    }
    for (const b of m.blocks) {
      if (b.type === 'proposal') {
        return b.proposal_id;
      }
    }
  }
  return null;
}
