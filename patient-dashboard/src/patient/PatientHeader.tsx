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

  return (
    <PatientHeaderShell>
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-af-text truncate">{name}</h1>
          <p className="mt-0.5 text-sm text-af-text-muted truncate">
            {sex} · {dob}
            {age !== null && ` · ${age} yo`}
            {mrn && ` · MRN ${mrn}`}
          </p>
        </div>
        <span
          className={
            isActive
              ? 'shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full bg-af-success-50 text-af-success-700 text-xs font-medium ring-1 ring-af-success-50'
              : 'shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full bg-af-gray-100 text-af-text-subtle text-xs font-medium ring-1 ring-af-border'
          }
        >
          {isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
    </PatientHeaderShell>
  )
}

function PatientHeaderShell({ children }: { children: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 bg-af-surface border-b border-af-border">
      <div className="max-w-4xl mx-auto px-6 py-4">{children}</div>
    </header>
  )
}

function PatientHeaderSkeleton() {
  return (
    <PatientHeaderShell>
      <div className="space-y-2 animate-pulse" aria-hidden>
        <div className="h-5 bg-af-gray-100 rounded w-48" />
        <div className="h-3 bg-af-gray-100 rounded w-72" />
      </div>
    </PatientHeaderShell>
  )
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
