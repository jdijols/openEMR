import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirImmunizationSchema,
  type FhirImmunization,
} from '../fhir/schemas'
import { formatDob } from '../utils/date'

type Props = { patientId: string }

const Schema = FhirBundleSchema(FhirImmunizationSchema)

export function ImmunizationsCard({ patientId }: Props) {
  const query = useFhirQuery('/Immunization', { patient: patientId, _sort: '-date' }, Schema)

  if (query.isLoading) return <ClinicalCard title="Immunizations" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Immunizations"
        status="error"
        errorMessage="Could not load immunizations."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const all = bundleEntries(query.data).filter((i) => i.status !== 'entered-in-error')
  const sorted = sortByDateDesc(all)
  if (sorted.length === 0) {
    return (
      <ClinicalCard
        title="Immunizations"
        status="empty"
        emptyMessage="No immunizations recorded."
      />
    )
  }
  return (
    <ClinicalCard title="Immunizations" status="content">
      <ImmunizationList immunizations={sorted} />
    </ClinicalCard>
  )
}

export function ImmunizationList({ immunizations }: { immunizations: FhirImmunization[] }) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {immunizations.map((i) => (
        <li
          key={i.id}
          className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
        >
          <span className="text-sm text-af-text truncate">{vaccineName(i)}</span>
          {i.occurrenceDateTime && (
            <span className="shrink-0 text-xs text-af-text-muted">{formatDob(i.occurrenceDateTime)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function sortByDateDesc(immunizations: FhirImmunization[]): FhirImmunization[] {
  return [...immunizations].sort((a, b) =>
    (b.occurrenceDateTime ?? '').localeCompare(a.occurrenceDateTime ?? ''),
  )
}

function vaccineName(i: FhirImmunization): string {
  return i.vaccineCode?.text ?? i.vaccineCode?.coding?.[0]?.display ?? 'Unknown vaccine'
}
