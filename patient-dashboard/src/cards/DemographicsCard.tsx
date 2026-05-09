import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import { FhirPatientSchema, type FhirPatient } from '../fhir/schemas'

type Props = { patientId: string }

export function DemographicsCard({ patientId }: Props) {
  // Reuses the same query key as <PatientHeader>, so this is a cache hit
  // (no additional network round-trip).
  const query = useFhirQuery(`/Patient/${patientId}`, undefined, FhirPatientSchema)

  if (query.isLoading) return <ClinicalCard title="Demographics" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Demographics"
        status="error"
        errorMessage="Could not load demographics."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  if (!query.data) {
    return <ClinicalCard title="Demographics" status="empty" emptyMessage="No demographics on file." />
  }
  return (
    <ClinicalCard title="Demographics" status="content">
      <DemographicsView patient={query.data} />
    </ClinicalCard>
  )
}

export function DemographicsView({ patient }: { patient: FhirPatient }) {
  const rows: Array<{ label: string; value: string }> = []

  const home = patient.address?.find((a) => a.use === 'home') ?? patient.address?.[0]
  if (home) {
    const line1 = home.line?.[0]
    const cityState = [home.city, home.state].filter(Boolean).join(', ')
    const zip = home.postalCode
    const formatted = [line1, [cityState, zip].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
    if (formatted) rows.push({ label: 'Address', value: formatted })
  }

  const phone = patient.telecom?.find((t) => t.system === 'phone')?.value
  if (phone) rows.push({ label: 'Phone', value: phone })

  const email = patient.telecom?.find((t) => t.system === 'email')?.value
  if (email) rows.push({ label: 'Email', value: email })

  const language =
    patient.communication?.[0]?.language?.text ??
    patient.communication?.[0]?.language?.coding?.[0]?.display
  if (language) rows.push({ label: 'Language', value: language })

  const marital = patient.maritalStatus?.text ?? patient.maritalStatus?.coding?.[0]?.display
  if (marital) rows.push({ label: 'Marital Status', value: marital })

  if (rows.length === 0) {
    return <p className="text-sm text-af-text-muted">Only the fields shown in the header are on file.</p>
  }

  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-xs text-af-text-muted">{r.label}</dt>
          <dd className="text-sm text-af-text">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}
