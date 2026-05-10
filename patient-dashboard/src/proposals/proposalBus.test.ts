/**
 * Phase 3 — `proposal:queue_state` is the event the dashboard listens to so
 * per-target cards (AllergiesCard today; medication / demographics in
 * Phase 5) can disable their manual `+` button while an agent proposal of
 * the same target is at the head of the FIFO queue.
 *
 * The event has to round-trip through the dashboard mirror's `isProposalEvent`
 * type guard (`patient-dashboard/src/proposals/proposalBus.ts`); without the
 * matching `case` arm in that switch, the event is silently dropped on
 * arrival. These tests pin the validator down so a future event-shape
 * change surfaces here before it ships.
 *
 * The full broadcast+subscribe round-trip uses a real BroadcastChannel,
 * which jsdom polyfills — the validator is the load-bearing piece, so we
 * hit it directly via the exported subscribe handler path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { broadcast, subscribe, type ProposalEvent } from './proposalBus'

describe('proposalBus.subscribe — proposal:queue_state', () => {
  let received: ProposalEvent[] = []
  let unsub: () => void = () => {}

  beforeEach(() => {
    received = []
    unsub = subscribe((e) => received.push(e))
  })

  afterEach(() => {
    unsub()
  })

  it('round-trips a queue_state event with a head id, target, and count', async () => {
    broadcast({
      type: 'proposal:queue_state',
      head_id: 'prop-head-1',
      head_target: 'allergy',
      count: 1,
    })
    // BroadcastChannel delivers asynchronously — yield a microtask so the
    // listener fires before we assert.
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      type: 'proposal:queue_state',
      head_id: 'prop-head-1',
      head_target: 'allergy',
      count: 1,
    })
  })

  it('round-trips a queue_state event with a null head (empty queue)', async () => {
    broadcast({
      type: 'proposal:queue_state',
      head_id: null,
      head_target: null,
      count: 0,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      type: 'proposal:queue_state',
      head_id: null,
      head_target: null,
      count: 0,
    })
  })

  it('drops a malformed queue_state event (missing count)', async () => {
    // Simulate a future-version sender / corruption: post directly so we
    // bypass the broadcast() type-checked call.
    const ch = new BroadcastChannel('agentforge-proposals')
    try {
      ch.postMessage({
        type: 'proposal:queue_state',
        head_id: 'x',
        head_target: 'allergy',
        // count missing
      })
      await new Promise((r) => setTimeout(r, 0))
      expect(received).toHaveLength(0)
    } finally {
      ch.close()
    }
  })

  it('does not deliver an unknown event type', async () => {
    const ch = new BroadcastChannel('agentforge-proposals')
    try {
      ch.postMessage({ type: 'proposal:future_kind', count: 0 })
      await new Promise((r) => setTimeout(r, 0))
      expect(received).toHaveLength(0)
    } finally {
      ch.close()
    }
  })
})

describe('proposalBus.subscribe — existing event shapes still validate', () => {
  // Sanity check that adding the queue_state arm didn't break the existing
  // event types' type guards.
  let received: ProposalEvent[] = []
  let unsub: () => void = () => {}

  beforeEach(() => {
    received = []
    unsub = subscribe((e) => received.push(e))
  })

  afterEach(() => {
    unsub()
  })

  it('open_modal still round-trips', async () => {
    broadcast({
      type: 'proposal:open_modal',
      proposal_id: 'p1',
      write_target: 'allergy',
      patient_uuid: 'pt-1',
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(received[0]?.type).toBe('proposal:open_modal')
  })

  it('proposal:resolved still round-trips', async () => {
    broadcast({ type: 'proposal:resolved', proposal_id: 'p2', outcome: 'rejected' })
    await new Promise((r) => setTimeout(r, 0))
    expect(received).toHaveLength(1)
    expect(received[0]?.type).toBe('proposal:resolved')
  })
})
