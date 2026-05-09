import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ClinicalCard } from './ClinicalCard'

describe('<ClinicalCard>', () => {
  it('renders the title', () => {
    render(<ClinicalCard title="Allergies" status="content">body</ClinicalCard>)
    expect(screen.getByRole('heading', { name: /Allergies/ })).toBeInTheDocument()
  })

  it('renders children only when status is content', () => {
    const { rerender } = render(
      <ClinicalCard title="x" status="content">
        <span>inner-content</span>
      </ClinicalCard>,
    )
    expect(screen.getByText('inner-content')).toBeInTheDocument()

    rerender(
      <ClinicalCard title="x" status="loading">
        <span>inner-content</span>
      </ClinicalCard>,
    )
    expect(screen.queryByText('inner-content')).not.toBeInTheDocument()
  })

  it('renders the empty message when status is empty', () => {
    render(
      <ClinicalCard title="x" status="empty" emptyMessage="No allergies on file." />,
    )
    expect(screen.getByText('No allergies on file.')).toBeInTheDocument()
  })

  it('renders the error message + correlation id when status is error', () => {
    render(
      <ClinicalCard
        title="x"
        status="error"
        errorMessage="Could not load allergies."
        errorCorrelationId="abc123"
      />,
    )
    expect(screen.getByText('Could not load allergies.')).toBeInTheDocument()
    expect(screen.getByText(/correlation: abc123/)).toBeInTheDocument()
  })

  it('exposes status as a data attribute for testing', () => {
    const { container } = render(<ClinicalCard title="x" status="loading" />)
    const section = container.querySelector('section')
    expect(section?.getAttribute('data-status')).toBe('loading')
  })

  it('renders an action node next to the title when provided', () => {
    render(<ClinicalCard title="x" status="content" action={<span>edit</span>} />)
    expect(screen.getByText('edit')).toBeInTheDocument()
  })
})
