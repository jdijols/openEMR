/**
 * In-memory pub-sub for proposal SSE — coverage of subscribe / broadcast /
 * unsubscribe semantics. Validates the contract that the SSE handler relies
 * on (multi-subscriber fan-out, idempotent unsubscribe, write-failure
 * isolation).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetForTests,
  _subscriberCountForTests,
  broadcast,
  closeProposal,
  subscribe,
  type ProposalEvent,
  type ProposalSubscriber,
} from '../../src/conversations/proposal_bus.js';

type CapturedEvent = Readonly<{ event: ProposalEvent; data: unknown }>;

function makeRecorder(): { sub: ProposalSubscriber; events: CapturedEvent[] } {
  const events: CapturedEvent[] = [];
  const sub: ProposalSubscriber = {
    write: (event, data) => {
      events.push({ event, data });
    },
  };
  return { sub, events };
}

beforeEach(() => {
  _resetForTests();
});

afterEach(() => {
  _resetForTests();
});

describe('proposal_bus', () => {
  it('broadcasts an event to a single subscriber', () => {
    const { sub, events } = makeRecorder();
    const unsubscribe = subscribe('p1', sub);

    broadcast('p1', 'payload_updated', { foo: 'bar' });

    expect(events).toEqual([{ event: 'payload_updated', data: { foo: 'bar' } }]);
    unsubscribe();
  });

  it('fans an event out to multiple subscribers of the same proposal', () => {
    const a = makeRecorder();
    const b = makeRecorder();
    subscribe('p1', a.sub);
    subscribe('p1', b.sub);

    broadcast('p1', 'status_changed', { proposal_id: 'p1', status: 'confirmed' });

    expect(a.events).toEqual([{ event: 'status_changed', data: { proposal_id: 'p1', status: 'confirmed' } }]);
    expect(b.events).toEqual([{ event: 'status_changed', data: { proposal_id: 'p1', status: 'confirmed' } }]);
  });

  it('does not deliver events to subscribers of a different proposal', () => {
    const a = makeRecorder();
    const b = makeRecorder();
    subscribe('p1', a.sub);
    subscribe('p2', b.sub);

    broadcast('p1', 'payload_updated', { only: 'a' });

    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(0);
  });

  it('stops delivering after unsubscribe', () => {
    const { sub, events } = makeRecorder();
    const unsubscribe = subscribe('p1', sub);

    broadcast('p1', 'payload_updated', { n: 1 });
    expect(events).toHaveLength(1);

    unsubscribe();

    broadcast('p1', 'payload_updated', { n: 2 });
    expect(events).toHaveLength(1);
    expect(_subscriberCountForTests('p1')).toBe(0);
  });

  it('treats double-unsubscribe as a no-op', () => {
    const { sub } = makeRecorder();
    const unsubscribe = subscribe('p1', sub);

    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
    expect(_subscriberCountForTests('p1')).toBe(0);
  });

  it('drops a subscriber that throws on write so siblings keep receiving', () => {
    const a = makeRecorder();
    const broken: ProposalSubscriber = {
      write: () => {
        throw new Error('socket dead');
      },
    };
    const c = makeRecorder();

    subscribe('p1', a.sub);
    subscribe('p1', broken);
    subscribe('p1', c.sub);

    broadcast('p1', 'payload_updated', { tick: 1 });

    expect(a.events).toHaveLength(1);
    expect(c.events).toHaveLength(1);
    // Broken subscriber was evicted — count drops to 2.
    expect(_subscriberCountForTests('p1')).toBe(2);

    // Subsequent broadcast still fans out to the survivors.
    broadcast('p1', 'payload_updated', { tick: 2 });
    expect(a.events).toHaveLength(2);
    expect(c.events).toHaveLength(2);
  });

  it('closeProposal evicts every subscriber and calls their close hook', () => {
    let closedA = 0;
    let closedB = 0;
    const a: ProposalSubscriber = { write: () => {}, close: () => { closedA += 1; } };
    const b: ProposalSubscriber = { write: () => {}, close: () => { closedB += 1; } };
    subscribe('p1', a);
    subscribe('p1', b);

    closeProposal('p1');

    expect(closedA).toBe(1);
    expect(closedB).toBe(1);
    expect(_subscriberCountForTests('p1')).toBe(0);
  });

  it('broadcast on a proposal with no subscribers is a no-op', () => {
    expect(() => broadcast('nope', 'snapshot', {})).not.toThrow();
  });
});
