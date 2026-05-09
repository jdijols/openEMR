import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { mostRecentEncounter, VitalsView } from './VitalsCard'
import type { FhirObservation } from '../fhir/schemas'

const obs = (
  id: string,
  loinc: string,
  value: number,
  unit: string,
  effectiveDateTime = '2026-05-09T08:48:00Z',
): FhirObservation => ({
  resourceType: 'Observation',
  id,
  code: { coding: [{ code: loinc, system: 'http://loinc.org' }] },
  effectiveDateTime,
  valueQuantity: { value, unit },
})

describe('mostRecentEncounter', () => {
  it('returns null for empty observations', () => {
    expect(mostRecentEncounter([])).toBeNull()
  })

  it('groups observations by minute and returns the latest group', () => {
    const earlier = [
      obs('a', '8480-6', 110, 'mmHg', '2026-05-01T10:00:00Z'),
      obs('b', '8462-4', 70, 'mmHg', '2026-05-01T10:00:00Z'),
    ]
    const later = [
      obs('c', '8480-6', 119, 'mmHg', '2026-05-09T08:48:00Z'),
      obs('d', '8462-4', 75, 'mmHg', '2026-05-09T08:48:00Z'),
    ]
    const result = mostRecentEncounter([...earlier, ...later])
    expect(result).not.toBeNull()
    expect(result?.observations).toHaveLength(2)
    expect(result?.observations.map((o) => o.id).sort()).toEqual(['c', 'd'])
  })

  it('skips observations with no effectiveDateTime', () => {
    const undated: FhirObservation = {
      resourceType: 'Observation',
      id: 'x',
      code: { coding: [{ code: '8480-6' }] },
      valueQuantity: { value: 100 },
    }
    const result = mostRecentEncounter([
      undated,
      obs('y', '8480-6', 110, 'mmHg', '2026-05-09T08:48:00Z'),
    ])
    expect(result?.observations.map((o) => o.id)).toEqual(['y'])
  })
})

describe('<VitalsView>', () => {
  it('renders the encounter datetime header', () => {
    const encounter = {
      datetime: '2026-05-09T08:48:00Z',
      observations: [obs('a', '8867-4', 71, 'per min')],
    }
    render(<VitalsView encounter={encounter} />)
    expect(screen.getByText(/Most recent vitals from/)).toBeInTheDocument()
  })

  it('renders BP from systolic + diastolic separate Observations', () => {
    const encounter = {
      datetime: '2026-05-09T08:48:00Z',
      observations: [obs('s', '8480-6', 119, 'mmHg'), obs('d', '8462-4', 75, 'mmHg')],
    }
    render(<VitalsView encounter={encounter} />)
    expect(screen.getByText('Blood Pressure')).toBeInTheDocument()
    expect(screen.getByText('119/75')).toBeInTheDocument()
  })

  it('renders pulse / respiration / temperature with units', () => {
    const encounter = {
      datetime: '2026-05-09T08:48:00Z',
      observations: [
        obs('p', '8867-4', 71, 'per min'),
        obs('r', '9279-1', 16, 'per min'),
        obs('t', '8310-5', 98.3, 'F'),
      ],
    }
    render(<VitalsView encounter={encounter} />)
    expect(screen.getByText('71 per min')).toBeInTheDocument()
    expect(screen.getByText('16 per min')).toBeInTheDocument()
    expect(screen.getByText('98.3 F')).toBeInTheDocument()
  })

  it('omits rows without observations', () => {
    const encounter = {
      datetime: '2026-05-09T08:48:00Z',
      observations: [obs('p', '8867-4', 71, 'per min')],
    }
    render(<VitalsView encounter={encounter} />)
    expect(screen.queryByText('Blood Pressure')).not.toBeInTheDocument()
  })
})
