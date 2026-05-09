import type { ReactNode } from 'react'
import { Cake, IdCard, UserRound, X } from 'lucide-react'
import { useFhirQuery } from '../fhir/hooks'
import { FhirPatientSchema, type FhirPatient } from '../fhir/schemas'
import { calculateAge, formatDob } from '../utils/date'

type Props = { patientId: string }

export function PatientHeader({ patientId }: Props) {
  const query = useFhirQuery(`/Patient/${patientId}`, undefined, FhirPatientSchema)

  if (query.isLoading) {
    return <PatientHeaderSkeleton />
  }
  if (query.error || !query.data) {
    return (
      <PatientHeaderShell>
        <div className="text-af-danger text-sm">Could not load patient</div>
      </PatientHeaderShell>
    )
  }
  return <PatientHeaderView patient={query.data} />
}

export function PatientHeaderView({ patient }: { patient: FhirPatient }) {
  const name = extractName(patient)
  const mrn = extractMrn(patient)
  const sex = capitalize(patient.gender ?? 'unknown')
  const dob = formatDob(patient.birthDate)
  const age = calculateAge(patient.birthDate)
  const isActive = patient.active !== false
  const initials = computeInitials(name)

  return (
    <PatientHeaderShell>
      <div className="flex items-center gap-4">
        <Avatar initials={initials} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-af-text truncate">
              {name}
            </h1>
            <StatusPill active={isActive} />
            <ClearPatientLink />
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[13px] text-af-text-muted">
            <MetaPill icon={<UserRound size={13} aria-hidden />} text={sex} />
            <MetaSeparator />
            <MetaPill icon={<Cake size={13} aria-hidden />} text={dob} />
            {age !== null && (
              <>
                <MetaSeparator />
                <MetaPill text={`${age} yo`} />
              </>
            )}
            {mrn && (
              <>
                <MetaSeparator />
                <MetaPill icon={<IdCard size={13} aria-hidden />} text={`MRN ${mrn}`} />
              </>
            )}
          </div>
        </div>
      </div>
    </PatientHeaderShell>
  )
}

function PatientHeaderShell({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 backdrop-blur-md bg-af-surface/85 border-b border-af-border">
      <div className="px-5 py-4">{children}</div>
    </header>
  )
}

function PatientHeaderSkeleton() {
  return (
    <PatientHeaderShell>
      <div className="flex items-center gap-4 animate-pulse" aria-hidden>
        <div className="h-12 w-12 rounded-full bg-af-gray-200" />
        <div className="space-y-2 flex-1">
          <div className="h-5 bg-af-gray-200 rounded-md w-56" />
          <div className="h-3 bg-af-gray-100 rounded w-72" />
        </div>
      </div>
    </PatientHeaderShell>
  )
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div
      aria-hidden
      className="shrink-0 h-12 w-12 rounded-full flex items-center justify-center text-white text-[15px] font-semibold tracking-wide bg-gradient-to-br from-sky-500 via-sky-600 to-sky-800 ring-2 ring-white shadow-sm"
    >
      {initials}
    </div>
  )
}

function StatusPill({ active }: { active: boolean }) {
  // rounded-md (6 px) reads as a soft rectangle — closer to OpenEMR's squared
  // chrome than fully-rounded pills. Inner dot stays circular: it's a
  // decorative indicator, not a chip.
  if (active) {
    return (
      <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-af-success-50 text-af-success-700 text-[11px] font-medium ring-1 ring-emerald-200/70">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        Active
      </span>
    )
  }
  return (
    <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-af-gray-100 text-af-text-subtle text-[11px] font-medium ring-1 ring-af-border">
      <span className="h-1.5 w-1.5 rounded-full bg-af-gray-400" aria-hidden />
      Inactive
    </span>
  )
}

/**
 * Inline "Clear ×" link beside the patient name. Calls `top.clearPatient()` —
 * the same function the chart-shell's X-on-tab uses to deactivate the patient
 * and open the patient finder. In standalone-dev mode (no chart shell) the
 * call is a no-op; this is fine because the link is a no-op visual element
 * there too — we never render this view without a chart-shell wrapper in
 * production. (Renders only when `top.clearPatient` is defined so it does
 * not appear in standalone-dev where it would do nothing.)
 */
function ClearPatientLink() {
  const handleClick = () => {
    try {
      const t = window.top as unknown as { clearPatient?: (openFinder?: boolean) => void } | null
      t?.clearPatient?.()
    } catch {
      // Same-origin should always allow this; ignore otherwise.
    }
  }
  // Hide entirely when not in an embedded chart shell — the function the
  // button calls only exists there.
  let chartShellAvailable = false
  try {
    chartShellAvailable =
      typeof (window.top as unknown as { clearPatient?: unknown } | null)?.clearPatient === 'function'
  } catch {
    chartShellAvailable = false
  }
  if (!chartShellAvailable) return null

  // gap-1 here (not gap-1.5 like StatusPill) compensates for the lucide
  // X-icon's ~2 px of internal SVG padding so the *perceived* icon-to-text
  // spacing matches Active's flush-edged dot at gap-1.5.
  return (
    <button
      type="button"
      onClick={handleClick}
      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-af-text-subtle bg-af-gray-100 ring-1 ring-af-border hover:text-af-danger-700 hover:bg-af-danger-50 hover:ring-af-danger-700/30 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-af-primary"
      aria-label="Clear active patient and open patient finder"
    >
      <X size={11} aria-hidden strokeWidth={2.5} />
      Clear
    </button>
  )
}

function MetaPill({ icon, text }: { icon?: ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-af-text-muted">
      {icon && <span className="text-af-gray-500">{icon}</span>}
      <span>{text}</span>
    </span>
  )
}

function MetaSeparator() {
  return <span className="text-af-gray-300" aria-hidden>·</span>
}

export function extractName(patient: FhirPatient): string {
  const name = patient.name?.[0]
  if (!name) return 'Unknown patient'
  if (name.text) return name.text
  const given = name.given?.join(' ') ?? ''
  const family = name.family ?? ''
  const assembled = [given, family].filter(Boolean).join(' ').trim()
  return assembled || 'Unknown patient'
}

export function extractMrn(patient: FhirPatient): string | null {
  const identifiers = patient.identifier ?? []
  const mrn = identifiers.find((id) => id.type?.coding?.some((c) => c.code === 'PT'))
  if (mrn?.value) return mrn.value
  const first = identifiers.find((id) => !!id.value)
  return first?.value ?? null
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function computeInitials(name: string): string {
  if (!name || name === 'Unknown patient') return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  const result = (first + last).toUpperCase()
  return result || '?'
}
