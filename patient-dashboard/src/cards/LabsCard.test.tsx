import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { isAbnormal, LabList } from './LabsCard'
import type { FhirObservation } from '../fhir/schemas'

const lab = (
  overrides: Partial<FhirObservation> & { id: string },
): FhirObservation => ({
  resourceType: 'Observation',
  code: { text: 'LDL Cholesterol' },
  effectiveDateTime: '2026-05-01',
  valueQuantity: { value: 110, unit: 'mg/dL' },
  referenceRange: [{ high: { value: 100 } }],
  ...overrides,
})

describe('isAbnormal', () => {
  it('flags as abnormal when interpretation code is non-N', () => {
    expect(isAbnormal(lab({ id: 'a', interpretation: [{ coding: [{ code: 'H' }] }] }))).toBe(true)
  })

  it('flags as normal when interpretation code is N', () => {
    expect(
      isAbnormal(lab({ id: 'a', interpretation: [{ coding: [{ code: 'N' }] }], valueQuantity: { value: 50 } })),
    ).toBe(false)
  })

  it('infers abnormal from value > high reference', () => {
    expect(isAbnormal(lab({ id: 'a', valueQuantity: { value: 150 }, referenceRange: [{ high: { value: 100 } }] }))).toBe(
      true,
    )
  })

  it('infers abnormal from value < low reference', () => {
    expect(isAbnormal(lab({ id: 'a', valueQuantity: { value: 50 }, referenceRange: [{ low: { value: 70 } }] }))).toBe(true)
  })

  it('returns false when no reference range and no interpretation', () => {
    expect(isAbnormal({ resourceType: 'Observation', id: 'a', valueQuantity: { value: 100 } })).toBe(false)
  })
})

describe('<LabList>', () => {
  it('renders lab name + value + reference range', () => {
    render(<LabList labs={[lab({ id: 'l1' })]} />)
    expect(screen.getByText('LDL Cholesterol')).toBeInTheDocument()
    expect(screen.getByText(/110 mg\/dL/)).toBeInTheDocument()
    expect(screen.getByText(/ref/)).toBeInTheDocument()
  })

  it('marks abnormal labs with the High/Low pill', () => {
    render(
      <LabList
        labs={[
          lab({
            id: 'l1',
            valueQuantity: { value: 158, unit: 'mg/dL' },
            interpretation: [{ coding: [{ code: 'H' }] }],
          }),
        ]}
      />,
    )
    expect(screen.getByText('High')).toBeInTheDocument()
  })

  it('renders multiple labs', () => {
    render(
      <LabList
        labs={[lab({ id: 'a', code: { text: 'Glucose' } }), lab({ id: 'b', code: { text: 'HbA1c' } })]}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
