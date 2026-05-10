/**
 * SSE subscription for `<apiBase>/proposals/:id/stream` (the agentforge-api
 * Hono app mounts proposals routes at the root of the public URL — there's
 * no `/agentforge/api` path prefix).
 *
 * Three event types from the server:
 *  - `snapshot`      — initial full state, fired once on connect
 *  - `payload_updated` — partial payload patch (merged client-side)
 *  - `status_changed`  — proposal moved to confirmed/rejected/failed
 *
 * EventSource doesn't natively support custom headers, so we pass the
 * session token as a query parameter (server is responsible for accepting
 * either form). The factory is injectable for tests.
 */
import type { AgentforgeSession } from './session'
import type { AllergyPayload, ProposalStatus } from './proposalsApi'

export type StreamEvent =
  | { type: 'snapshot'; payload: AllergyPayload; status: ProposalStatus }
  | { type: 'payload_updated'; payload: Partial<AllergyPayload> }
  | { type: 'status_changed'; status: ProposalStatus }

type EventSourceFactory = (url: string) => EventSource

export type ProposalStreamHandlers = {
  onEvent: (event: StreamEvent) => void
  onError?: (error: Event) => void
}

export function subscribeToProposalStream(
  session: AgentforgeSession,
  proposalId: string,
  handlers: ProposalStreamHandlers,
  factory: EventSourceFactory = (url) => new EventSource(url),
): () => void {
  const base = session.apiBase.replace(/\/+$/, '')
  const url = `${base}/proposals/${proposalId}/stream?session_token=${encodeURIComponent(session.sessionToken)}`
  const es = factory(url)

  es.addEventListener('snapshot', (e) => dispatch(e, handlers, 'snapshot'))
  es.addEventListener('payload_updated', (e) => dispatch(e, handlers, 'payload_updated'))
  es.addEventListener('status_changed', (e) => dispatch(e, handlers, 'status_changed'))
  if (handlers.onError) es.onerror = handlers.onError

  return () => es.close()
}

function dispatch(
  event: Event,
  handlers: ProposalStreamHandlers,
  kind: StreamEvent['type'],
): void {
  // EventSource's MessageEvent has `.data` (a string), but addEventListener's
  // callback is typed as the generic Event in older lib.dom — narrow safely.
  const me = event as MessageEvent<string>
  let parsed: unknown
  try {
    parsed = JSON.parse(me.data)
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null) return
  const data = parsed as Record<string, unknown>

  if (kind === 'snapshot') {
    if (
      typeof data.payload === 'object' &&
      data.payload !== null &&
      typeof data.status === 'string'
    ) {
      handlers.onEvent({
        type: 'snapshot',
        payload: data.payload as AllergyPayload,
        status: data.status as ProposalStatus,
      })
    }
  } else if (kind === 'payload_updated') {
    if (typeof data.payload === 'object' && data.payload !== null) {
      handlers.onEvent({
        type: 'payload_updated',
        payload: data.payload as Partial<AllergyPayload>,
      })
    }
  } else if (kind === 'status_changed') {
    if (typeof data.status === 'string') {
      handlers.onEvent({
        type: 'status_changed',
        status: data.status as ProposalStatus,
      })
    }
  }
}
