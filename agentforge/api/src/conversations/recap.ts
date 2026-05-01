/**
 * Gate 5 / UC-C — recap classification (PRD §5.9). Combines proposal ledger + assistant refusal blocks.
 */

import type { PendingProposalRow } from './store.js';

export type RecapClassification = 'confirmed' | 'rejected' | 'unresolved' | 'refusal';

export type RecapItem = Readonly<{
  id: string;
  classification: RecapClassification;
  summary: string;
  write_target?: string;
  proposal_id?: string;
}>;

function blockList(body: Record<string, unknown>): unknown[] {
  const b = body['blocks'];
  return Array.isArray(b) ? b : [];
}

function isRefusalBlock(x: unknown): boolean {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) {
    return false;
  }
  const t = (x as Record<string, unknown>)['type'];
  return t === 'refusal' || t === 'REFUSAL';
}

export function refusalItemsFromAssistantBodies(bodies: readonly Record<string, unknown>[]): RecapItem[] {
  const out: RecapItem[] = [];
  let i = 0;
  for (const body of bodies) {
    const blocks = blockList(body);
    for (const blk of blocks) {
      if (!isRefusalBlock(blk)) {
        continue;
      }
      const reason =
        blk !== null && typeof blk === 'object' && typeof (blk as Record<string, unknown>)['reason'] === 'string' ?
          String((blk as Record<string, unknown>)['reason']).trim()
        : blk !== null && typeof blk === 'object' && typeof (blk as Record<string, unknown>)['text'] === 'string' ?
          String((blk as Record<string, unknown>)['text']).trim()
        : '';
      const summary = reason !== '' ? reason : 'Assistant refusal';
      i += 1;
      out.push({
        id: `refusal-${i}`,
        classification: 'refusal',
        summary,
      });
    }
  }
  return out;
}

export function proposalToRecapItem(row: PendingProposalRow): RecapItem {
  const preview =
    typeof row.payload['reason'] === 'string' ?
      row.payload['reason'].trim()
    : typeof row.payload['preview'] === 'string' ?
      row.payload['preview'].trim()
    : '';

  const summaryBase = preview !== '' ? preview : `${row.writeTarget} proposal`;

  if (row.status === 'confirmed') {
    return {
      id: row.proposalId,
      classification: 'confirmed',
      summary: summaryBase,
      write_target: row.writeTarget,
      proposal_id: row.proposalId,
    };
  }

  if (row.status === 'rejected') {
    return {
      id: row.proposalId,
      classification: 'rejected',
      summary: summaryBase,
      write_target: row.writeTarget,
      proposal_id: row.proposalId,
    };
  }

  return {
    id: row.proposalId,
    classification: 'unresolved',
    summary: summaryBase,
    write_target: row.writeTarget,
    proposal_id: row.proposalId,
  };
}

/** §5.9.1 turn roles reflected in recap taxonomy: proposal outcome + assistant `refusal` blocks. */
export function buildRecapPayload(args: {
  proposals: readonly PendingProposalRow[];
  assistantBodies: readonly Record<string, unknown>[];
}): Readonly<{ items: RecapItem[]; counts: Record<RecapClassification, number> }> {
  const proposalItems = args.proposals.map(proposalToRecapItem);
  const refusalItems = refusalItemsFromAssistantBodies(args.assistantBodies);
  const items = [...proposalItems, ...refusalItems];

  const counts: Record<RecapClassification, number> = {
    confirmed: 0,
    rejected: 0,
    unresolved: 0,
    refusal: 0,
  };
  for (const it of items) {
    counts[it.classification] += 1;
  }

  return { items, counts };
}
