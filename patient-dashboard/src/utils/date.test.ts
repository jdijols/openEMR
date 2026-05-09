import { describe, it, expect } from 'vitest'
import { calculateAge, formatDob } from './date'

describe('formatDob', () => {
  it('formats an ISO date as Mon DD, YYYY', () => {
    expect(formatDob('1983-12-19')).toBe('Dec 19, 1983')
  })

  it('returns em-dash for undefined', () => {
    expect(formatDob(undefined)).toBe('—')
  })

  it('returns the original string for unparseable input', () => {
    expect(formatDob('not-a-date')).toBe('not-a-date')
  })
})

describe('calculateAge', () => {
  it('returns full years when birthday already passed this year', () => {
    expect(calculateAge('1983-12-19', new Date('2026-12-20'))).toBe(43)
  })

  it('returns previous-year age when birthday has not passed yet', () => {
    expect(calculateAge('1983-12-19', new Date('2026-05-08'))).toBe(42)
  })

  it('exact birthday returns the new age', () => {
    expect(calculateAge('1983-12-19', new Date('2026-12-19'))).toBe(43)
  })

  it('returns null for undefined birthDate', () => {
    expect(calculateAge(undefined)).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(calculateAge('not-a-date')).toBeNull()
  })
})
