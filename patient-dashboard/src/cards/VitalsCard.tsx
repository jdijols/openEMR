import { ClinicalCard } from '../components/ClinicalCard'
import { useFhirQuery } from '../fhir/hooks'
import {
  bundleEntries,
  FhirBundleSchema,
  FhirObservationSchema,
  type FhirObservation,
} from '../fhir/schemas'
import { formatDateTime } from '../utils/date'
import { formatQuantity } from '../utils/ucum'

type Props = { patientId: string }

// LOINC codes used by SMART vital-signs profile.
const LOINC = {
  bpPanel: '85354-9',
  systolic: '8480-6',
  diastolic: '8462-4',
  pulse: '8867-4',
  respiration: '9279-1',
  temperature: '8310-5',
  weight: '29463-7',
  height: '8302-2',
  bmi: '39156-5',
  oxygenSaturation: '59408-5',
}

const Schema = FhirBundleSchema(FhirObservationSchema)

export function VitalsCard({ patientId }: Props) {
  const query = useFhirQuery(
    '/Observation',
    {
      patient: patientId,
      category: 'vital-signs',
      _sort: '-date',
      _count: 50,
    },
    Schema,
  )

  if (query.isLoading) return <ClinicalCard title="Vitals" status="loading" />
  if (query.error) {
    return (
      <ClinicalCard
        title="Vitals"
        status="error"
        errorMessage="Could not load vitals."
        errorCorrelationId={query.error.detail.correlationId}
      />
    )
  }
  const observations = bundleEntries(query.data)
  const latest = mostRecentEncounter(observations)
  if (!latest) {
    return <ClinicalCard title="Vitals" status="empty" emptyMessage="No vitals recorded." />
  }
  return (
    <ClinicalCard title="Vitals" status="content">
      <VitalsView encounter={latest} />
    </ClinicalCard>
  )
}

export function VitalsView({
  encounter,
}: {
  encounter: { datetime: string; observations: FhirObservation[] }
}) {
  const rows = renderRows(encounter.observations)
  return (
    <div>
      <div className="text-xs text-af-text-muted mb-2">
        Most recent vitals from <span className="text-af-text-subtle">{formatDateTime(encounter.datetime)}</span>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-xs text-af-text-muted">{r.label}</dt>
            <dd className="text-sm text-af-text font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function mostRecentEncounter(
  observations: FhirObservation[],
): { datetime: string; observations: FhirObservation[] } | null {
  if (observations.length === 0) return null
  const groups = new Map<string, FhirObservation[]>()
  for (const o of observations) {
    const dt = o.effectiveDateTime ?? o.effectivePeriod?.start
    if (!dt) continue
    // Group by minute granularity to align observations from the same encounter.
    const key = dt.slice(0, 16)
    const existing = groups.get(key) ?? []
    existing.push(o)
    groups.set(key, existing)
  }
  if (groups.size === 0) return null
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a))
  const top = sortedKeys[0]!
  return { datetime: top, observations: groups.get(top)! }
}

type Row = { label: string; value: string }

function renderRows(obs: FhirObservation[]): Row[] {
  const rows: Row[] = []
  const bp = bpReading(obs)
  if (bp) rows.push({ label: 'Blood Pressure', value: bp })

  const pulse = numericFromLoinc(obs, LOINC.pulse)
  if (pulse) rows.push({ label: 'Pulse', value: pulse })

  const respiration = numericFromLoinc(obs, LOINC.respiration)
  if (respiration) rows.push({ label: 'Respiration', value: respiration })

  const temperature = numericFromLoinc(obs, LOINC.temperature)
  if (temperature) rows.push({ label: 'Temperature', value: temperature })

  const weight = numericFromLoinc(obs, LOINC.weight)
  if (weight) rows.push({ label: 'Weight', value: weight })

  const height = numericFromLoinc(obs, LOINC.height)
  if (height) rows.push({ label: 'Height', value: height })

  const bmi = numericFromLoinc(obs, LOINC.bmi)
  if (bmi) rows.push({ label: 'BMI', value: bmi })

  const oxygen = numericFromLoinc(obs, LOINC.oxygenSaturation)
  if (oxygen) rows.push({ label: 'Oxygen Saturation', value: oxygen })

  return rows
}

function findByLoinc(obs: FhirObservation[], loinc: string): FhirObservation | undefined {
  return obs.find((o) => o.code?.coding?.some((c) => c.code === loinc))
}

function numericFromLoinc(obs: FhirObservation[], loinc: string): string | null {
  const o = findByLoinc(obs, loinc)
  if (!o?.valueQuantity) return null
  return formatQuantity(o.valueQuantity.value, o.valueQuantity.unit)
}

// (formatQuantity is imported from utils/ucum and applies UCUM-to-display normalization.)

function bpReading(obs: FhirObservation[]): string | null {
  const panel = findByLoinc(obs, LOINC.bpPanel)
  if (panel?.component) {
    const sys = panel.component.find((c) => c.code?.coding?.some((cc) => cc.code === LOINC.systolic))
    const dia = panel.component.find((c) => c.code?.coding?.some((cc) => cc.code === LOINC.diastolic))
    if (sys?.valueQuantity?.value !== undefined && dia?.valueQuantity?.value !== undefined) {
      return `${sys.valueQuantity.value}/${dia.valueQuantity.value}`
    }
  }
  const sys = findByLoinc(obs, LOINC.systolic)
  const dia = findByLoinc(obs, LOINC.diastolic)
  if (sys?.valueQuantity?.value !== undefined && dia?.valueQuantity?.value !== undefined) {
    return `${sys.valueQuantity.value}/${dia.valueQuantity.value}`
  }
  return null
}

