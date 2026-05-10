/**
 * Thin HTTP client for the agentforge proposals API.
 *
 * Endpoints live at `<apiBase>/proposals/...` (the agentforge-api Hono app
 * mounts routes at the root of the public URL — `/handshake/redeem`, `/chat`,
 * `/proposals/...` — there's no `/agentforge/api` path prefix). The session
 * token rides on the `x-agentforge-session: <token>` header. The fetch impl
 * is injectable so tests can stub the network without monkey-patching
 * `globalThis.fetch`.
 */
import type { AgentforgeSession } from './session'

export type AllergyAction =
  | 'add'
  | 'update_substance'
  | 'update_reaction'
  | 'update_severity'

// Mirrors `list_options.list_id='severity_ccda'` option_ids so the value
// we send matches what OpenEMR's legacy form / FHIR encoder use. The modal
// only surfaces a curated subset of these; the type accepts any of them
// so the agent can drop in a finer-grained grade.
export type AllergySeverity =
  | 'unassigned'
  | 'mild'
  | 'mild_to_moderate'
  | 'moderate'
  | 'moderate_to_severe'
  | 'severe'
  | 'life_threatening_severity'
  | 'fatal'

/**
 * The portion of the proposal payload that the modal actually edits.
 * The API stores additional fields (e.g. action, allergy_uuid) under the
 * same payload object — we round-trip them transparently.
 */
export type AllergyPayload = {
  action: AllergyAction
  substance?: string
  reaction?: string
  severity?: AllergySeverity
  allergy_uuid?: string
}

export type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'failed'

export type Proposal = {
  proposal_id: string
  patient_uuid: string
  write_target: string
  payload: AllergyPayload
  status: ProposalStatus
}

export type ConfirmResult = {
  ok: boolean
  accepted: boolean
  reason?: string
}

type FetchImpl = typeof fetch

function endpoint(session: AgentforgeSession, path: string): string {
  // apiBase typically already lacks a trailing slash (set by dashboard.php
  // from AGENTFORGE_API_PUBLIC_URL), but strip defensively in case the env
  // var was set with one.
  const base = session.apiBase.replace(/\/+$/, '')
  return `${base}/proposals${path}`
}

function authHeaders(session: AgentforgeSession): HeadersInit {
  return {
    'x-agentforge-session': session.sessionToken,
    'content-type': 'application/json',
    accept: 'application/json',
  }
}

export async function createProposal(
  session: AgentforgeSession,
  body: { patient_uuid: string; write_target: string; payload: AllergyPayload },
  fetchImpl: FetchImpl = fetch,
): Promise<Proposal> {
  const resp = await fetchImpl(endpoint(session, ''), {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify(body),
  })
  if (!resp.ok) throw new Error(`createProposal failed: ${resp.status}`)
  return (await resp.json()) as Proposal
}

export async function getProposal(
  session: AgentforgeSession,
  proposalId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<Proposal> {
  const resp = await fetchImpl(endpoint(session, `/${proposalId}`), {
    method: 'GET',
    headers: {
      'x-agentforge-session': session.sessionToken,
      accept: 'application/json',
    },
  })
  if (!resp.ok) throw new Error(`getProposal failed: ${resp.status}`)
  return (await resp.json()) as Proposal
}

export async function patchProposal(
  session: AgentforgeSession,
  proposalId: string,
  payload: Partial<AllergyPayload>,
  fetchImpl: FetchImpl = fetch,
): Promise<Proposal> {
  const resp = await fetchImpl(endpoint(session, `/${proposalId}`), {
    method: 'PATCH',
    headers: authHeaders(session),
    body: JSON.stringify({ payload }),
  })
  if (!resp.ok) throw new Error(`patchProposal failed: ${resp.status}`)
  return (await resp.json()) as Proposal
}

export async function confirmProposal(
  session: AgentforgeSession,
  proposalId: string,
  patientUuid: string,
  fetchImpl: FetchImpl = fetch,
): Promise<ConfirmResult> {
  const resp = await fetchImpl(endpoint(session, `/${proposalId}/confirm`), {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({ patient_uuid: patientUuid }),
  })
  if (!resp.ok) {
    return { ok: false, accepted: false, reason: `http_${resp.status}` }
  }
  return (await resp.json()) as ConfirmResult
}

/**
 * Phase 4 — toggle a single section/item leaf inside a bundle proposal.
 *
 * Calls `POST /proposals/:id/items/{reject,restore}`, which updates the
 * indexed leaf via `jsonb_set` server-side so concurrent agent
 * `update_proposal` PATCHes don't race on the array. Returns the updated
 * payload so the BundleReviewModal can re-render against fresh state
 * without an extra GET.
 */
export async function setSectionRejected(
  session: AgentforgeSession,
  proposalId: string,
  patientUuid: string,
  sectionId: string,
  itemId: string | null,
  rejected: boolean,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: boolean; reason?: string; payload?: Record<string, unknown> }> {
  const path = rejected ? '/items/reject' : '/items/restore'
  const resp = await fetchImpl(endpoint(session, `/${proposalId}${path}`), {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({
      patient_uuid: patientUuid,
      section_id: sectionId,
      ...(itemId !== null ? { item_id: itemId } : {}),
    }),
  })
  if (!resp.ok) {
    return { ok: false, reason: `http_${resp.status}` }
  }
  const json = (await resp.json()) as { payload?: Record<string, unknown> }
  return { ok: true, payload: json.payload }
}

/**
 * Phase 3 — explicit Reject from the AllergyModal.
 *
 * Symmetric to `confirmProposal`: marks the proposal `rejected` server-side
 * (no PHP write fan-out) and emits a `status_changed: rejected` SSE event to
 * any open subscriber. The CUI's above-composer affordance dismisses on
 * `proposal:resolved` (broadcast by the modal after a successful Reject).
 *
 * Returns `{ ok: false, ... }` on transport failure so the caller can flip
 * the modal back to a recoverable error state without throwing — same
 * shape as `confirmProposal`. The pending_proposals row stays `pending`
 * until the server acknowledges the transition, so a retry is safe.
 */
export async function rejectProposal(
  session: AgentforgeSession,
  proposalId: string,
  patientUuid: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: boolean; reason?: string }> {
  const resp = await fetchImpl(endpoint(session, `/${proposalId}/reject`), {
    method: 'POST',
    headers: authHeaders(session),
    body: JSON.stringify({ patient_uuid: patientUuid }),
  })
  if (!resp.ok) {
    return { ok: false, reason: `http_${resp.status}` }
  }
  return { ok: true }
}
