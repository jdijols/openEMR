/**
 * Cross-tab/cross-frame proposal coordination bus.
 *
 * The CUI (chat UI) and the patient dashboard live in separate iframes/bundles
 * but share an origin in the embedded module deploy. We use a BroadcastChannel
 * named `agentforge-proposals` to coordinate proposal lifecycle events:
 *
 *  - The CUI fires `proposal:open_modal` when the agent's `propose_allergy_write`
 *    tool runs — the dashboard's AllergyModal listens and opens itself in
 *    agent-driven mode against the supplied proposal_id.
 *  - The dashboard fires `proposal:created` when the physician opens the modal
 *    manually (so the CUI can mirror the in-flight proposal).
 *  - The dashboard fires `proposal:modal_closed` when the modal closes (X or
 *    successful save) so the CUI can drop any UI state tied to the proposal.
 *
 * This is intentionally deliberately tiny — no buffering, no retries. SSE on
 * `/proposals/:id/stream` is the source of truth for payload state; this bus
 * is purely a "hey, look over here" signal.
 */

const CHANNEL_NAME = 'agentforge-proposals'

export type ProposalEvent =
  | {
      type: 'proposal:open_modal'
      proposal_id: string
      write_target: string
      patient_uuid: string
    }
  | {
      type: 'proposal:created'
      proposal_id: string
      write_target: string
      patient_uuid: string
      source: 'cui' | 'dashboard'
    }
  | {
      type: 'proposal:modal_closed'
      proposal_id: string
    }
  | {
      // G2-Final — generic "chart was written, please refresh" signal
      // fired by the CUI after any successful proposal confirmation. The
      // dashboard listens and invalidates its FHIR react-query cache.
      // Without this, intake-form rows (multiple writes via the legacy
      // /conversations/:id/confirm path) land in OpenEMR but the dashboard
      // cards keep showing pre-write state until the chart is reloaded.
      type: 'chart:updated'
      patient_uuid: string
      source: 'cui' | 'dashboard'
    }
  | {
      // Dashboard → CUI: a proposal was confirmed/rejected via the
      // AllergyModal Save button. CUI marks the matching proposal block
      // as resolved so its above-composer affordance hides.
      type: 'proposal:resolved'
      proposal_id: string
      outcome: 'confirmed' | 'rejected'
    }

function getChannel(): BroadcastChannel | null {
  // BroadcastChannel is missing in some test/jsdom configurations and on very
  // old Safari. Both surfaces are non-critical (modal still works as a single-
  // tab manual form), so we degrade gracefully rather than throw.
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(CHANNEL_NAME)
  } catch {
    return null
  }
}

export function subscribe(handler: (e: ProposalEvent) => void): () => void {
  const channel = getChannel()
  if (!channel) return () => {}
  const listener = (event: MessageEvent): void => {
    const data = event.data as unknown
    if (isProposalEvent(data)) handler(data)
  }
  channel.addEventListener('message', listener)
  return () => {
    channel.removeEventListener('message', listener)
    channel.close()
  }
}

export function broadcast(event: ProposalEvent): void {
  const channel = getChannel()
  if (!channel) return
  try {
    channel.postMessage(event)
  } finally {
    channel.close()
  }
}

function isProposalEvent(value: unknown): value is ProposalEvent {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.type !== 'string') return false
  switch (obj.type) {
    case 'proposal:open_modal':
      return (
        typeof obj.proposal_id === 'string' &&
        typeof obj.write_target === 'string' &&
        typeof obj.patient_uuid === 'string'
      )
    case 'proposal:created':
      return (
        typeof obj.proposal_id === 'string' &&
        typeof obj.write_target === 'string' &&
        typeof obj.patient_uuid === 'string' &&
        (obj.source === 'cui' || obj.source === 'dashboard')
      )
    case 'proposal:modal_closed':
      return typeof obj.proposal_id === 'string'
    case 'chart:updated':
      return (
        typeof obj.patient_uuid === 'string' &&
        (obj.source === 'cui' || obj.source === 'dashboard')
      )
    case 'proposal:resolved':
      return (
        typeof obj.proposal_id === 'string' &&
        (obj.outcome === 'confirmed' || obj.outcome === 'rejected')
      )
    default:
      return false
  }
}
