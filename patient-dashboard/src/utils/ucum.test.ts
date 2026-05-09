import { describe, it, expect } from 'vitest'
import { formatQuantity, formatUnit } from './ucum'

describe('formatUnit', () => {
  it('maps common UCUM codes to clinician-readable strings', () => {
    expect(formatUnit('lb_av')).toBe('lb')
    expect(formatUnit('[lb_av]')).toBe('lb')
    expect(formatUnit('in_i')).toBe('in')
    expect(formatUnit('degF')).toBe('°F')
    expect(formatUnit('Cel')).toBe('°C')
    expect(formatUnit('kg/m2')).toBe('kg/m²')
    expect(formatUnit('mm[Hg]')).toBe('mmHg')
  })

  it('returns the original unit for unmapped values', () => {
    expect(formatUnit('mg/dL')).toBe('mg/dL')
    expect(formatUnit('unknown-unit')).toBe('unknown-unit')
  })

  it('returns empty string for undefined', () => {
    expect(formatUnit(undefined)).toBe('')
  })
})

describe('formatQuantity', () => {
  it('formats a number with a normalized unit', () => {
    expect(formatQuantity(175, 'lb_av')).toBe('175 lb')
    expect(formatQuantity(69, 'in_i')).toBe('69 in')
    expect(formatQuantity(25.8, 'kg/m2')).toBe('25.8 kg/m²')
  })

  it('omits the space before degree-prefixed units', () => {
    expect(formatQuantity(98.1, 'degF')).toBe('98.1°F')
    expect(formatQuantity(36.8, 'Cel')).toBe('36.8°C')
  })

  it('omits the space before percent', () => {
    expect(formatQuantity(98, '%')).toBe('98%')
  })

  it('returns null for undefined value', () => {
    expect(formatQuantity(undefined, 'lb_av')).toBeNull()
  })

  it('returns just the number when unit is missing', () => {
    expect(formatQuantity(42, undefined)).toBe('42')
  })
})
