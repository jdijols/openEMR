import { Target } from 'lucide-react'
import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirConditionSchema,
} from '../fhir/schemas'
import { ConditionList } from './ProblemListCard'

type Props = { patientId: string }

const Schema = FhirBundleSchema(FhirConditionSchema)

export function HealthConcernsCard({ patientId }: Props) {
  const query = useFhirQuery(
    '/Condition',
    { patient: patientId, category: 'health-concern' },
    Schema,
  )

  if (query.isLoading) return <ClinicalCard title="Health Concerns" icon={<Target size={16} />} accent="amber" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Health Concerns" icon={<Target size={16} />} accent="amber"
        status="error"
        errorMessage="Could not load health concerns."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const conditions = bundleEntries(query.data).filter((c) => {
    const code = c.clinicalStatus?.coding?.[0]?.code
    return !code || code === 'active'
  })
  if (conditions.length === 0) {
    return (
      <ClinicalCard
        title="Health Concerns" icon={<Target size={16} />} accent="amber"
        status="empty"
        emptyMessage="No health concerns recorded."
      />
    )
  }
  return (
    <ClinicalCard title="Health Concerns" icon={<Target size={16} />} accent="amber" status="content">
      <ConditionList conditions={conditions} />
    </ClinicalCard>
  )
}
