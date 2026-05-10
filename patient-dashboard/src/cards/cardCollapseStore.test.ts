import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  setExpanded,
  setAllExpanded,
  useCardExpanded,
  useAllCardsExpanded,
  _resetForTesting,
} from './cardCollapseStore'

const STORAGE_KEY = 'agentforge:dashboard:card-collapse'

describe('cardCollapseStore', () => {
  beforeEach(() => {
    _resetForTesting()
  })

  it('defaults unknown titles to expanded', () => {
    const { result } = renderHook(() => useCardExpanded('Allergies'))
    expect(result.current[0]).toBe(true)
  })

  it('persists `setExpanded` writes to localStorage', () => {
    const { result } = renderHook(() => useCardExpanded('Allergies'))
    act(() => {
      result.current[1](false)
    })
    expect(result.current[0]).toBe(false)
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual({ Allergies: false })
  })

  it('only touches registered titles when `setAllExpanded` is called', () => {
    // Mount one card. Pre-seed an unregistered title in storage that
    // setAllExpanded should NOT overwrite — verifies the per-mount scoping.
    setExpanded('OrphanCard', false)
    const { result } = renderHook(() => useCardExpanded('Allergies'))
    expect(result.current[0]).toBe(true)

    act(() => {
      setAllExpanded(false)
    })
    expect(result.current[0]).toBe(false)

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(raw.Allergies).toBe(false)
    expect(raw.OrphanCard).toBe(false) // pre-existing, untouched
  })

  it('flips between collapsed and expanded for all registered cards', () => {
    const a = renderHook(() => useCardExpanded('Allergies'))
    const v = renderHook(() => useCardExpanded('Vitals'))

    act(() => {
      setAllExpanded(false)
    })
    expect(a.result.current[0]).toBe(false)
    expect(v.result.current[0]).toBe(false)

    act(() => {
      setAllExpanded(true)
    })
    expect(a.result.current[0]).toBe(true)
    expect(v.result.current[0]).toBe(true)
  })

  it('reports `useAllCardsExpanded` as false when any registered card is collapsed', () => {
    renderHook(() => useCardExpanded('Allergies'))
    renderHook(() => useCardExpanded('Vitals'))
    const all = renderHook(() => useAllCardsExpanded())

    expect(all.result.current).toBe(true)

    act(() => {
      setExpanded('Vitals', false)
    })
    expect(all.result.current).toBe(false)

    act(() => {
      setExpanded('Vitals', true)
    })
    expect(all.result.current).toBe(true)
  })

  it('does not throw when localStorage is unavailable', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded')
    }
    try {
      const { result } = renderHook(() => useCardExpanded('Allergies'))
      expect(() => act(() => result.current[1](false))).not.toThrow()
      // In-memory state still updates even if write fails.
      expect(result.current[0]).toBe(false)
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
