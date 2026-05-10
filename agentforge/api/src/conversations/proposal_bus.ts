/**
 * In-memory pub-sub for proposal lifecycle events.
 *
 * Subscribers register against a single `proposalId` (the React modal in the
 * dashboard, the CUI rail, etc.) and receive `snapshot` / `payload_updated` /
 * `status_changed` events whenever any other surface mutates the same row.
 *
 * Single-process MVP — when we scale to multiple API replicas the bus moves to
 * Redis pub-sub or Postgres NOTIFY. Until then, all writers go through the
 * same Hono app process so a `Map<proposalId, Set<Subscriber>>` is sufficient.
 *
 * @see PRD §5.4 — proposal lifecycle.
 */
export type ProposalEvent = 'snapshot' | 'payload_updated' | 'status_changed';

export type ProposalSubscriber = Readonly<{
  /** Push an SSE-shaped event to the subscriber. Must not throw — the bus is best-effort. */
  write: (event: ProposalEvent, data: unknown) => void;
  /** Optional close hook fired when the bus drops the subscriber (e.g. terminal status). */
  close?: () => void;
}>;

const subscribers = new Map<string, Set<ProposalSubscriber>>();

/**
 * Register a subscriber for `proposalId` and return an idempotent unsubscribe
 * function. The unsubscribe never throws; calling it twice is a no-op.
 */
export function subscribe(proposalId: string, sub: ProposalSubscriber): () => void {
  let bucket = subscribers.get(proposalId);
  if (bucket === undefined) {
    bucket = new Set();
    subscribers.set(proposalId, bucket);
  }
  bucket.add(sub);

  let removed = false;
  return () => {
    if (removed) {
      return;
    }
    removed = true;
    const current = subscribers.get(proposalId);
    if (current === undefined) {
      return;
    }
    current.delete(sub);
    if (current.size === 0) {
      subscribers.delete(proposalId);
    }
  };
}

/**
 * Fan-out an event to every active subscriber for `proposalId`. Subscribers
 * that throw on `write` are dropped — a misbehaving stream must not stall the
 * other listeners or block the HTTP handler that triggered the broadcast.
 */
export function broadcast(proposalId: string, event: ProposalEvent, data: unknown): void {
  const bucket = subscribers.get(proposalId);
  if (bucket === undefined || bucket.size === 0) {
    return;
  }
  // Snapshot the bucket so an unsubscribe-during-iterate is safe.
  const snapshot = Array.from(bucket);
  for (const sub of snapshot) {
    try {
      sub.write(event, data);
    } catch {
      bucket.delete(sub);
    }
  }
}

/**
 * Drop every subscriber for `proposalId` after a terminal status transition.
 * Calls `close()` on each one (best-effort) so the SSE stream can flush its
 * trailing `status_changed` and shut the response down cleanly.
 */
export function closeProposal(proposalId: string): void {
  const bucket = subscribers.get(proposalId);
  if (bucket === undefined) {
    return;
  }
  const snapshot = Array.from(bucket);
  subscribers.delete(proposalId);
  for (const sub of snapshot) {
    if (sub.close === undefined) {
      continue;
    }
    try {
      sub.close();
    } catch {
      // ignore — bus is best-effort.
    }
  }
}

/** Test-only — reset all in-memory subscribers. */
export function _resetForTests(): void {
  subscribers.clear();
}

/** Test-only — count active subscribers for `proposalId`. */
export function _subscriberCountForTests(proposalId: string): number {
  return subscribers.get(proposalId)?.size ?? 0;
}
