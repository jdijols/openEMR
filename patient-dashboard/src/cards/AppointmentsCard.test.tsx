import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppointmentList, sortByStartDesc } from './AppointmentsCard'
import type { FhirAppointment } from '../fhir/schemas'

const make = (
  id: string,
  start?: string,
  status: string = 'booked',
  service?: string,
): FhirAppointment => ({
  resourceType: 'Appointment',
  id,
  start,
  status,
  serviceType: service ? [{ text: service }] : undefined,
})

describe('sortByStartDesc', () => {
  it('sorts by start desc', () => {
    const items = [make('a', '2026-01-01T10:00'), make('b', '2026-05-09T08:00'), make('c', '2026-03-15T14:00')]
    expect(sortByStartDesc(items).map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('<AppointmentList>', () => {
  it('renders service name + start datetime + status pill', () => {
    render(<AppointmentList appointments={[make('a', '2026-05-09T08:00:00Z', 'booked', 'Annual Wellness')]} />)
    expect(screen.getByText('Annual Wellness')).toBeInTheDocument()
    expect(screen.getByText(/May 9, 2026/)).toBeInTheDocument()
    expect(screen.getByText('Booked')).toBeInTheDocument()
  })

  it('falls back to "Appointment" when service is missing', () => {
    render(<AppointmentList appointments={[make('a', '2026-05-09T08:00:00Z')]} />)
    expect(screen.getByText('Appointment')).toBeInTheDocument()
  })

  it('renders Cancelled in danger pill', () => {
    render(<AppointmentList appointments={[make('a', '2026-05-09T08:00:00Z', 'cancelled')]} />)
    const pill = screen.getByText('Cancelled')
    expect(pill).toBeInTheDocument()
    expect(pill.className).toContain('af-danger')
  })
})
