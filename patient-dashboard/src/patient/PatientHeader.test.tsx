import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PatientHeaderView, extractMrn, extractName } from './PatientHeader'
import type { FhirPatient } from '../fhir/schemas'

const sofia: FhirPatient = {
  resourceType: 'Patient',
  id: 'a1ba47a7-ccfd-4a1d-8db1-6497ba4a837b',
  name: [{ family: 'Reyes', given: ['Sofia', 'M'] }],
  birthDate: '1983-12-19',
  gender: 'female',
  identifier: [
    { system: 'http://terminology.hl7.org/CodeSystem/v2-0203', value: '0031', type: { coding: [{ code: 'PT' }] } },
    { system: 'http://hl7.org/fhir/sid/us-ssn', value: '900-45-1013', type: { coding: [{ code: 'SS' }] } },
  ],
  active: true,
}

describe('<PatientHeaderView>', () => {
  it('renders the assembled name', () => {
    render(<PatientHeaderView patient={sofia} />)
    expect(screen.getByRole('heading', { name: /Sofia M Reyes/ })).toBeInTheDocument()
  })

  it('renders sex, DOB, age, and MRN in the meta line', () => {
    render(<PatientHeaderView patient={sofia} />)
    const meta = screen.getByText(/Female/)
    expect(meta).toBeInTheDocument()
    expect(meta.textContent).toMatch(/Dec 19, 1983/)
    expect(meta.textContent).toMatch(/MRN 0031/)
    expect(meta.textContent).toMatch(/yo/)
  })

  it('renders Active pill when patient is active', () => {
    render(<PatientHeaderView patient={sofia} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders Inactive pill when patient.active is false', () => {
    render(<PatientHeaderView patient={{ ...sofia, active: false }} />)
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('falls back to "Unknown patient" when name array is missing', () => {
    render(<PatientHeaderView patient={{ resourceType: 'Patient', id: 'x' }} />)
    expect(screen.getByRole('heading', { name: /Unknown patient/ })).toBeInTheDocument()
  })
})

describe('extractName', () => {
  it('uses name.text when present', () => {
    expect(extractName({ resourceType: 'Patient', id: 'x', name: [{ text: 'Foo Bar' }] })).toBe('Foo Bar')
  })

  it('assembles given + family otherwise', () => {
    expect(extractName({ resourceType: 'Patient', id: 'x', name: [{ given: ['Jane', 'Q'], family: 'Doe' }] })).toBe('Jane Q Doe')
  })

  it('returns Unknown patient when name is missing', () => {
    expect(extractName({ resourceType: 'Patient', id: 'x' })).toBe('Unknown patient')
  })
})

describe('extractMrn', () => {
  it('prefers the identifier with type.coding.code === PT', () => {
    expect(extractMrn(sofia)).toBe('0031')
  })

  it('falls back to first identifier with a value when no PT type', () => {
    expect(
      extractMrn({
        resourceType: 'Patient',
        id: 'x',
        identifier: [{ system: 'something', value: 'fallback' }],
      }),
    ).toBe('fallback')
  })

  it('returns null when no identifiers exist', () => {
    expect(extractMrn({ resourceType: 'Patient', id: 'x' })).toBeNull()
  })
})
