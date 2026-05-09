import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirConditionSchema,
  type FhirCondition,
} from '../fhir/schemas'
import { formatDob } from '../utils/date'

type Props = { patientId: string }

const Schema = FhirBundleSchema(FhirConditionSchema)

export function ProblemListCard({ patientId }: Props) {
  const query = useFhirQuery(
    '/Condition',
    { patient: patientId, category: 'problem-list-item' },
    Schema,
  )

  if (query.isLoading) {
    return <ClinicalCard title="Problem List" status="loading" />
  }
  if (query.error) {
    return (
      <ClinicalCard
        title="Problem List"
        status="error"
        errorMessage="Could not load problem list."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const conditions = bundleEntries(query.data).filter(isActive)
  if (conditions.length === 0) {
    return (
      <ClinicalCard
        title="Problem List"
        status="empty"
        emptyMessage="No active problems on file."
      />
    )
  }
  return (
    <ClinicalCard title="Problem List" status="content">
      <ConditionList conditions={conditions} />
    </ClinicalCard>
  )
}

export function ConditionList({ conditions }: { conditions: FhirCondition[] }) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {conditions.map((c) => (
        <li
          key={c.id}
          className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
        >
          <span className="text-sm text-af-text truncate">{nameOf(c)}</span>
          {c.onsetDateTime && (
            <span className="shrink-0 text-xs text-af-text-muted">since {formatDob(c.onsetDateTime)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function nameOf(c: FhirCondition): string {
  return c.code?.text ?? c.code?.coding?.[0]?.display ?? 'Unknown condition'
}

function isActive(c: FhirCondition): boolean {
  const code = c.clinicalStatus?.coding?.[0]?.code
  return !code || code === 'active'
}
