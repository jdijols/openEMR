/**
 * AllergyModal — hybrid agent + manual allergy entry form.
 *
 * Two modes via one component, derived from the `proposalId` prop:
 *  - Manual: `proposalId` undefined. POST creates a fresh proposal on open;
 *    physician edits, debounced PATCHes propagate. Save confirms.
 *  - Agent-driven: `proposalId` provided. GET loads current state; SSE
 *    streams further updates from the agent. Fields the user is focused on
 *    are protected — incoming PATCHes for those fields are deferred until
 *    blur (last-write-wins per field, with focus as the "lock").
 *
 * Both modes subscribe to SSE so the modal closes itself on
 * `status_changed: confirmed` and the AllergiesCard refetch is triggered
 * by parent invalidation of the `['fhir', ...]` query.
 *
 * Render strategy: the consumer toggles us in/out via `open`. We return null
 * when closed and freshly mount when opened, so transient state (held SSE
 * updates, debounce timers) starts clean on each open.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  confirmProposal,
  createProposal,
  getProposal,
  patchProposal,
  type AllergyAction,
  type AllergyPayload,
  type AllergySeverity,
  type ProposalStatus,
} from '../proposals/proposalsApi'
import { subscribeToProposalStream, type StreamEvent } from '../proposals/proposalStream'
import { broadcast } from '../proposals/proposalBus'
import { readAgentforgeSession } from '../proposals/session'

type Props = {
  open: boolean
  patientUuid: string
  proposalId?: string
  /**
   * Optional seed payload for manual / click-to-edit modes. When provided
   * (and `proposalId` is absent), the modal opens pre-filled with these
   * values without contacting the agentforge API. The proposal is created
   * lazily on Save (create + confirm in one shot).
   */
  initialPayload?: AllergyPayload
  onClose: () => void
}

type FieldKey = 'substance' | 'reaction' | 'severity'

const SEVERITY_OPTIONS: { value: AllergySeverity; label: string }[] = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'fatal', label: 'Fatal' },
]

// Mirrors `list_options.list_id='reaction'` rows so the value we write
// matches the option_id the legacy form uses (and what the FHIR encoder
// joins on). 'Unassigned' is the default and what gets stored when the
// physician hasn't picked a specific reaction; 'Other' is a catch-all
// for anything not in the controlled vocabulary (free-text intent —
// stored as the literal token `other` for now, future iteration could
// open a free-text input on selection).
const REACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'hives', label: 'Hives' },
  { value: 'nausea', label: 'Nausea' },
  { value: 'shortness_of_breath', label: 'Shortness of breath' },
  { value: 'other', label: 'Other' },
]

const PATCH_DEBOUNCE_MS = 400
const HIGHLIGHT_MS = 600

/** Capitalize the first character of a non-empty string; pass through otherwise. */
function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Walk the react-query cache for a cached `/AllergyIntolerance` FHIR bundle
 * for this patient and return the substance label of the entry whose `id`
 * matches the supplied `allergyUuid`. Mirrors the AllergiesCard's `nameOf`
 * logic (narrative div first, then code text/display) so the substance the
 * modal surfaces matches what the chart card shows. Returns null when the
 * cache is empty or the uuid isn't found — the modal degrades gracefully
 * to a blank substance field rather than guessing.
 */
function lookupSubstanceFromCache(
  qc: ReturnType<typeof useQueryClient>,
  patientUuid: string,
  allergyUuid: string,
): string | null {
  const entries = qc.getQueriesData({
    predicate: (query) => {
      const key = query.queryKey
      if (!Array.isArray(key) || key.length < 4) return false
      if (key[0] !== 'fhir') return false
      if (key[2] !== '/AllergyIntolerance') return false
      const params = key[3]
      if (typeof params !== 'object' || params === null) return false
      return (params as { patient?: unknown }).patient === patientUuid
    },
  })
  for (const [, data] of entries) {
    if (data === null || typeof data !== 'object') continue
    const bundle = data as {
      entry?: ReadonlyArray<{
        resource?: {
          id?: string
          text?: { div?: string }
          code?: { text?: string; coding?: ReadonlyArray<{ display?: string }> }
        }
      }>
    }
    if (bundle.entry === undefined) continue
    for (const e of bundle.entry) {
      const r = e.resource
      if (r === undefined || r.id !== allergyUuid) continue
      // narrative div like `<div xmlns="...">Eggs</div>` — strip tags.
      const div = r.text?.div
      if (typeof div === 'string') {
        const stripped = div.replace(/<[^>]*>/g, '').trim()
        if (stripped !== '' && stripped.toLowerCase() !== 'unknown') {
          return capitalizeFirst(stripped)
        }
      }
      const fromCode = r.code?.text ?? r.code?.coding?.[0]?.display
      if (typeof fromCode === 'string' && fromCode.trim() !== '' && fromCode.toLowerCase() !== 'unknown') {
        return capitalizeFirst(fromCode.trim())
      }
    }
  }
  return null
}

// Both fields default to 'unassigned' so the dropdowns render with a
// real selected option on open (no blank em-dash placeholder), and so
// the payload that actually goes to the server has the explicit
// "no value supplied yet" token rather than nothing at all. Aligns
// with `list_options.list_id='reaction'/'severity_ccda'` defaults.
const EMPTY_PAYLOAD: AllergyPayload = {
  action: 'add',
  reaction: 'unassigned',
  severity: 'unassigned',
}

export function AllergyModal({ open, patientUuid, proposalId, initialPayload, onClose }: Props) {
  if (!open) return null
  return (
    <AllergyModalInner
      patientUuid={patientUuid}
      proposalId={proposalId}
      initialPayload={initialPayload}
      onClose={onClose}
    />
  )
}

function AllergyModalInner({
  patientUuid,
  proposalId,
  initialPayload,
  onClose,
}: {
  patientUuid: string
  proposalId?: string
  initialPayload?: AllergyPayload
  onClose: () => void
}) {
  const session = useMemo(() => readAgentforgeSession(), [])
  const queryClient = useQueryClient()

  const [activeProposalId, setActiveProposalId] = useState<string | null>(proposalId ?? null)
  const [payload, setPayload] = useState<AllergyPayload>(() => initialPayload ?? EMPTY_PAYLOAD)
  const [status, setStatus] = useState<ProposalStatus>('pending')
  const [bootError, setBootError] = useState<string | null>(null)
  const [confirmInFlight, setConfirmInFlight] = useState<boolean>(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [highlightField, setHighlightField] = useState<FieldKey | null>(null)
  // G2-Final — when the modal opens against an update proposal (click-to-edit
  // path), capture the initial values once. Save uses this to detect which
  // field changed and route to update_reaction vs update_severity.
  const initialPayloadRef = useRef<AllergyPayload | null>(null)

  // Tracks which field the user is currently editing (focused). Incoming
  // server-pushed updates for that field are deferred until blur.
  const focusedFieldRef = useRef<FieldKey | null>(null)
  const heldUpdatesRef = useRef<Map<FieldKey, AllergyPayload[FieldKey]>>(new Map())

  // Per-field debounced PATCH. Per-field timer keys let us coalesce rapid
  // keystrokes within a single field without delaying edits to other fields.
  const patchTimers = useRef<Map<FieldKey, ReturnType<typeof setTimeout>>>(new Map())
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Stable refs so callbacks defined later can be called from the SSE handler
  // without forcing useCallback dependencies that would also re-subscribe SSE.
  const onCloseRef = useRef(onClose)
  const queryClientRef = useRef(queryClient)
  useEffect(() => {
    onCloseRef.current = onClose
    queryClientRef.current = queryClient
  })

  // Apply a server-pushed payload patch, deferring any field that's currently
  // focused. Briefly highlight the row to communicate "agent just touched this".
  const applyServerPatchRef = useRef<(patch: Partial<AllergyPayload>, isSnapshot: boolean) => void>(
    () => {},
  )
  const flashFieldRef = useRef<(key: FieldKey) => void>(() => {})

  useEffect(() => {
    flashFieldRef.current = (key: FieldKey): void => {
      setHighlightField(key)
      if (highlightTimer.current) clearTimeout(highlightTimer.current)
      highlightTimer.current = setTimeout(() => setHighlightField(null), HIGHLIGHT_MS)
    }
    applyServerPatchRef.current = (patch: Partial<AllergyPayload>, isSnapshot: boolean): void => {
      setPayload((prev) => {
        const next: AllergyPayload = { ...prev, ...patch }
        const keys: FieldKey[] = ['substance', 'reaction', 'severity']
        for (const key of keys) {
          if (!(key in patch)) continue
          if (focusedFieldRef.current === key) {
            // Defer — apply on blur.
            heldUpdatesRef.current.set(key, patch[key])
            ;(next as Record<string, unknown>)[key] = (prev as Record<string, unknown>)[key]
          } else if (!isSnapshot) {
            // Highlight when the agent updates a non-focused field.
            flashFieldRef.current(key)
          }
        }
        return next
      })
    }
  })

  // ------------- Boot: load when bound to an existing proposal --------------
  // Manual / click-to-edit modes (no `proposalId`) skip the API entirely on
  // open — the form starts with `initialPayload` (or empty) as pure local
  // state. The proposal is created on Save. Only agent-driven mode
  // (`proposalId` provided via BroadcastChannel from the CUI) hits the API
  // here, since the agent already created the row.
  useEffect(() => {
    if (!session || !proposalId) {
      // Capture initial values for edit-mode change detection (click-to-edit
      // seeds an `update_*` action in initialPayload).
      if (initialPayload !== undefined && initialPayload.action !== 'add') {
        initialPayloadRef.current = { ...initialPayload }
      }
      return
    }
    let cancelled = false
    const boot = async (): Promise<void> => {
      try {
        const proposal = await getProposal(session, proposalId)
        if (cancelled) return
        setActiveProposalId(proposal.proposal_id)
        setPayload(proposal.payload)
        setStatus(proposal.status)
        setBootError(null)
        if (initialPayloadRef.current === null && proposal.payload.action !== 'add') {
          initialPayloadRef.current = { ...proposal.payload }
        }
      } catch (e) {
        if (cancelled) return
        setBootError(e instanceof Error ? e.message : 'Failed to open proposal')
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [proposalId, patientUuid, session, initialPayload])

  // ------------- SSE subscription --------------
  useEffect(() => {
    if (!session || !activeProposalId) return
    const unsubscribe = subscribeToProposalStream(session, activeProposalId, {
      onEvent: (event: StreamEvent) => {
        if (event.type === 'snapshot') {
          applyServerPatchRef.current(event.payload, true)
          setStatus(event.status)
          return
        }
        if (event.type === 'payload_updated') {
          applyServerPatchRef.current(event.payload, false)
          return
        }
        if (event.type === 'status_changed') {
          setStatus(event.status)
          // Close on any terminal status. `confirmed` also invalidates the
          // FHIR cache so the dashboard cards refetch the new row;
          // `rejected` just dismisses the modal (no chart change to
          // reflect). Without the rejected branch the modal stayed open
          // when the physician hit Reject in the above-composer
          // affordance — leaving a dangling form for a proposal that no
          // longer exists.
          if (event.status === 'confirmed' || event.status === 'rejected') {
            if (event.status === 'confirmed') {
              void queryClientRef.current.invalidateQueries({ queryKey: ['fhir'] })
            }
            // Cleanup before unmount.
            for (const timer of patchTimers.current.values()) clearTimeout(timer)
            patchTimers.current.clear()
            if (highlightTimer.current) clearTimeout(highlightTimer.current)
            onCloseRef.current()
          }
        }
      },
    })
    return () => unsubscribe()
  }, [session, activeProposalId])

  /**
   * Substance backfill from cached FHIR data.
   *
   * Update proposals from the agent typically arrive with `allergy_uuid` +
   * the field being changed (reaction or severity), but no substance —
   * the agent doesn't need it to write, but the physician needs it to
   * verify they're confirming a change to the right allergy. The
   * AllergiesCard has already loaded the patient's full AllergyIntolerance
   * bundle; we look it up in the react-query cache by `allergy_uuid` and
   * fill in the substance for display purposes only.
   *
   * Both `payload` and `initialPayloadRef` get the looked-up value so the
   * change-detection diff at save time treats the substance as unchanged
   * (it shouldn't trigger an `update_substance` write just because we
   * surfaced the existing value in the form).
   */
  useEffect(() => {
    const uuid = payload.allergy_uuid
    if (typeof uuid !== 'string' || uuid === '') return
    const current = (payload.substance ?? '').trim()
    if (current !== '') return

    const looked = lookupSubstanceFromCache(queryClient, patientUuid, uuid)
    if (looked === null) return

    setPayload((prev) => ({ ...prev, substance: looked }))
    if (initialPayloadRef.current !== null) {
      initialPayloadRef.current = { ...initialPayloadRef.current, substance: looked }
    }
  }, [payload.allergy_uuid, payload.substance, patientUuid, queryClient])

  // Cleanup any pending timers on unmount.
  useEffect(() => {
    const timers = patchTimers.current
    const hl = highlightTimer
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      if (hl.current) clearTimeout(hl.current)
    }
  }, [])

  // ------------- Field edits --------------
  const handleFieldChange = (key: FieldKey, value: string): void => {
    setPayload((prev) => ({
      ...prev,
      [key]: value === '' ? undefined : value,
    }))
    if (!session || !activeProposalId) return

    const existing = patchTimers.current.get(key)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      void patchProposal(session, activeProposalId, {
        [key]: value === '' ? undefined : value,
      } as Partial<AllergyPayload>).catch(() => {
        // Network errors here are non-fatal — the next edit will retry, and
        // the user sees their typed value regardless. Logging via console.error
        // would be the next layer of polish (telemetry hook is out of MVP scope).
      })
    }, PATCH_DEBOUNCE_MS)
    patchTimers.current.set(key, timer)
  }

  const handleFocus = (key: FieldKey): void => {
    focusedFieldRef.current = key
  }

  const handleBlur = (key: FieldKey): void => {
    focusedFieldRef.current = null
    if (heldUpdatesRef.current.has(key)) {
      const held = heldUpdatesRef.current.get(key)
      heldUpdatesRef.current.delete(key)
      setPayload((prev) => ({ ...prev, [key]: held }))
      flashFieldRef.current(key)
    }
  }

  // ------------- Save --------------
  const isUpdateMode = payload.action !== 'add'

  const canSave = useMemo(() => {
    const sub = (payload.substance ?? '').trim()
    return sub !== '' && status === 'pending' && !confirmInFlight && !!session
  }, [payload.substance, status, confirmInFlight, session])

  const handleSave = async (): Promise<void> => {
    if (!session || !canSave) return
    setConfirmInFlight(true)
    setConfirmError(null)
    try {
      // Determine the action and proposal_id to confirm against. Three cases:
      //
      //   1. Agent-driven (activeProposalId set, action === 'add' or 'update_*'):
      //      proposal exists with current payload → just confirm.
      //   2. Manual add (activeProposalId null, action === 'add'):
      //      proposal doesn't exist yet → create with current payload, then
      //      confirm. No "Failed to fetch" leak before save — open is local.
      //   3. Click-to-edit (activeProposalId null, action === 'update_*'):
      //      seeded from FHIR row → detect what changed, set the right
      //      update action, then create + confirm.
      let proposalIdToConfirm = activeProposalId

      // Capitalize the substance once at the storage boundary so the
      // value the physician sees in the dashboard / chart matches the
      // legacy form's display convention regardless of how they typed
      // it. Same normalization runs server-side in propose_allergy_write,
      // so dictation and manual entry produce identical stored values.
      const normalizedSubstance =
        typeof payload.substance === 'string' && payload.substance.trim() !== ''
          ? capitalizeFirst(payload.substance.trim())
          : payload.substance
      const payloadForWrite: AllergyPayload = { ...payload, substance: normalizedSubstance }

      if (isUpdateMode) {
        const initial = initialPayloadRef.current ?? payload
        const substanceChanged = (payloadForWrite.substance ?? '') !== (initial.substance ?? '')
        const reactionChanged = (payload.reaction ?? '') !== (initial.reaction ?? '')
        const severityChanged = (payload.severity ?? '') !== (initial.severity ?? '')
        if (!substanceChanged && !reactionChanged && !severityChanged) {
          setConfirmInFlight(false)
          handleClose()
          return
        }

        // The Zod + PHP write surface accepts only one update_* action per
        // row. When multiple fields changed in one save, submit them as
        // sequential proposals so the physician sees a single Save click
        // land all the writes (parity with the legacy form's "save
        // everything at once" UX).
        const updates: AllergyAction[] = []
        if (substanceChanged) updates.push('update_substance')
        if (reactionChanged) updates.push('update_reaction')
        if (severityChanged) updates.push('update_severity')

        let allAccepted = true
        let lastReason: string | undefined
        for (const targetAction of updates) {
          const created = await createProposal(session, {
            patient_uuid: patientUuid,
            write_target: 'allergy',
            payload: { ...payloadForWrite, action: targetAction },
          })
          const result = await confirmProposal(session, created.proposal_id, patientUuid)
          if (!result.accepted) {
            allAccepted = false
            lastReason = result.reason
            break
          }
          proposalIdToConfirm = created.proposal_id
          setActiveProposalId(created.proposal_id)
        }

        if (!allAccepted) {
          setConfirmError(lastReason ?? 'Save was rejected.')
          return
        }

        // Tell the CUI: the proposal it's tracking in its message thread
        // (the agent's original update_* proposal) has effectively been
        // resolved by this Save. Without this signal the CUI's
        // above-composer affordance keeps rendering against a proposal
        // that the dashboard has already actioned.
        if (proposalId !== undefined) {
          broadcast({
            type: 'proposal:resolved',
            proposal_id: proposalId,
            outcome: 'confirmed',
          })
        }

        // Both updates landed — explicit close (no SSE subscription on
        // these lazy-created proposals).
        void queryClientRef.current.invalidateQueries({ queryKey: ['fhir'] })
        for (const timer of patchTimers.current.values()) clearTimeout(timer)
        patchTimers.current.clear()
        if (highlightTimer.current) clearTimeout(highlightTimer.current)
        onCloseRef.current()
        return
      } else if (proposalIdToConfirm === null) {
        // Manual add: lazy-create with the locally-typed payload.
        const created = await createProposal(session, {
          patient_uuid: patientUuid,
          write_target: 'allergy',
          payload: { ...payloadForWrite, action: 'add' },
        })
        proposalIdToConfirm = created.proposal_id
        setActiveProposalId(created.proposal_id)
        // Tell the CUI so its above-composer affordance reflects this proposal.
        broadcast({
          type: 'proposal:created',
          proposal_id: created.proposal_id,
          write_target: 'allergy',
          patient_uuid: patientUuid,
          source: 'dashboard',
        })
      }

      if (proposalIdToConfirm === null) {
        setConfirmError('Could not save. Try again.')
        return
      }

      const result = await confirmProposal(session, proposalIdToConfirm, patientUuid)
      if (!result.accepted) {
        setConfirmError(result.reason ?? 'Save was rejected.')
        return
      }

      // Agent-driven add: tell the CUI the proposal in its thread is now
      // resolved so the above-composer affordance can hide. (Manual add
      // has `proposalId === undefined`; the CUI never saw that proposal,
      // so no signal needed.)
      if (proposalId !== undefined) {
        broadcast({
          type: 'proposal:resolved',
          proposal_id: proposalId,
          outcome: 'confirmed',
        })
      }

      // Lazy-created proposals never receive a `status_changed: confirmed`
      // SSE event because we didn't subscribe (no activeProposalId at boot).
      // Close explicitly on success in that path.
      if (activeProposalId === null) {
        void queryClientRef.current.invalidateQueries({ queryKey: ['fhir'] })
        for (const timer of patchTimers.current.values()) clearTimeout(timer)
        patchTimers.current.clear()
        if (highlightTimer.current) clearTimeout(highlightTimer.current)
        onCloseRef.current()
      }
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setConfirmInFlight(false)
    }
  }

  // ------------- Close --------------
  const handleClose = (): void => {
    if (activeProposalId) {
      broadcast({ type: 'proposal:modal_closed', proposal_id: activeProposalId })
    }
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="allergy-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-af-gray-900/50 p-4"
      onClick={(e) => {
        // Click on backdrop only, not on the panel itself.
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-af-surface shadow-af-card-hover">
        <header className="flex items-center justify-between gap-3 border-b border-af-gray-100 px-5 py-3.5">
          <h2
            id="allergy-modal-title"
            className="text-[14px] font-semibold tracking-tight text-af-text"
          >
            {isUpdateMode ? 'Edit Allergy' : 'Add Allergy'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            className="rounded-af-control p-1 text-af-gray-400 hover:bg-af-gray-100 hover:text-af-text-subtle"
          >
            <X size={16} />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          {!session && (
            <div className="rounded-af-control bg-af-danger-50 px-3 py-2 text-sm text-af-danger-700">
              AgentForge session not available. Reload the chart to continue.
            </div>
          )}
          {bootError && (
            <div className="rounded-af-control bg-af-danger-50 px-3 py-2 text-sm text-af-danger-700">
              Could not open proposal.
            </div>
          )}

          <FieldRow label="Substance" required highlighted={highlightField === 'substance'}>
            <input
              type="text"
              data-testid="allergy-substance"
              className="w-full rounded-af-control border border-af-border px-2.5 py-1.5 text-sm text-af-text focus:border-af-primary focus:outline-none focus:ring-1 focus:ring-af-primary"
              value={payload.substance ?? ''}
              onChange={(e) => handleFieldChange('substance', e.target.value)}
              onFocus={() => handleFocus('substance')}
              onBlur={() => handleBlur('substance')}
              autoFocus
            />
          </FieldRow>

          <FieldRow label="Reaction" highlighted={highlightField === 'reaction'}>
            <select
              data-testid="allergy-reaction"
              className="w-full rounded-af-control border border-af-border px-2.5 py-1.5 text-sm text-af-text focus:border-af-primary focus:outline-none focus:ring-1 focus:ring-af-primary"
              value={payload.reaction ?? 'unassigned'}
              onChange={(e) => handleFieldChange('reaction', e.target.value)}
              onFocus={() => handleFocus('reaction')}
              onBlur={() => handleBlur('reaction')}
            >
              {REACTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FieldRow>

          <FieldRow label="Severity" highlighted={highlightField === 'severity'}>
            <select
              data-testid="allergy-severity"
              className="w-full rounded-af-control border border-af-border px-2.5 py-1.5 text-sm text-af-text focus:border-af-primary focus:outline-none focus:ring-1 focus:ring-af-primary"
              value={payload.severity ?? 'unassigned'}
              onChange={(e) => handleFieldChange('severity', e.target.value)}
              onFocus={() => handleFocus('severity')}
              onBlur={() => handleBlur('severity')}
            >
              {SEVERITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FieldRow>

          {confirmError && (
            <div className="rounded-af-control bg-af-danger-50 px-3 py-2 text-sm text-af-danger-700">
              {confirmError}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-af-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-af-control px-3 py-1.5 text-sm text-af-text-subtle hover:bg-af-gray-100"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="allergy-save"
            disabled={!canSave}
            onClick={() => void handleSave()}
            className="rounded-af-control bg-af-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-af-primary-600 disabled:cursor-not-allowed disabled:bg-af-gray-300"
          >
            {confirmInFlight ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function FieldRow({
  label,
  required,
  highlighted,
  children,
}: {
  label: string
  required?: boolean
  highlighted?: boolean
  children: ReactNode
}) {
  return (
    <label
      className={`block rounded-af-control transition-colors duration-300 ${
        highlighted ? 'bg-sky-50' : 'bg-transparent'
      }`}
    >
      <span className="mb-1 block text-xs font-medium text-af-text-subtle">
        {label}
        {required && <span className="ml-0.5 text-af-danger">*</span>}
      </span>
      {children}
    </label>
  )
}
