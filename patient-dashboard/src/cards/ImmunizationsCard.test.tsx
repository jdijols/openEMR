import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ImmunizationList, sortByDateDesc } from './ImmunizationsCard'
import type { FhirImmunization } from '../fhir/schemas'

const make = (id: string, occurrenceDateTime?: string, name = id): FhirImmunization => ({
  resourceType: 'Immunization',
  id,
  vaccineCode: { text: name },
  occurrenceDateTime,
  status: 'completed',
})

describe('sortByDateDesc', () => {
  it('sorts by occurrenceDateTime descending', () => {
    const items = [make('a', '2024-01-01'), make('b', '2026-04-01'), make('c', '2025-06-01')]
    expect(sortByDateDesc(items).map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('places undated entries last', () => {
    const items = [make('without'), make('with', '2026-04-01')]
    expect(sortByDateDesc(items).map((i) => i.id)).toEqual(['with', 'without'])
  })
})

describe('<ImmunizationList>', () => {
  it('renders vaccine name and date', () => {
    render(<ImmunizationList immunizations={[make('flu', '2026-04-01', 'Influenza')]} />)
    expect(screen.getByText('Influenza')).toBeInTheDocument()
    expect(screen.getByText(/Apr 1, 2026/)).toBeInTheDocument()
  })

  it('falls back to "Unknown vaccine" when no name available', () => {
    render(
      <ImmunizationList
        immunizations={[{ resourceType: 'Immunization', id: 'x' }]}
      />,
    )
    expect(screen.getByText('Unknown vaccine')).toBeInTheDocument()
  })
})
