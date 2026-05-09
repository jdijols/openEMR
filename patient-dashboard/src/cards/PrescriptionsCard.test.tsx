import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PrescriptionList, sortAndLimit } from './PrescriptionsCard'
import type { FhirMedicationRequest } from '../fhir/schemas'

const make = (id: string, authoredOn?: string): FhirMedicationRequest => ({
  resourceType: 'MedicationRequest',
  id,
  medicationCodeableConcept: { text: id },
  authoredOn,
})

describe('sortAndLimit', () => {
  it('sorts by authoredOn descending', () => {
    const meds = [make('a', '2024-01-01'), make('b', '2026-05-01'), make('c', '2025-03-01')]
    const sorted = sortAndLimit(meds)
    expect(sorted.map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('caps at 10 rows', () => {
    const meds = Array.from({ length: 15 }, (_, i) =>
      make(`m${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`),
    )
    expect(sortAndLimit(meds)).toHaveLength(10)
  })

  it('sorts entries without authoredOn last', () => {
    const meds = [make('with', '2026-05-01'), make('without')]
    const sorted = sortAndLimit(meds)
    expect(sorted.map((m) => m.id)).toEqual(['with', 'without'])
  })
})

describe('<PrescriptionList>', () => {
  it('renders the medication name and authoredOn date', () => {
    render(<PrescriptionList prescriptions={[make('Metformin', '2026-05-08')]} />)
    expect(screen.getByText('Metformin')).toBeInTheDocument()
    expect(screen.getByText(/May 8, 2026/)).toBeInTheDocument()
  })
})
