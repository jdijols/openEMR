import { Users } from 'lucide-react'
import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirCareTeamSchema,
  type FhirCareTeam,
} from '../fhir/schemas'

type Props = { patientId: string }

const Schema = FhirBundleSchema(FhirCareTeamSchema)

export function CareTeamCard({ patientId }: Props) {
  const query = useFhirQuery('/CareTeam', { patient: patientId }, Schema)

  if (query.isLoading) return <ClinicalCard title="Care Team" icon={<Users size={16} />} accent="emerald" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Care Team" icon={<Users size={16} />} accent="emerald"
        status="error"
        errorMessage="Could not load care team."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const teams = bundleEntries(query.data)
  const populated = teams.filter((t) => (t.participant?.length ?? 0) > 0)
  if (populated.length === 0) {
    return (
      <ClinicalCard
        title="Care Team" icon={<Users size={16} />} accent="emerald"
        status="empty"
        emptyMessage="No care team members assigned."
      />
    )
  }
  return (
    <ClinicalCard title="Care Team" icon={<Users size={16} />} accent="emerald" status="content">
      <CareTeamList teams={populated} />
    </ClinicalCard>
  )
}

export function CareTeamList({ teams }: { teams: FhirCareTeam[] }) {
  return (
    <div className="space-y-4">
      {teams.map((t) => (
        <div key={t.id}>
          {(t.name || t.status) && (
            <div className="mb-1.5 flex items-center gap-2">
              {t.name && <span className="text-sm font-medium text-af-text">{t.name}</span>}
              {t.status && (
                <span
                  className={
                    t.status === 'active'
                      ? 'inline-flex items-center px-2 py-0.5 rounded-md bg-af-success-50 text-af-success-700 text-xs font-medium ring-1 ring-af-success-50'
                      : 'inline-flex items-center px-2 py-0.5 rounded-md bg-af-gray-100 text-af-text-subtle text-xs font-medium ring-1 ring-af-border'
                  }
                >
                  {capitalize(t.status)}
                </span>
              )}
            </div>
          )}
          <ul className="divide-y divide-af-gray-100">
            {(t.participant ?? []).map((p, i) => (
              <li key={`${t.id}-${i}`} className="py-2 first:pt-0 last:pb-0">
                <div className="text-sm text-af-text truncate">
                  {p.member?.display ?? 'Unknown member'}
                </div>
                {p.role?.[0] && (
                  <div className="mt-0.5 text-xs text-af-text-muted truncate">
                    {p.role[0].text ?? p.role[0].coding?.[0]?.display}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
