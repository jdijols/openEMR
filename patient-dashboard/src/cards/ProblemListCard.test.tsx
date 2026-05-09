import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConditionList } from './ProblemListCard'
import type { FhirCondition } from '../fhir/schemas'

describe('<ConditionList>', () => {
  it('renders condition text + onset date when present', () => {
    const c: FhirCondition = {
      resourceType: 'Condition',
      id: 'c1',
      code: { text: 'Hypertension' },
      onsetDateTime: '2020-03-15',
    }
    render(<ConditionList conditions={[c]} />)
    expect(screen.getByText('Hypertension')).toBeInTheDocument()
    expect(screen.getByText(/since Mar 15, 2020/)).toBeInTheDocument()
  })

  it('omits the date sub-line when onsetDateTime is missing', () => {
    const c: FhirCondition = { resourceType: 'Condition', id: 'c1', code: { text: 'Asthma' } }
    render(<ConditionList conditions={[c]} />)
    expect(screen.getByText('Asthma')).toBeInTheDocument()
    expect(screen.queryByText(/since/)).not.toBeInTheDocument()
  })

  it('renders multiple conditions', () => {
    const list: FhirCondition[] = [
      { resourceType: 'Condition', id: 'a', code: { text: 'A' } },
      { resourceType: 'Condition', id: 'b', code: { text: 'B' } },
    ]
    render(<ConditionList conditions={list} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
