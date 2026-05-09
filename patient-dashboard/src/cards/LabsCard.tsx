import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirObservationSchema,
  type FhirObservation,
} from '../fhir/schemas'
import { formatDob } from '../utils/date'
import { formatQuantity } from '../utils/ucum'

type Props = { patientId: string }

const MAX_ROWS = 20
const Schema = FhirBundleSchema(FhirObservationSchema)

export function LabsCard({ patientId }: Props) {
  const query = useFhirQuery(
    '/Observation',
    {
      patient: patientId,
      category: 'laboratory',
      _sort: '-date',
      _count: 50,
    },
    Schema,
  )

  if (query.isLoading) return <ClinicalCard title="Labs" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Labs"
        status="error"
        errorMessage="Could not load labs."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const labs = bundleEntries(query.data).slice(0, MAX_ROWS)
  if (labs.length === 0) {
    return <ClinicalCard title="Labs" status="empty" emptyMessage="No labs recorded." />
  }
  return (
    <ClinicalCard title="Labs" status="content">
      <LabList labs={labs} />
    </ClinicalCard>
  )
}

export function LabList({ labs }: { labs: FhirObservation[] }) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {labs.map((l) => (
        <li key={l.id} className="py-2 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-af-text truncate">{labName(l)}</div>
              <div className="mt-0.5 text-xs text-af-text-muted">
                {l.effectiveDateTime && formatDob(l.effectiveDateTime)}
                {referenceRangeText(l) && (
                  <>
                    {l.effectiveDateTime ? ' · ref ' : 'ref '}
                    {referenceRangeText(l)}
                  </>
                )}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {labValue(l) && (
                <span
                  className={`text-sm font-medium ${
                    isAbnormal(l) ? 'text-af-danger-700' : 'text-af-text'
                  }`}
                >
                  {labValue(l)}
                </span>
              )}
              {isAbnormal(l) && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-af-danger-50 text-af-danger-700 ring-1 ring-af-danger-50">
                  {abnormalLabel(l)}
                </span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function labName(l: FhirObservation): string {
  return l.code?.text ?? l.code?.coding?.[0]?.display ?? 'Unknown lab'
}

function labValue(l: FhirObservation): string | null {
  if (l.valueQuantity) {
    return formatQuantity(l.valueQuantity.value, l.valueQuantity.unit)
  }
  if (l.valueString) return l.valueString
  if (l.valueCodeableConcept) {
    return l.valueCodeableConcept.text ?? l.valueCodeableConcept.coding?.[0]?.display ?? null
  }
  return null
}

function referenceRangeText(l: FhirObservation): string | null {
  const r = l.referenceRange?.[0]
  if (!r) return null
  if (r.text) return r.text
  const lo = r.low?.value
  const hi = r.high?.value
  if (lo !== undefined && hi !== undefined) return `${lo}–${hi}`
  if (hi !== undefined) return `≤ ${hi}`
  if (lo !== undefined) return `≥ ${lo}`
  return null
}

export function isAbnormal(l: FhirObservation): boolean {
  const interpretationCode = l.interpretation?.[0]?.coding?.[0]?.code
  if (interpretationCode && interpretationCode !== 'N') return true

  const value = l.valueQuantity?.value
  if (value === undefined) return false
  const r = l.referenceRange?.[0]
  if (!r) return false
  if (r.low?.value !== undefined && value < r.low.value) return true
  if (r.high?.value !== undefined && value > r.high.value) return true
  return false
}

function abnormalLabel(l: FhirObservation): string {
  const code = l.interpretation?.[0]?.coding?.[0]?.code
  switch (code) {
    case 'H':
      return 'High'
    case 'L':
      return 'Low'
    case 'HH':
      return 'Critical High'
    case 'LL':
      return 'Critical Low'
    case 'A':
      return 'Abnormal'
    default: {
      // Fall back to range comparison
      const value = l.valueQuantity?.value
      const r = l.referenceRange?.[0]
      if (value !== undefined && r?.high?.value !== undefined && value > r.high.value) return 'High'
      if (value !== undefined && r?.low?.value !== undefined && value < r.low.value) return 'Low'
      return 'Abnormal'
    }
  }
}
