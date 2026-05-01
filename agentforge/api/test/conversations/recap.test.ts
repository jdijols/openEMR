/**
 * Gate 5 G5-06 — UC-C recap classifier (confirmed / rejected / unresolved / refusal).
 */

import { describe, expect, it } from 'vitest';
import { buildRecapPayload } from '../../src/conversations/recap.js';
import type { PendingProposalRow } from '../../src/conversations/store.js';

const baseProposal = (): Omit<PendingProposalRow, 'proposalId' | 'status' | 'payload'> => ({
  conversationInternalId: 1,
  patientUuid: 'uu-1',
  encounterId: null,
  writeTarget: 'chief_complaint',
});

describe('buildRecapPayload', () => {
  it('classifies four §5.9-derived recap kinds: confirmed, rejected, unresolved, refusal', () => {
    const proposals: PendingProposalRow[] = [
      { ...baseProposal(), proposalId: 'p-conf', status: 'confirmed', payload: { reason: 'Sore throat' } },
      { ...baseProposal(), proposalId: 'p-rej', status: 'rejected', payload: { reason: 'Vitals note' } },
      { ...baseProposal(), proposalId: 'p-pend', status: 'pending', payload: { reason: 'Still open' } },
    ];
    const assistantBodies: Record<string, unknown>[] = [
      { blocks: [{ type: 'refusal', reason: 'Cannot delete allergies.' }] },
    ];

    const { items, counts } = buildRecapPayload({ proposals, assistantBodies });

    expect(counts.confirmed).toBe(1);
    expect(counts.rejected).toBe(1);
    expect(counts.unresolved).toBe(1);
    expect(counts.refusal).toBe(1);
    expect(items).toHaveLength(4);

    expect(items.find((i) => i.proposal_id === 'p-conf')?.classification).toBe('confirmed');
    expect(items.find((i) => i.proposal_id === 'p-rej')?.classification).toBe('rejected');
    expect(items.find((i) => i.proposal_id === 'p-pend')?.classification).toBe('unresolved');
    expect(items.find((i) => i.classification === 'refusal')?.summary).toContain('Cannot delete');
  });
});
