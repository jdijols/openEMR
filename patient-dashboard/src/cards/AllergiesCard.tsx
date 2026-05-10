import { useEffect, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirAllergyIntoleranceSchema,
  FhirBundleSchema,
  type FhirAllergyIntolerance,
} from '../fhir/schemas'
import { AllergyModal } from './AllergyModal'
import { subscribe } from '../proposals/proposalBus'
import { type AllergyPayload, type AllergySeverity } from '../proposals/proposalsApi'

type Props = { patientId: string }

const Schema = FhirBundleSchema(FhirAllergyIntoleranceSchema)

export function AllergiesCard({ patientId }: Props) {
  const query = useFhirQuery('/AllergyIntolerance', { patient: patientId }, Schema)

  const [modalOpen, setModalOpen] = useState(false)
  // Set when the CUI broadcasts `proposal:open_modal` for an allergy proposal
  // — the agent created the row server-side first, the modal binds via GET.
  const [agentProposalId, setAgentProposalId] = useState<string | null>(null)
  // Set when the physician clicks an existing allergy row. The modal opens
  // with these values seeded locally; the proposal is created lazily on
  // Save so we don't surface "could not open proposal" before the user has
  // even started editing.
  const [editSeed, setEditSeed] = useState<AllergyPayload | null>(null)

  useEffect(() => {
    return subscribe((event) => {
      if (event.type === 'proposal:open_modal' && event.write_target === 'allergy') {
        setAgentProposalId(event.proposal_id)
        setEditSeed(null)
        setModalOpen(true)
      }
    })
  }, [])

  const handleOpenManual = () => {
    setAgentProposalId(null)
    setEditSeed(null)
    setModalOpen(true)
  }

  /**
   * Click-to-edit: physician clicked an existing allergy row. Open the
   * modal seeded with the FHIR row's substance / reaction / severity. The
   * modal stays purely local until the user clicks Save — only then does
   * it POST a proposal and confirm. No API calls during open.
   */
  const handleAllergyClick = (a: FhirAllergyIntolerance): void => {
    setAgentProposalId(null)
    setEditSeed(mapFhirToAllergyPayload(a))
    setModalOpen(true)
  }

  const handleClose = () => {
    setModalOpen(false)
    setAgentProposalId(null)
    setEditSeed(null)
  }

  // Sized to mirror the card icon chip on the left of the title (h-7 w-7,
  // rounded-lg) so the title row reads as a visually balanced "icon →
  // title → action" trio. The hover bg pulls from the dashboard's own
  // page surface (`af-surface-alt` / slate-50) — not `af-gray-100`,
  // which is the CUI rail's surface and reads too dark inside a white
  // card. Border darkens on hover for the visible affordance change.
  const addButton = (
    <button
      type="button"
      aria-label="Add allergy"
      title="Add allergy"
      onClick={handleOpenManual}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-af-border-strong bg-af-surface text-af-text-subtle hover:bg-af-surface-alt hover:border-af-gray-500 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-af-primary/30 transition-colors duration-150"
    >
      <Plus size={14} aria-hidden />
    </button>
  )

  let card
  if (query.isLoading) {
    card = (
      <ClinicalCard
        title="Allergies"
        status="loading"
        icon={<AlertTriangle size={16} />}
        accent="rose"
        action={addButton}
      />
    )
  } else if (query.error) {
    card = (
      <ClinicalCard
        title="Allergies"
        status="error"
        icon={<AlertTriangle size={16} />}
        accent="rose"
        errorMessage="Could not load allergies."
        errorCorrelationId={query.error.detail.correlationId}
        action={addButton}
      />
    )
  } else {
    const all = bundleEntries(query.data).filter(isActive).filter(hasRealName)
    const sorted = sortBySeverity(all)
    if (sorted.length === 0) {
      card = (
        <ClinicalCard
          title="Allergies"
          status="empty"
          icon={<AlertTriangle size={16} />}
          accent="rose"
          emptyMessage="No active allergies on file."
          action={addButton}
        />
      )
    } else {
      card = (
        <ClinicalCard
          title="Allergies"
          status="content"
          icon={<AlertTriangle size={16} />}
          accent="rose"
          action={addButton}
        >
          <AllergiesList allergies={sorted} onAllergyClick={handleAllergyClick} />
        </ClinicalCard>
      )
    }
  }

  return (
    <>
      {card}
      <AllergyModal
        open={modalOpen}
        patientUuid={patientId}
        proposalId={agentProposalId ?? undefined}
        initialPayload={editSeed ?? undefined}
        onClose={handleClose}
      />
    </>
  )
}

/**
 * FHIR rows with no readable substance name are stale or malformed. They
 * surface as "Unknown allergen" via the nameOf fallback, which is noise
 * for the clinician — hide them rather than display.
 *
 * We accept any of the three name sources nameOf consults (narrative,
 * code.text, code.coding[0].display) so allergies added without a SNOMED
 * code (the agent / modal path — title-only, no `diagnosis`) still render
 * with the substance pulled from the narrative.
 */
function hasRealName(a: FhirAllergyIntolerance): boolean {
  const narrative = extractNarrativeText(a.text?.div)
  if (narrative !== null) return true
  const text = a.code?.text?.trim()
  const display = a.code?.coding?.[0]?.display?.trim()
  if (typeof text === 'string' && text !== '' && text.toLowerCase() !== 'unknown') {
    return true
  }
  if (typeof display === 'string' && display !== '' && display.toLowerCase() !== 'unknown') {
    return true
  }
  return false
}

export function AllergiesList({
  allergies,
  onAllergyClick,
}: {
  allergies: FhirAllergyIntolerance[]
  onAllergyClick?: (a: FhirAllergyIntolerance) => void
}) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {allergies.map((a) => (
        <li
          key={a.id}
          className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
        >
          <AllergyRowText
            allergy={a}
            {...(onAllergyClick !== undefined ? { onClick: () => onAllergyClick(a) } : {})}
          />
          <SeverityPill allergy={a} />
        </li>
      ))}
    </ul>
  )
}

/**
 * Row text reads "<substance> → <reaction>" when both are present, or
 * just the substance otherwise. Same single line-height + truncation as
 * the previous single-string render so the row layout doesn't shift.
 * Reaction styling matches the substance — same color, same weight — so
 * the arrow is the only visual delimiter, mirroring how the legacy form's
 * Title and Reaction read together.
 */
function AllergyRowText({
  allergy,
  onClick,
}: {
  allergy: FhirAllergyIntolerance
  onClick?: () => void
}) {
  const substance = nameOf(allergy)
  const reaction = reactionOf(allergy)
  const inner = (
    <>
      {substance}
      {reaction !== null ? (
        <>
          <span className="mx-1 text-af-text-subtle">→</span>
          {reaction}
        </>
      ) : null}
    </>
  )

  // Same pattern as ClinicalCard's title button: hover/click both scope
  // to the text element itself. Hovering the row's whitespace or the
  // severity badge does NOT trigger the underline, because the button
  // only spans the actual text width. `min-w-0` lets the button shrink
  // inside the flex parent so `truncate` actually engages on long
  // allergens; `text-left` because the default button alignment is
  // center.
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Edit allergy: ${substance}`}
        className="min-w-0 inline-flex items-center text-left text-sm text-af-text truncate hover:underline focus-visible:underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-af-primary/40 rounded-sm"
      >
        {inner}
      </button>
    )
  }
  return <span className="text-sm text-af-text truncate">{inner}</span>
}

/**
 * Map a FHIR `AllergyIntolerance` resource to the partial allergy payload
 * the proposal modal expects. Used by click-to-edit to seed an update
 * proposal with the existing values; the modal's locked-substance UX
 * surfaces them as read-only context. The action defaults to
 * `update_reaction` — the modal's save logic flips it to `update_severity`
 * if only severity ended up changing.
 */
function mapFhirToAllergyPayload(a: FhirAllergyIntolerance): AllergyPayload {
  const substance = nameOf(a)
  const fhirReaction =
    a.reaction?.[0]?.manifestation?.[0]?.text ??
    a.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display ??
    a.reaction?.[0]?.description
  const sev = mapFhirSeverity(severityLabel(a))
  const reactionOption = mapFhirReactionToOption(fhirReaction)
  // Default missing fields to `unassigned` so the modal's dropdowns
  // always render a real selected option (no blank state) and so the
  // change-detection diff against initialPayloadRef compares apples to
  // apples (`unassigned` vs `unassigned` = unchanged).
  return {
    action: 'update_reaction',
    allergy_uuid: a.id,
    substance,
    reaction: reactionOption ?? 'unassigned',
    severity: sev ?? 'unassigned',
  }
}

/**
 * Map whatever FHIR sends back for the reaction (free text "hives",
 * "Hives", display label "Hives" from list_options, or "Unknown" from the
 * data-absent fallback) onto one of the controlled `list_id='reaction'`
 * option IDs. Returns null when no match — the modal then leaves the
 * dropdown unset rather than guessing.
 */
function mapFhirReactionToOption(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null
  const norm = raw.trim().toLowerCase()
  if (norm === '' || norm === 'unknown') return null
  if (norm === 'hives') return 'hives'
  if (norm === 'nausea') return 'nausea'
  if (norm === 'shortness of breath' || norm === 'shortness_of_breath') return 'shortness_of_breath'
  return null
}

/**
 * Normalize whatever the FHIR resource carries for severity onto one of
 * the `list_options.list_id='severity_ccda'` option_ids the modal /
 * write-path use. The PHP transform now emits `reaction[0].severity` with
 * the raw severity_al value (mild / moderate / severe / fatal / unassigned
 * / mild_to_moderate / moderate_to_severe / life_threatening_severity),
 * so the round-trip preserves the full grade. Older rows that only have
 * the FHIR criticality bucket (low / high / unable-to-assess) still fall
 * back to a coarse mapping.
 */
function mapFhirSeverity(label: string | null): AllergySeverity | null {
  if (label === null) return null
  switch (label.toLowerCase()) {
    // Granular severity_al option_ids (preferred — written by our path).
    case 'unassigned': return 'unassigned'
    case 'mild': return 'mild'
    case 'mild_to_moderate': return 'mild_to_moderate'
    case 'moderate': return 'moderate'
    case 'moderate_to_severe': return 'moderate_to_severe'
    case 'severe': return 'severe'
    case 'life_threatening_severity': return 'life_threatening_severity'
    case 'fatal': return 'fatal'
    // Coarse FHIR criticality buckets (legacy fallback).
    case 'high': return 'severe'
    case 'low': return 'mild'
    case 'unable-to-assess': return 'unassigned'
    default: return null
  }
}

/** Render-ready label for a severity option_id. */
function severityDisplayLabel(label: string): string {
  switch (label.toLowerCase()) {
    case 'unassigned': return 'Unassigned'
    case 'mild': return 'Mild'
    case 'mild_to_moderate': return 'Mild to moderate'
    case 'moderate': return 'Moderate'
    case 'moderate_to_severe': return 'Moderate to severe'
    case 'severe': return 'Severe'
    case 'life_threatening_severity': return 'Life threatening'
    case 'fatal': return 'Fatal'
    // Coarse criticality buckets — rendered as their granular equivalents
    // so the card never surfaces "low" / "high" to clinicians.
    case 'high': return 'Severe'
    case 'low': return 'Mild'
    case 'unable-to-assess': return 'Unassigned'
    default: return capitalize(label)
  }
}

/** Render-ready label for a reaction option_id. */
function reactionDisplayLabel(value: string): string {
  switch (value.toLowerCase()) {
    case 'hives': return 'Hives'
    case 'nausea': return 'Nausea'
    case 'shortness_of_breath': return 'Shortness of breath'
    case 'shortness of breath': return 'Shortness of breath'
    default: return value
  }
}

/**
 * Pull the displayable reaction label from a FHIR AllergyIntolerance.
 * Prefers the manifestation text / display, falls back to the description,
 * then maps any controlled option_id ("hives") to a properly-cased label
 * ("Hives"). Returns null when no reaction is present.
 */
function reactionOf(a: FhirAllergyIntolerance): string | null {
  const raw =
    a.reaction?.[0]?.manifestation?.[0]?.text ??
    a.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display ??
    a.reaction?.[0]?.description
  if (typeof raw !== 'string' || raw.trim() === '') return null
  if (raw.trim().toLowerCase() === 'unknown') return null
  return reactionDisplayLabel(raw.trim())
}

function SeverityPill({ allergy }: { allergy: FhirAllergyIntolerance }) {
  const label = severityLabel(allergy)
  if (!label) return null
  const cls = severityClass(label)
  return (
    <span
      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ${cls}`}
    >
      {severityDisplayLabel(label)}
    </span>
  )
}

function nameOf(a: FhirAllergyIntolerance): string {
  // The narrative `text.div` is the most reliable source for the
  // substance label: OpenEMR's FHIR encoder always populates it from
  // lists.title, even when there is no SNOMED-coded diagnosis (which
  // is the case for allergies added through our agent / modal — those
  // store a free-text title, not a code). When diagnosis IS coded,
  // `code.text` / `code.coding[0].display` carry the structured label
  // and we still prefer them. Final fallback is the literal string.
  //
  // Defensive capitalization for legacy rows that pre-date our
  // write-side normalization: new writes always store with the first
  // letter capitalized, but rows seeded before this round may still
  // be lowercase ("eggs", "fur"). Capitalize on display so the chart
  // reads consistently regardless of when the row was written.
  const narrative = extractNarrativeText(a.text?.div)
  if (narrative !== null) return capitalizeFirst(narrative)
  const fallback = a.code?.text ?? a.code?.coding?.[0]?.display ?? 'Unknown allergen'
  return capitalizeFirst(fallback)
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Extract the human-readable string from a FHIR Narrative div. Narratives
 * are XHTML wrapped in a `<div xmlns="...">…</div>` envelope; for the
 * allergy resource the body is just the substance name. Strip tags and
 * decode the handful of entities OpenEMR's serializer emits.
 */
function extractNarrativeText(div: string | undefined): string | null {
  if (typeof div !== 'string' || div.trim() === '') return null
  const stripped = div.replace(/<[^>]*>/g, '').trim()
  if (stripped === '') return null
  // Filter useless placeholders the FHIR encoder emits (e.g. "Unknown"
  // when the narrative was generated from data-absent code).
  if (stripped.toLowerCase() === 'unknown') return null
  return decodeHtmlEntities(stripped)
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function isActive(a: FhirAllergyIntolerance): boolean {
  const code = a.clinicalStatus?.coding?.[0]?.code
  return !code || code === 'active'
}

export function severityLabel(a: FhirAllergyIntolerance): string | null {
  // Prefer the granular severity_al option_id we emit on
  // `reaction[0].severity` (mild / moderate / severe / fatal / etc.).
  // Falls back to FHIR criticality (low / high / unable-to-assess) for
  // rows written through legacy paths that don't carry the granular form.
  const reactionSeverity = a.reaction?.[0]?.severity
  if (typeof reactionSeverity === 'string' && reactionSeverity.trim() !== '') {
    return reactionSeverity
  }
  if (a.criticality) return a.criticality
  return null
}

function severityClass(label: string): string {
  // Soft-pill style throughout — every pill is a light background with
  // darker text in the same color family, matching the rest of the
  // dashboard's pill / chip aesthetic (CareTeam, Appointments, Labs).
  // Mild reads gray instead of green because the allergies card is
  // already an explicitly clinical / "watch out" surface (rose icon);
  // green inside it would read as "this is fine," which it isn't —
  // every grade here is a degree of bad. Unassigned gets the heaviest
  // gray text so the grade still pops when no real severity was
  // supplied (otherwise it would read as "missing" instead of "no
  // assessment yet").
  switch (label.toLowerCase()) {
    // Deepest red — heavier ring distinguishes Fatal from plain Severe.
    case 'fatal':
    case 'life_threatening_severity':
      return 'bg-af-danger-50 text-af-danger-700 ring-af-danger-700'
    // Standard red soft pill.
    case 'high':
    case 'severe':
    case 'moderate_to_severe':
      return 'bg-af-danger-50 text-af-danger-700 ring-af-danger-50'
    // Amber soft pill.
    case 'moderate':
      return 'bg-af-warning-50 text-af-warning-700 ring-af-warning-50'
    // Soft slate-gray pill (replaces the prior emerald — Mild here is
    // still a clinical concern, just the gentlest of the bad).
    case 'mild_to_moderate':
    case 'low':
    case 'mild':
      return 'bg-af-gray-100 text-af-gray-700 ring-af-gray-100'
    // Slightly darker bg with near-black text — visually distinct from
    // Mild and reads as "no grade on file yet" rather than blending in.
    case 'unassigned':
    case 'unable-to-assess':
    default:
      return 'bg-af-gray-200 text-af-gray-900 ring-af-gray-200'
  }
}

function severityRank(label: string): number {
  switch (label.toLowerCase()) {
    case 'fatal':
    case 'life_threatening_severity':
      return 0
    case 'high':
    case 'severe':
    case 'moderate_to_severe':
      return 1
    case 'moderate':
      return 2
    case 'mild_to_moderate':
    case 'low':
    case 'mild':
      return 3
    case 'unassigned':
    case 'unable-to-assess':
      return 5
    default:
      return 4
  }
}

function sortBySeverity(allergies: FhirAllergyIntolerance[]): FhirAllergyIntolerance[] {
  return [...allergies].sort((a, b) => {
    const aRank = severityRank(severityLabel(a) ?? '')
    const bRank = severityRank(severityLabel(b) ?? '')
    if (aRank !== bRank) return aRank - bRank
    return (b.recordedDate ?? '').localeCompare(a.recordedDate ?? '')
  })
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
