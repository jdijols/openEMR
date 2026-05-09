import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MedicationList } from './MedicationsCard'
import type { FhirMedicationRequest } from '../fhir/schemas'

describe('<MedicationList>', () => {
  it('renders drug name and dosage instruction', () => {
    const m: FhirMedicationRequest = {
      resourceType: 'MedicationRequest',
      id: 'm1',
      medicationCodeableConcept: { text: 'Metformin' },
      dosageInstruction: [{ text: '1000 mg : BID' }],
    }
    render(<MedicationList medications={[m]} />)
    expect(screen.getByText('Metformin')).toBeInTheDocument()
    expect(screen.getByText('1000 mg : BID')).toBeInTheDocument()
  })

  it('falls back to "Unknown medication" when no name', () => {
    const m: FhirMedicationRequest = { resourceType: 'MedicationRequest', id: 'x' }
    render(<MedicationList medications={[m]} />)
    expect(screen.getByText('Unknown medication')).toBeInTheDocument()
  })

  it('renders multiple medications', () => {
    const meds: FhirMedicationRequest[] = [
      { resourceType: 'MedicationRequest', id: 'a', medicationCodeableConcept: { text: 'A' } },
      { resourceType: 'MedicationRequest', id: 'b', medicationCodeableConcept: { text: 'B' } },
      { resourceType: 'MedicationRequest', id: 'c', medicationCodeableConcept: { text: 'C' } },
    ]
    render(<MedicationList medications={meds} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
