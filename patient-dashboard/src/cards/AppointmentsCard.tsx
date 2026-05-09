import { CalendarDays } from 'lucide-react'
import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirAppointmentSchema,
  FhirBundleSchema,
  type FhirAppointment,
} from '../fhir/schemas'
import { formatDateTime } from '../utils/date'

type Props = { patientId: string }

const MAX_ROWS = 10
const Schema = FhirBundleSchema(FhirAppointmentSchema)

export function AppointmentsCard({ patientId }: Props) {
  const query = useFhirQuery('/Appointment', { patient: patientId, _count: 50 }, Schema)

  if (query.isLoading) return <ClinicalCard title="Appointments" icon={<CalendarDays size={16} />} accent="sky" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Appointments" icon={<CalendarDays size={16} />} accent="sky"
        status="error"
        errorMessage="Could not load appointments."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const sorted = sortByStartDesc(bundleEntries(query.data)).slice(0, MAX_ROWS)
  if (sorted.length === 0) {
    return (
      <ClinicalCard
        title="Appointments" icon={<CalendarDays size={16} />} accent="sky"
        status="empty"
        emptyMessage="No upcoming appointments."
      />
    )
  }
  return (
    <ClinicalCard title="Appointments" icon={<CalendarDays size={16} />} accent="sky" status="content">
      <AppointmentList appointments={sorted} />
    </ClinicalCard>
  )
}

export function AppointmentList({ appointments }: { appointments: FhirAppointment[] }) {
  return (
    <ul className="divide-y divide-af-gray-100">
      {appointments.map((a) => (
        <li key={a.id} className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm text-af-text truncate">
              {serviceName(a) ?? 'Appointment'}
            </div>
            {a.start && (
              <div className="mt-0.5 text-xs text-af-text-muted">{formatDateTime(a.start)}</div>
            )}
          </div>
          {a.status && <StatusPill status={a.status} />}
        </li>
      ))}
    </ul>
  )
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === 'booked' || status === 'fulfilled'
      ? 'bg-af-success-50 text-af-success-700 ring-af-success-50'
      : status === 'cancelled' || status === 'noshow'
        ? 'bg-af-danger-50 text-af-danger-700 ring-af-danger-50'
        : 'bg-af-gray-100 text-af-text-subtle ring-af-border'
  return (
    <span
      className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ring-1 ${cls}`}
    >
      {capitalize(status)}
    </span>
  )
}

export function sortByStartDesc(appointments: FhirAppointment[]): FhirAppointment[] {
  return [...appointments].sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))
}

function serviceName(a: FhirAppointment): string | null {
  return a.serviceType?.[0]?.text ?? a.serviceType?.[0]?.coding?.[0]?.display ?? a.description ?? null
}

function capitalize(s: string): string {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}
