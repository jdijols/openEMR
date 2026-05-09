import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirAllergyIntoleranceSchema,
  FhirBundleSchema,
  type FhirAllergyIntolerance,
} from '../fhir/schemas'

type Props = { patientId: string }

const Schema = FhirBundleSchema(FhirAllergyIntoleranceSchema)

export function AllergiesCard({ patientId }: Props) {
  const query = useFhirQuery('/AllergyIntolerance', { patient: patientId }, Schema)

  if (query.isLoading) {
    return <ClinicalCard title="Allergies" status="loading" />
  }
  if (query.error) {
    return (
      <ClinicalCard
        title="Allergies"
        status="error"
        errorMessage="Could not load allergies."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const all = bundleEntries(query.data).filter(isActive)
  const sorted = sortBySeverity(all)
  if (sorted.length === 0) {
    return <ClinicalCard title="Allergies" status="empty" emptyMessage="No active allergies on file." />
  }
  return (
    <ClinicalCard title="Allergies" status="content">
      <AllergiesList allergies={sorted} />
    </ClinicalCard>
  )
}

export function AllergiesList({ allergies }: { allergies: FhirAllergyIntolerance[] }) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {allergies.map((a) => (
        <li key={a.id} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
          <span className="text-sm text-af-text truncate">{nameOf(a)}</span>
          <SeverityPill allergy={a} />
        </li>
      ))}
    </ul>
  )
}

function SeverityPill({ allergy }: { allergy: FhirAllergyIntolerance }) {
  const label = severityLabel(allergy)
  if (!label) return null
  const cls = severityClass(label)
  return (
    <span
      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${cls}`}
    >
      {capitalize(label)}
    </span>
  )
}

function nameOf(a: FhirAllergyIntolerance): string {
  return a.code?.text ?? a.code?.coding?.[0]?.display ?? 'Unknown allergen'
}

function isActive(a: FhirAllergyIntolerance): boolean {
  const code = a.clinicalStatus?.coding?.[0]?.code
  return !code || code === 'active'
}

export function severityLabel(a: FhirAllergyIntolerance): string | null {
  if (a.criticality) return a.criticality
  return a.reaction?.[0]?.severity ?? null
}

function severityClass(label: string): string {
  switch (label.toLowerCase()) {
    case 'high':
    case 'severe':
      return 'bg-af-danger-50 text-af-danger-700 ring-af-danger-50'
    case 'moderate':
      return 'bg-af-warning-50 text-af-warning-700 ring-af-warning-50'
    case 'low':
    case 'mild':
      return 'bg-af-success-50 text-af-success-700 ring-af-success-50'
    case 'unable-to-assess':
    default:
      return 'bg-af-gray-100 text-af-text-subtle ring-af-border'
  }
}

function severityRank(label: string): number {
  switch (label.toLowerCase()) {
    case 'high':
    case 'severe':
      return 0
    case 'moderate':
      return 1
    case 'low':
    case 'mild':
      return 2
    default:
      return 3
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
