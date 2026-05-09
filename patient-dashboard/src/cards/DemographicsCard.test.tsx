import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DemographicsView } from './DemographicsCard'
import type { FhirPatient } from '../fhir/schemas'

const sofia: FhirPatient = {
  resourceType: 'Patient',
  id: 'p',
  address: [
    {
      use: 'home',
      line: ['123 Main St'],
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
    },
  ],
  telecom: [
    { system: 'phone', value: '512-555-1234', use: 'home' },
    { system: 'email', value: 'sofia@example.com' },
  ],
  communication: [{ language: { text: 'English' } }],
  maritalStatus: { text: 'Single' },
}

describe('<DemographicsView>', () => {
  it('renders address combining line, city/state, and postalCode', () => {
    render(<DemographicsView patient={sofia} />)
    expect(screen.getByText('Address')).toBeInTheDocument()
    expect(screen.getByText(/123 Main St/)).toBeInTheDocument()
    expect(screen.getByText(/Austin, TX/)).toBeInTheDocument()
    expect(screen.getByText(/78701/)).toBeInTheDocument()
  })

  it('renders phone, email, language, marital status', () => {
    render(<DemographicsView patient={sofia} />)
    expect(screen.getByText('512-555-1234')).toBeInTheDocument()
    expect(screen.getByText('sofia@example.com')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('Single')).toBeInTheDocument()
  })

  it('falls back to a friendly message when only header fields are on file', () => {
    render(<DemographicsView patient={{ resourceType: 'Patient', id: 'x' }} />)
    expect(
      screen.getByText('Only the fields shown in the header are on file.'),
    ).toBeInTheDocument()
  })

  it('omits a row when its underlying data is missing', () => {
    const partial: FhirPatient = {
      resourceType: 'Patient',
      id: 'p',
      telecom: [{ system: 'phone', value: '555-0001' }],
    }
    render(<DemographicsView patient={partial} />)
    expect(screen.getByText('555-0001')).toBeInTheDocument()
    expect(screen.queryByText('Email')).not.toBeInTheDocument()
    expect(screen.queryByText('Address')).not.toBeInTheDocument()
  })
})
