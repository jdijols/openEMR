import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// ---- Mock the proposals API client ----
// We mock at the module level so the modal calls our stubbed implementations
// instead of the real fetch calls. This isolates the test from network
// behavior while still exercising the full hook + state-machine flow.
const createProposalMock = vi.fn()
const getProposalMock = vi.fn()
const patchProposalMock = vi.fn()
const confirmProposalMock = vi.fn()
const rejectProposalMock = vi.fn()

vi.mock('../proposals/proposalsApi', () => ({
  createProposal: (...args: unknown[]) => createProposalMock(...args),
  getProposal: (...args: unknown[]) => getProposalMock(...args),
  patchProposal: (...args: unknown[]) => patchProposalMock(...args),
  confirmProposal: (...args: unknown[]) => confirmProposalMock(...args),
  rejectProposal: (...args: unknown[]) => rejectProposalMock(...args),
}))

// ---- Mock the SSE stream ----
// We capture the handlers passed to subscribe so the test can fire synthetic
// events at will. Each subscribe call replaces the stored handler.
let streamHandlers: { onEvent: (event: unknown) => void } | null = null
const unsubscribeMock = vi.fn()
vi.mock('../proposals/proposalStream', () => ({
  subscribeToProposalStream: (
    _session: unknown,
    _id: string,
    handlers: { onEvent: (event: unknown) => void },
  ) => {
    streamHandlers = handlers
    return unsubscribeMock
  },
}))

// ---- Mock the BroadcastChannel bus ----
// The modal calls broadcast() on create + close; we just track the calls so
// the test can assert when needed without polluting the global namespace.
const broadcastMock = vi.fn()
vi.mock('../proposals/proposalBus', () => ({
  broadcast: (...args: unknown[]) => broadcastMock(...args),
  subscribe: () => () => {},
}))

// ---- Mock the session reader ----
// In a real deploy the dashboard.php loader injects window.__AGENTFORGE_DASHBOARD__
// with apiBase + afSessionToken. In tests we return a static stub.
vi.mock('../proposals/session', () => ({
  readAgentforgeSession: () => ({ apiBase: 'http://api.local', sessionToken: 'sess-1' }),
}))

import { AllergyModal } from './AllergyModal'

function withQueryClient(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  createProposalMock.mockReset()
  getProposalMock.mockReset()
  patchProposalMock.mockReset()
  confirmProposalMock.mockReset()
  rejectProposalMock.mockReset()
  broadcastMock.mockReset()
  unsubscribeMock.mockReset()
  streamHandlers = null
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('<AllergyModal>', () => {
  it('manual mode: renders empty substance + Unassigned defaults and does NOT POST on open (creation deferred to Save)', async () => {
    render(withQueryClient(<AllergyModal open patientUuid="pt-1" onClose={() => {}} />))

    // Substance starts empty (required field, no sensible default).
    expect(screen.getByTestId('allergy-substance')).toHaveValue('')
    // Reaction and severity default to the `unassigned` option_id so the
    // dropdowns render with a real selected option (no em-dash placeholder).
    expect(screen.getByTestId('allergy-reaction')).toHaveValue('unassigned')
    expect(screen.getByTestId('allergy-severity')).toHaveValue('unassigned')
    // No proposal POST should fire just because the modal opened — manual
    // mode is purely local until Save. This is what prevents "Could not
    // open proposal" from leaking before the user has typed anything.
    expect(createProposalMock).not.toHaveBeenCalled()
  })

  it('agent mode: GETs the existing proposal and pre-fills fields', async () => {
    getProposalMock.mockResolvedValue({
      proposal_id: 'prop-x',
      patient_uuid: 'pt-2',
      write_target: 'allergy',
      payload: {
        action: 'add',
        substance: 'Peanuts',
        // Reaction is now a controlled select — value must be a
        // list_options.option_id ('hives' / 'nausea' / 'shortness_of_breath').
        reaction: 'hives',
        severity: 'severe',
      },
      status: 'pending',
    })
    render(
      withQueryClient(
        <AllergyModal open patientUuid="pt-2" proposalId="prop-x" onClose={() => {}} />,
      ),
    )

    await waitFor(() => expect(getProposalMock).toHaveBeenCalledTimes(1))
    expect(createProposalMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('allergy-substance')).toHaveValue('Peanuts')
    expect(screen.getByTestId('allergy-reaction')).toHaveValue('hives')
    expect(screen.getByTestId('allergy-severity')).toHaveValue('severe')
  })

  it('agent mode: field edit triggers a debounced PATCH after 400ms', async () => {
    // Field edits only PATCH when there's an active proposal — that means
    // agent-driven mode (proposal already exists). Manual mode stays
    // purely local until Save.
    getProposalMock.mockResolvedValue({
      proposal_id: 'prop-debounce',
      patient_uuid: 'pt-1',
      write_target: 'allergy',
      payload: { action: 'add' },
      status: 'pending',
    })
    patchProposalMock.mockResolvedValue({
      proposal_id: 'prop-debounce',
      patient_uuid: 'pt-1',
      write_target: 'allergy',
      payload: { action: 'add', substance: 'Latex' },
      status: 'pending',
    })

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(
      withQueryClient(
        <AllergyModal open patientUuid="pt-1" proposalId="prop-debounce" onClose={() => {}} />,
      ),
    )
    await waitFor(() => expect(getProposalMock).toHaveBeenCalled())

    const substance = screen.getByTestId('allergy-substance')
    await user.type(substance, 'Latex')

    // Fires only after the debounce window elapses.
    expect(patchProposalMock).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(patchProposalMock).toHaveBeenCalledTimes(1)
    expect(patchProposalMock).toHaveBeenCalledWith(
      { apiBase: 'http://api.local', sessionToken: 'sess-1' },
      'prop-debounce',
      { substance: 'Latex' },
    )
  })

  it('focus protection: defers SSE update for the focused field', async () => {
    getProposalMock.mockResolvedValue({
      proposal_id: 'prop-focus',
      patient_uuid: 'pt-1',
      write_target: 'allergy',
      payload: { action: 'add', substance: 'Penicillin' },
      status: 'pending',
    })
    render(
      withQueryClient(
        <AllergyModal open patientUuid="pt-1" proposalId="prop-focus" onClose={() => {}} />,
      ),
    )
    await waitFor(() => expect(streamHandlers).not.toBeNull())

    const substance = screen.getByTestId('allergy-substance') as HTMLInputElement
    // Reaction is a `<select>` now — typed as HTMLSelectElement, but the
    // focus / blur / value semantics we exercise here are identical for
    // both element types.
    const reaction = screen.getByTestId('allergy-reaction') as HTMLSelectElement

    // Focus substance — incoming server PATCHes for substance must be held.
    act(() => {
      substance.focus()
    })

    // Server pushes an update to BOTH substance and reaction.
    act(() => {
      streamHandlers?.onEvent({
        type: 'payload_updated',
        payload: { substance: 'Penicillin (corrected)', reaction: 'hives' },
      })
    })

    // Reaction (not focused) updates immediately. Substance (focused) does not.
    expect(substance).toHaveValue('Penicillin')
    expect(reaction).toHaveValue('hives')

    // Blur substance — held update applies.
    act(() => {
      substance.blur()
    })
    expect(substance).toHaveValue('Penicillin (corrected)')
  })

  it('Save button is disabled when substance is empty', () => {
    // Manual mode opens with empty fields and no proposal — Save must be
    // disabled until substance is filled in.
    render(withQueryClient(<AllergyModal open patientUuid="pt-1" onClose={() => {}} />))

    expect(screen.getByTestId('allergy-save')).toBeDisabled()
  })

  it('SSE status_changed: confirmed triggers modal close', async () => {
    getProposalMock.mockResolvedValue({
      proposal_id: 'prop-close',
      patient_uuid: 'pt-1',
      write_target: 'allergy',
      payload: { action: 'add', substance: 'Aspirin' },
      status: 'pending',
    })
    const onClose = vi.fn()
    render(
      withQueryClient(
        <AllergyModal open patientUuid="pt-1" proposalId="prop-close" onClose={onClose} />,
      ),
    )
    await waitFor(() => expect(streamHandlers).not.toBeNull())

    act(() => {
      streamHandlers?.onEvent({ type: 'status_changed', status: 'confirmed' })
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Phase 3 — modal contract refactor.
  describe('Phase 3 modal contract', () => {
    it('manual mode: Reject button is hidden (no proposal exists yet)', () => {
      render(withQueryClient(<AllergyModal open patientUuid="pt-1" onClose={() => {}} />))
      // Manual `+` add: no agent proposal is bound, so the explicit Reject
      // button must NOT render. Closing via X / backdrop is the dismiss path.
      expect(screen.queryByTestId('allergy-reject')).toBeNull()
    })

    it('agent mode: Reject button is visible alongside Confirm', async () => {
      getProposalMock.mockResolvedValue({
        proposal_id: 'prop-reject-vis',
        patient_uuid: 'pt-1',
        write_target: 'allergy',
        payload: { action: 'add', substance: 'Walnuts' },
        status: 'pending',
      })
      render(
        withQueryClient(
          <AllergyModal open patientUuid="pt-1" proposalId="prop-reject-vis" onClose={() => {}} />,
        ),
      )
      await waitFor(() => expect(getProposalMock).toHaveBeenCalledTimes(1))
      // Both Confirm and Reject visible in agent-driven mode (per the
      // disabled-button matrix). The footer no longer carries Cancel.
      expect(screen.getByTestId('allergy-save')).toBeInTheDocument()
      expect(screen.getByTestId('allergy-reject')).toBeInTheDocument()
    })

    it('Confirm button label is "Confirm" (renamed from "Save")', async () => {
      getProposalMock.mockResolvedValue({
        proposal_id: 'prop-confirm-label',
        patient_uuid: 'pt-1',
        write_target: 'allergy',
        payload: { action: 'add', substance: 'Eggs' },
        status: 'pending',
      })
      render(
        withQueryClient(
          <AllergyModal open patientUuid="pt-1" proposalId="prop-confirm-label" onClose={() => {}} />,
        ),
      )
      await waitFor(() => expect(getProposalMock).toHaveBeenCalledTimes(1))
      expect(screen.getByTestId('allergy-save')).toHaveTextContent('Confirm')
    })

    it('Cancel button is removed from the footer', async () => {
      getProposalMock.mockResolvedValue({
        proposal_id: 'prop-no-cancel',
        patient_uuid: 'pt-1',
        write_target: 'allergy',
        payload: { action: 'add', substance: 'Sulfa' },
        status: 'pending',
      })
      render(
        withQueryClient(
          <AllergyModal open patientUuid="pt-1" proposalId="prop-no-cancel" onClose={() => {}} />,
        ),
      )
      await waitFor(() => expect(getProposalMock).toHaveBeenCalledTimes(1))
      // Cancel collapsed into Snooze (X / backdrop). Any explicit "Cancel"
      // text in the footer is a regression — the only buttons are
      // Reject and Confirm.
      expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull()
    })

    it('Reject calls rejectProposal and broadcasts proposal:resolved with rejected outcome', async () => {
      getProposalMock.mockResolvedValue({
        proposal_id: 'prop-do-reject',
        patient_uuid: 'pt-1',
        write_target: 'allergy',
        payload: { action: 'add', substance: 'Latex' },
        status: 'pending',
      })
      rejectProposalMock.mockResolvedValue({ ok: true })
      const onClose = vi.fn()
      render(
        withQueryClient(
          <AllergyModal open patientUuid="pt-1" proposalId="prop-do-reject" onClose={onClose} />,
        ),
      )
      await waitFor(() => expect(getProposalMock).toHaveBeenCalledTimes(1))

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(screen.getByTestId('allergy-reject'))

      // Server-side reject lifecycle endpoint hit.
      await waitFor(() => expect(rejectProposalMock).toHaveBeenCalledTimes(1))
      // CUI gets the dismiss signal so the above-composer affordance hides
      // and the chat thread stamps a "✗ Rejected" receipt.
      expect(broadcastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'proposal:resolved',
          proposal_id: 'prop-do-reject',
          outcome: 'rejected',
        }),
      )
      // Modal closes itself after a successful reject.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })

    it('Reject failure surfaces an error and leaves the modal open (recoverable)', async () => {
      getProposalMock.mockResolvedValue({
        proposal_id: 'prop-reject-fail',
        patient_uuid: 'pt-1',
        write_target: 'allergy',
        payload: { action: 'add', substance: 'Iodine' },
        status: 'pending',
      })
      rejectProposalMock.mockResolvedValue({ ok: false, reason: 'http_500' })
      const onClose = vi.fn()
      render(
        withQueryClient(
          <AllergyModal open patientUuid="pt-1" proposalId="prop-reject-fail" onClose={onClose} />,
        ),
      )
      await waitFor(() => expect(getProposalMock).toHaveBeenCalledTimes(1))

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.click(screen.getByTestId('allergy-reject'))

      await waitFor(() => expect(rejectProposalMock).toHaveBeenCalledTimes(1))
      // Pending row stays pending until success — modal does NOT close, no
      // proposal:resolved broadcast. Physician retries from the same modal.
      expect(onClose).not.toHaveBeenCalled()
      expect(broadcastMock).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'proposal:resolved' }),
      )
      // Error message is rendered for the physician.
      expect(screen.getByText(/http_500/i)).toBeInTheDocument()
    })
  })
})
