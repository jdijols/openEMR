import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ClinicalCard } from './ClinicalCard'
import { _resetForTesting as resetCardCollapseStore } from '../cards/cardCollapseStore'

describe('<ClinicalCard>', () => {
  beforeEach(() => {
    resetCardCollapseStore()
  })

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

  it('starts expanded by default', () => {
    render(
      <ClinicalCard title="Allergies" status="content">
        <span>inner-content</span>
      </ClinicalCard>,
    )
    expect(screen.getByRole('button', { name: /Allergies/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('inner-content')).toBeVisible()
  })

  it('collapses the body when the title is clicked, and re-expands on a second click', () => {
    render(
      <ClinicalCard title="Allergies" status="content">
        <span>inner-content</span>
      </ClinicalCard>,
    )
    const toggle = screen.getByRole('button', { name: /Allergies/ })

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('inner-content')).not.toBeVisible()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('inner-content')).toBeVisible()
  })

  it('does not toggle when the action button is clicked', () => {
    render(
      <ClinicalCard title="Allergies" status="content" action={<button>add</button>}>
        <span>inner-content</span>
      </ClinicalCard>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'add' }))
    expect(screen.getByRole('button', { name: /Allergies/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('inner-content')).toBeVisible()
  })
})
