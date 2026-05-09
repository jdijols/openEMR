import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CareTeamList } from './CareTeamCard'
import type { FhirCareTeam } from '../fhir/schemas'

const greatClinic: FhirCareTeam = {
  resourceType: 'CareTeam',
  id: 'ct1',
  name: 'Great Clinic',
  status: 'active',
  participant: [
    {
      member: { reference: 'Practitioner/1', display: 'Lee, Donna' },
      role: [{ text: 'Primary Care Provider' }],
    },
  ],
}

describe('<CareTeamList>', () => {
  it('renders the team name banner with status pill', () => {
    render(<CareTeamList teams={[greatClinic]} />)
    expect(screen.getByText('Great Clinic')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders participant member display + role text', () => {
    render(<CareTeamList teams={[greatClinic]} />)
    expect(screen.getByText('Lee, Donna')).toBeInTheDocument()
    expect(screen.getByText('Primary Care Provider')).toBeInTheDocument()
  })

  it('renders multiple teams', () => {
    const second: FhirCareTeam = { ...greatClinic, id: 'ct2', name: 'Second Clinic' }
    render(<CareTeamList teams={[greatClinic, second]} />)
    expect(screen.getByText('Great Clinic')).toBeInTheDocument()
    expect(screen.getByText('Second Clinic')).toBeInTheDocument()
  })

  it('renders fallback "Unknown member" when display is missing', () => {
    const t: FhirCareTeam = {
      resourceType: 'CareTeam',
      id: 'ct',
      participant: [{ role: [{ text: 'Nurse' }] }],
    }
    render(<CareTeamList teams={[t]} />)
    expect(screen.getByText('Unknown member')).toBeInTheDocument()
  })
})
