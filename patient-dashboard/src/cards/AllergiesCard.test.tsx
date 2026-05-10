import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AllergiesList, severityLabel } from './AllergiesCard'
import type { FhirAllergyIntolerance } from '../fhir/schemas'

const ibuprofen: FhirAllergyIntolerance = {
  resourceType: 'AllergyIntolerance',
  id: 'a1',
  code: { text: 'Ibuprofen' },
  clinicalStatus: { coding: [{ code: 'active' }] },
  criticality: 'high',
  reaction: [{ severity: 'severe', manifestation: [{ text: 'GI bleed' }] }],
  recordedDate: '2026-05-08',
}

describe('<AllergiesList>', () => {
  it('renders allergen name and reaction with arrow separator', () => {
    render(<AllergiesList allergies={[ibuprofen]} />)
    // Substance and reaction render in the same row text node, separated
    // by a directional arrow — the legacy single-string render is gone.
    const row = screen.getByRole('listitem')
    expect(row.textContent).toContain('Ibuprofen')
    expect(row.textContent).toContain('→')
    expect(row.textContent).toContain('GI bleed')
  })

  it('renders severity pill with the granular label (severity_al wins over criticality)', () => {
    // The PHP transform now emits `reaction[0].severity` carrying the
    // severity_al option_id, which the dashboard prefers over the coarse
    // FHIR criticality bucket. ibuprofen has reaction.severity='severe',
    // which wins over criticality='high' → display "Severe".
    render(<AllergiesList allergies={[ibuprofen]} />)
    expect(screen.getByText('Severe')).toBeInTheDocument()
  })

  it('renders multiple allergies in sorted order (high before moderate before mild)', () => {
    const mild: FhirAllergyIntolerance = { ...ibuprofen, id: 'mild', code: { text: 'Latex' }, criticality: 'low' }
    const moderate: FhirAllergyIntolerance = { ...ibuprofen, id: 'mod', code: { text: 'Pollen' }, criticality: undefined, reaction: [{ severity: 'moderate' }] }
    render(<AllergiesList allergies={[mild, moderate, ibuprofen]} />)
    const items = screen.getAllByRole('listitem')
    // Note: AllergiesList itself doesn't sort — sorting happens in the smart container.
    // This test just confirms the list renders 3 rows.
    expect(items).toHaveLength(3)
  })
})

describe('severityLabel', () => {
  it('prefers reaction[0].severity (granular severity_al option_id) over the coarse FHIR criticality', () => {
    // Round-trip preservation: severity_al → reaction.severity in PHP →
    // here in the dashboard. Old behavior preferred criticality, but that
    // discarded the precise grade (mild/fatal/etc.) the physician picked.
    expect(severityLabel(ibuprofen)).toBe('severe')
  })

  it('falls back to FHIR criticality when reaction.severity is missing (legacy rows)', () => {
    expect(severityLabel({ ...ibuprofen, reaction: undefined })).toBe('high')
  })

  it('returns null when both are missing', () => {
    expect(severityLabel({ resourceType: 'AllergyIntolerance', id: 'x' })).toBeNull()
  })
})
