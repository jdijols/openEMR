/**
 * Phase 4 — BundleReviewModal.
 *
 * Renders the head-of-queue bundle proposal (today: intake_form bundles
 * with demographics / chief concern / medications / allergies / family
 * history). Per-section and per-item rows have toggles; Confirm All
 * commits the unrejected leaves via server-side fan-out (apply_pending_
 * write.ts → synthetic per-leaf proposal_ids → PHP write endpoints),
 * Reject All marks the bundle row `rejected` without firing any leaf
 * write.
 *
 * Subscribes to SSE `payload_updated` so concurrent agent edits to a
 * non-rejected section appear live without losing the user's local
 * rejection state — the rejection is in the row's payload, fetched on
 * each SSE refresh, not in modal-local React state.
 *
 * Post-confirm, renders per-section outcome badges from the
 * `status_changed` SSE event detail (replaces IntakeProposalCard's
 * per-section "✓ N of N applied" affordance).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  confirmProposal,
  getProposal,
  rejectProposal,
  setSectionRejected,
} from '../proposals/proposalsApi'
import { subscribeToProposalStream, type StreamEvent } from '../proposals/proposalStream'
import { broadcast, subscribe as subscribeProposalEvents } from '../proposals/proposalBus'
import { readAgentforgeSession } from '../proposals/session'

type Props = {
  open: boolean
  patientUuid: string
  proposalId: string
  onClose: () => void
}

/**
 * Loose-typed bundle payload the modal walks. The server-side bundle
 * assembler (see orchestrator's `buildIntakeBundleSections`) is the
 * authoritative shape — this is the dashboard's read view.
 */
type BundleSection =
  | {
      section_id: string
      title?: string
      write_target?: string
      payload?: Record<string, unknown>
      rejected?: boolean
    }
  | {
      section_id: string
      title?: string
      items: ReadonlyArray<{
        item_id: string
        write_target?: string
        payload?: Record<string, unknown>
        rejected?: boolean
      }>
    }

type BundlePayload = {
  kind?: string
  source?: string
  preview?: string
  sections?: ReadonlyArray<BundleSection>
}

type SectionOutcome = {
  section_id: string
  item_id: string | null
  ok: boolean
  reason?: string
}

export function BundleReviewModal({ open, patientUuid, proposalId, onClose }: Props) {
  if (!open) return null
  return (
    <BundleReviewModalInner
      patientUuid={patientUuid}
      proposalId={proposalId}
      onClose={onClose}
    />
  )
}

function BundleReviewModalInner({
  patientUuid,
  proposalId,
  onClose,
}: {
  patientUuid: string
  proposalId: string
  onClose: () => void
}) {
  const session = useMemo(() => readAgentforgeSession(), [])
  const queryClient = useQueryClient()

  const [payload, setPayload] = useState<BundlePayload | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [confirmInFlight, setConfirmInFlight] = useState(false)
  const [rejectInFlight, setRejectInFlight] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<SectionOutcome[] | null>(null)

  const onCloseRef = useRef(onClose)
  const queryClientRef = useRef(queryClient)
  useEffect(() => {
    onCloseRef.current = onClose
    queryClientRef.current = queryClient
  })

  // Initial load + SSE subscription. Same boot pattern as AllergyModal so
  // concurrent agent edits flow through to the modal in real time.
  useEffect(() => {
    if (!session) {
      setBootError('AgentForge session not available. Reload the chart to continue.')
      return
    }
    let cancelled = false

    void (async () => {
      try {
        // `getProposal(session, proposalId)` — server enforces patient binding
        // via session claims, so no patient_uuid needs to ride on the GET.
        const proposal = await getProposal(session, proposalId)
        if (cancelled) return
        const p = proposal.payload as BundlePayload
        setPayload(p)
      } catch (e) {
        if (cancelled) return
        setBootError(e instanceof Error ? e.message : 'Could not open bundle proposal.')
      }
    })()

    const unsubscribe = subscribeToProposalStream(session, proposalId, {
      onEvent: (event: StreamEvent) => {
        if (event.type === 'payload_updated' && event.payload !== undefined) {
          setPayload(event.payload as BundlePayload)
          return
        }
        if (event.type === 'status_changed') {
          // Server-side fan-out finished. Surface per-section outcomes if
          // the event carries them; otherwise close immediately on success.
          const sections = (event as unknown as { sections?: SectionOutcome[] }).sections
          if (Array.isArray(sections)) {
            setOutcomes(sections)
            void queryClientRef.current.invalidateQueries({ queryKey: ['fhir'] })
            // Hold the modal open briefly so the user sees the per-section
            // outcome badges before the close, then dismiss.
            setTimeout(() => {
              onCloseRef.current()
            }, 1400)
            return
          }
          if (event.status === 'rejected') {
            onCloseRef.current()
          }
        }
      },
    })

    // Phase 4 follow-up — also listen on the BroadcastChannel for
    // `proposal:resolved`. The CUI's affordance Confirm/Reject path goes
    // through `onProposalResolved` in App.tsx, which broadcasts this
    // event after the lifecycle call returns. Without this listener, a
    // user who clicks Confirm on the rail affordance (instead of inside
    // the modal) leaves the modal open — the SSE `status_changed`
    // notification races `closeProposal()` server-side and the modal
    // misses it. The BroadcastChannel signal is local + reliable.
    const unsubscribeBus = subscribeProposalEvents((event) => {
      if (event.type !== 'proposal:resolved') return
      if (event.proposal_id !== proposalId) return
      onCloseRef.current()
    })

    return () => {
      cancelled = true
      unsubscribe()
      unsubscribeBus()
    }
  }, [session, proposalId, patientUuid])

  /** Walk payload.sections to compute live counts (excluding rejected leaves). */
  const counts = useMemo(() => {
    let total = 0
    let live = 0
    for (const s of payload?.sections ?? []) {
      if ('items' in s && Array.isArray(s.items)) {
        for (const it of s.items) {
          total += 1
          if (it.rejected !== true) live += 1
        }
      } else {
        total += 1
        const sec = s as { rejected?: boolean }
        if (sec.rejected !== true) live += 1
      }
    }
    return { total, live }
  }, [payload])

  const handleClose = (): void => {
    broadcast({ type: 'proposal:modal_closed', proposal_id: proposalId })
    onCloseRef.current()
  }

  const handleToggle = async (sectionId: string, itemId: string | null, currentlyRejected: boolean): Promise<void> => {
    if (!session) return
    const result = await setSectionRejected(
      session,
      proposalId,
      patientUuid,
      sectionId,
      itemId,
      !currentlyRejected,
    )
    if (!result.ok) {
      setActionError(result.reason ?? 'Could not update section.')
      return
    }
    // Server returns the canonical updated payload; trust it over local
    // optimistic state to avoid drift if a concurrent agent edit landed.
    if (result.payload !== undefined) {
      setPayload(result.payload as BundlePayload)
    }
  }

  const handleConfirmAll = async (): Promise<void> => {
    if (!session || counts.live === 0) return
    setConfirmInFlight(true)
    setActionError(null)
    try {
      const result = await confirmProposal(session, proposalId, patientUuid)

      // Pull per-section outcomes off the response itself rather than
      // waiting for the SSE `status_changed` event. The server broadcasts
      // that event then immediately calls `closeProposal()`, which
      // terminates the SSE stream — the in-flight broadcast can race the
      // close and never reach the dashboard. Driving the modal-close
      // path from the HTTP response is deterministic.
      const detail = (result as { detail?: { sections?: SectionOutcome[] } }).detail
      const responseSections =
        detail !== undefined && Array.isArray(detail.sections) ? detail.sections : null

      if (!result.accepted && responseSections === null) {
        setActionError(result.reason ?? 'Confirm All was rejected.')
        return
      }

      // Tell the CUI the affordance can dismiss + chat receipt should
      // stamp.
      broadcast({
        type: 'proposal:resolved',
        proposal_id: proposalId,
        outcome: 'confirmed',
      })

      // Refresh dashboard cards now (don't wait for the chart:updated
      // round-trip from the CUI listener).
      void queryClientRef.current.invalidateQueries({ queryKey: ['fhir'] })

      if (responseSections !== null) {
        // Bundle path — show per-section ✓/✗ badges briefly, then close.
        setOutcomes(responseSections)
        setTimeout(() => {
          onCloseRef.current()
        }, 1400)
      } else {
        // Single-write or accepted-without-detail — close immediately.
        onCloseRef.current()
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Confirm failed.')
    } finally {
      setConfirmInFlight(false)
    }
  }

  const handleRejectAll = async (): Promise<void> => {
    if (!session) return
    setRejectInFlight(true)
    setActionError(null)
    try {
      const result = await rejectProposal(session, proposalId, patientUuid)
      if (!result.ok) {
        setActionError(result.reason ?? 'Reject All failed.')
        return
      }
      broadcast({
        type: 'proposal:resolved',
        proposal_id: proposalId,
        outcome: 'rejected',
      })
      onCloseRef.current()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Reject All failed.')
    } finally {
      setRejectInFlight(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bundle-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-af-gray-900/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div className="w-full max-w-xl rounded-lg bg-af-surface shadow-af-card-hover">
        <header className="flex items-center justify-between gap-3 border-b border-af-gray-100 px-5 py-3.5">
          <h2
            id="bundle-modal-title"
            className="text-[14px] font-semibold tracking-tight text-af-text"
          >
            Review intake form
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

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
          {bootError !== null ? (
            <div
              data-testid="bundle-boot-error"
              className="rounded-af-control bg-af-danger-50 px-3 py-2 text-sm text-af-danger-700"
            >
              {bootError}
            </div>
          ) : null}

          {payload === null && bootError === null ? (
            <div className="text-sm text-af-text-subtle">Loading…</div>
          ) : null}

          {payload?.sections?.map((section) => (
            <BundleSectionView
              key={section.section_id}
              section={section}
              outcomes={outcomes}
              onToggle={handleToggle}
              disabled={confirmInFlight || rejectInFlight}
            />
          ))}

          {actionError !== null ? (
            <div className="rounded-af-control bg-af-danger-50 px-3 py-2 text-sm text-af-danger-700">
              {actionError}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-af-gray-100 px-5 py-3">
          <span className="text-xs text-af-text-subtle">
            {counts.live} of {counts.total} to write
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="bundle-reject-all"
              disabled={rejectInFlight || confirmInFlight || !session}
              onClick={() => void handleRejectAll()}
              className="rounded-af-control border border-af-danger bg-af-danger-50 px-3 py-1.5 text-sm font-medium text-af-danger-700 hover:bg-af-danger-50/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rejectInFlight ? 'Rejecting…' : 'Reject all'}
            </button>
            <button
              type="button"
              data-testid="bundle-confirm-all"
              disabled={confirmInFlight || rejectInFlight || counts.live === 0 || !session}
              onClick={() => void handleConfirmAll()}
              className="rounded-af-control border border-af-success bg-af-success-50 px-3 py-1.5 text-sm font-medium text-af-success-700 hover:bg-af-success-50/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmInFlight ? 'Confirming…' : `Confirm ${counts.live} of ${counts.total}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

function BundleSectionView({
  section,
  outcomes,
  onToggle,
  disabled,
}: {
  section: BundleSection
  outcomes: SectionOutcome[] | null
  onToggle: (sectionId: string, itemId: string | null, currentlyRejected: boolean) => Promise<void>
  disabled: boolean
}) {
  const title = section.title ?? section.section_id
  const isList = 'items' in section && Array.isArray(section.items)

  return (
    <section
      data-testid="bundle-section"
      data-section-id={section.section_id}
      className="rounded-af-control border border-af-gray-100 bg-af-surface-alt/50 px-3 py-2"
    >
      <header className="text-[11px] font-semibold uppercase tracking-wider text-af-text-subtle">
        {title}
      </header>
      <div className="mt-2 space-y-1.5">
        {isList ? (
          ('items' in section ? section.items : []).map((item) => {
            const outcome = outcomes?.find(
              (o) => o.section_id === section.section_id && o.item_id === item.item_id,
            )
            return (
              <BundleLeafRow
                key={item.item_id}
                label={summarizeItemPayload(item.payload, item.write_target)}
                rejected={item.rejected === true}
                outcome={outcome}
                onToggle={() => onToggle(section.section_id, item.item_id, item.rejected === true)}
                disabled={disabled || outcomes !== null}
              />
            )
          })
        ) : (
          (() => {
            const sec = section as Extract<BundleSection, { write_target?: string }>
            const outcome = outcomes?.find(
              (o) => o.section_id === section.section_id && o.item_id === null,
            )
            return (
              <BundleLeafRow
                label={summarizeItemPayload(sec.payload, sec.write_target)}
                rejected={sec.rejected === true}
                outcome={outcome}
                onToggle={() => onToggle(section.section_id, null, sec.rejected === true)}
                disabled={disabled || outcomes !== null}
              />
            )
          })()
        )}
      </div>
    </section>
  )
}

function BundleLeafRow({
  label,
  rejected,
  outcome,
  onToggle,
  disabled,
}: {
  label: string
  rejected: boolean
  outcome: SectionOutcome | undefined
  onToggle: () => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span
        className={
          rejected ? 'flex-1 truncate text-af-text-subtle line-through' : 'flex-1 truncate text-af-text'
        }
      >
        {label}
      </span>
      {outcome !== undefined ? (
        <OutcomeBadge ok={outcome.ok} reason={outcome.reason} />
      ) : (
        <button
          type="button"
          aria-label={rejected ? 'Restore' : 'Skip'}
          disabled={disabled}
          onClick={onToggle}
          className={
            rejected
              ? 'rounded-af-control border border-af-success bg-af-success-50 px-2 py-0.5 text-xs font-medium text-af-success-700 hover:bg-af-success-50/80 disabled:cursor-not-allowed disabled:opacity-50'
              : 'rounded-af-control border border-af-border bg-af-surface px-2 py-0.5 text-xs font-medium text-af-text-subtle hover:bg-af-gray-100 disabled:cursor-not-allowed disabled:opacity-50'
          }
        >
          {rejected ? 'Restore' : 'Skip'}
        </button>
      )}
    </div>
  )
}

function OutcomeBadge({ ok, reason }: { ok: boolean; reason?: string }) {
  if (ok) {
    return (
      <span className="rounded-af-control bg-af-success-50 px-2 py-0.5 text-xs font-medium text-af-success-700">
        ✓ Wrote
      </span>
    )
  }
  return (
    <span
      className="rounded-af-control bg-af-danger-50 px-2 py-0.5 text-xs font-medium text-af-danger-700"
      title={reason}
    >
      ✗ {reason ?? 'failed'}
    </span>
  )
}

/** Compact, target-aware row label. */
function summarizeItemPayload(payload: Record<string, unknown> | undefined, writeTarget: string | undefined): string {
  if (payload === undefined || payload === null) return writeTarget ?? '—'
  switch (writeTarget) {
    case 'demographics_update': {
      const fields = Object.keys(payload).filter((k) => k !== 'preview' && !k.startsWith('_'))
      return fields.length > 0 ? `Update ${fields.join(', ')}` : 'Demographics'
    }
    case 'chief_complaint': {
      const reason = typeof payload['reason'] === 'string' ? (payload['reason'] as string) : ''
      return reason !== '' ? truncate(reason, 60) : 'Chief complaint'
    }
    case 'medication_add': {
      const name = typeof payload['name'] === 'string' ? (payload['name'] as string) : ''
      const dose = typeof payload['dose'] === 'string' ? (payload['dose'] as string) : ''
      const freq = typeof payload['frequency'] === 'string' ? (payload['frequency'] as string) : ''
      const head = dose !== '' ? `${name} ${dose}` : name
      return freq !== '' ? `${head} · ${freq}` : head !== '' ? head : 'Medication'
    }
    case 'allergy': {
      const sub = typeof payload['substance'] === 'string' ? (payload['substance'] as string) : ''
      const reaction = typeof payload['reaction'] === 'string' ? (payload['reaction'] as string) : ''
      const severity = typeof payload['severity'] === 'string' ? (payload['severity'] as string) : ''
      const parts = [sub, reaction, severity].filter((x) => x !== '')
      return parts.length > 0 ? parts.join(' · ') : 'Allergy'
    }
    case 'family_history_add': {
      const rel = typeof payload['relation'] === 'string' ? (payload['relation'] as string) : ''
      const cond = typeof payload['condition'] === 'string' ? (payload['condition'] as string) : ''
      if (rel === '' && cond === '') return 'Family history'
      if (rel === '') return cond
      if (cond === '') return capitalize(rel)
      return `${capitalize(rel)}: ${cond}`
    }
    case 'problem_add': {
      const cond = typeof payload['condition'] === 'string' ? (payload['condition'] as string) : ''
      const status = typeof payload['status'] === 'string' ? (payload['status'] as string) : ''
      const onset = typeof payload['onset_date'] === 'string' ? (payload['onset_date'] as string) : ''
      const comments = typeof payload['comments'] === 'string' ? (payload['comments'] as string) : ''
      if (cond === '') return 'Medical problem'
      const parts: string[] = [cond]
      const meta: string[] = []
      if (status !== '' && status !== 'active') meta.push(status)
      if (onset !== '') meta.push(`onset ${onset}`)
      if (comments !== '') meta.push(comments)
      if (meta.length > 0) parts.push(`(${meta.join(' · ')})`)
      return parts.join(' ')
    }
    default:
      return writeTarget ?? '—'
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`
}
