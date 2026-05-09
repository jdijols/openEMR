import { Pill } from 'lucide-react'
import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirMedicationRequestSchema,
  type FhirMedicationRequest,
} from '../fhir/schemas'

type Props = { patientId: string }

const Schema = FhirBundleSchema(FhirMedicationRequestSchema)

export function MedicationsCard({ patientId }: Props) {
  const query = useFhirQuery(
    '/MedicationRequest',
    { patient: patientId, intent: 'order', status: 'active' },
    Schema,
  )

  if (query.isLoading) return <ClinicalCard title="Medications" icon={<Pill size={16} />} accent="sky" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Medications" icon={<Pill size={16} />} accent="sky"
        status="error"
        errorMessage="Could not load medications."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const meds = bundleEntries(query.data)
  if (meds.length === 0) {
    return <ClinicalCard title="Medications" icon={<Pill size={16} />} accent="sky" status="empty" emptyMessage="No active medications." />
  }
  return (
    <ClinicalCard title="Medications" icon={<Pill size={16} />} accent="sky" status="content">
      <MedicationList medications={meds} />
    </ClinicalCard>
  )
}

export function MedicationList({ medications }: { medications: FhirMedicationRequest[] }) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {medications.map((m) => (
        <li key={m.id} className="py-2 first:pt-0 last:pb-0">
          <div className="text-sm text-af-text truncate">{nameOf(m)}</div>
          {sigOf(m) && <div className="mt-0.5 text-xs text-af-text-muted truncate">{sigOf(m)}</div>}
        </li>
      ))}
    </ul>
  )
}

function nameOf(m: FhirMedicationRequest): string {
  return (
    m.medicationCodeableConcept?.text ??
    m.medicationCodeableConcept?.coding?.[0]?.display ??
    'Unknown medication'
  )
}

function sigOf(m: FhirMedicationRequest): string | null {
  return m.dosageInstruction?.[0]?.text ?? null
}
