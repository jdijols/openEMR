import { ScrollText } from 'lucide-react'
import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirMedicationRequestSchema,
  type FhirMedicationRequest,
} from '../fhir/schemas'
import { formatDob } from '../utils/date'

type Props = { patientId: string }

const MAX_ROWS = 10
const Schema = FhirBundleSchema(FhirMedicationRequestSchema)

export function PrescriptionsCard({ patientId }: Props) {
  const query = useFhirQuery('/MedicationRequest', { patient: patientId, intent: 'order' }, Schema)

  if (query.isLoading) return <ClinicalCard title="Prescriptions" icon={<ScrollText size={16} />} accent="sky" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Prescriptions" icon={<ScrollText size={16} />} accent="sky"
        status="error"
        errorMessage="Could not load prescriptions."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const all = bundleEntries(query.data)
  const sorted = sortAndLimit(all)
  if (sorted.length === 0) {
    return (
      <ClinicalCard
        title="Prescriptions" icon={<ScrollText size={16} />} accent="sky"
        status="empty"
        emptyMessage="No prescriptions on record."
      />
    )
  }
  return (
    <ClinicalCard title="Prescriptions" icon={<ScrollText size={16} />} accent="sky" status="content">
      <PrescriptionList prescriptions={sorted} />
    </ClinicalCard>
  )
}

export function PrescriptionList({ prescriptions }: { prescriptions: FhirMedicationRequest[] }) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {prescriptions.map((m) => (
        <li
          key={m.id}
          className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
        >
          <div className="min-w-0">
            <div className="text-sm text-af-text truncate">{nameOf(m)}</div>
            {m.authoredOn && (
              <div className="mt-0.5 text-xs text-af-text-muted">
                {formatDob(m.authoredOn)}
                {m.status && ` · ${m.status}`}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function sortAndLimit(meds: FhirMedicationRequest[]): FhirMedicationRequest[] {
  return [...meds]
    .sort((a, b) => (b.authoredOn ?? '').localeCompare(a.authoredOn ?? ''))
    .slice(0, MAX_ROWS)
}

function nameOf(m: FhirMedicationRequest): string {
  return (
    m.medicationCodeableConcept?.text ??
    m.medicationCodeableConcept?.coding?.[0]?.display ??
    'Unknown medication'
  )
}
