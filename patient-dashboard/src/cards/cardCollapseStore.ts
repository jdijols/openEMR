/**
 * Per-clinician dashboard card collapse state, persisted to localStorage so
 * it survives chart-shell tab switches (which fully unmount the React tree)
 * and patient changes. Keyed by card title — collapsing "Allergies" on one
 * patient leaves it collapsed for every other patient too, mirroring how a
 * clinician's view preferences should feel sticky across the workday.
 *
 * Trade-off vs. a server-side per-user pref (legacy parity): localStorage is
 * per-browser, not per-user-globally. Acceptable for an EHR clinician on a
 * single workstation; if multi-device sync becomes a requirement, swap the
 * read/write functions for an AJAX-backed implementation behind the same
 * hook surface.
 */

import { useEffect, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'agentforge:dashboard:card-collapse'

type State = Record<string, boolean>

const knownTitles = new Set<string>()
const listeners = new Set<() => void>()

function readFromStorage(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const out: State = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'boolean') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeToStorage(s: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    // Quota exceeded or storage disabled — degrade to in-memory only.
  }
}

let snapshot: State = typeof window === 'undefined' ? {} : readFromStorage()

function notify(): void {
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setExpanded(title: string, expanded: boolean): void {
  const current = snapshot[title] ?? true
  if (current === expanded) return
  snapshot = { ...snapshot, [title]: expanded }
  writeToStorage(snapshot)
  notify()
}

export function setAllExpanded(expanded: boolean): void {
  const next: State = { ...snapshot }
  let changed = false
  for (const title of knownTitles) {
    const current = next[title] ?? true
    if (current !== expanded) {
      next[title] = expanded
      changed = true
    }
  }
  if (!changed) return
  snapshot = next
  writeToStorage(snapshot)
  notify()
}

function getIsExpanded(title: string): boolean {
  return snapshot[title] !== false
}

function getAllExpanded(): boolean {
  for (const title of knownTitles) {
    if (snapshot[title] === false) return false
  }
  return true
}

export function useCardExpanded(title: string): [boolean, (next: boolean) => void] {
  useEffect(() => {
    knownTitles.add(title)
    notify()
    return () => {
      knownTitles.delete(title)
      notify()
    }
  }, [title])

  const expanded = useSyncExternalStore(
    subscribe,
    () => getIsExpanded(title),
    () => true,
  )
  const set = (next: boolean): void => setExpanded(title, next)
  return [expanded, set]
}

export function useAllCardsExpanded(): boolean {
  return useSyncExternalStore(
    subscribe,
    getAllExpanded,
    () => true,
  )
}

/**
 * Test-only: reset module state and localStorage. Vitest carries module state
 * across tests in the same file; calling this in `beforeEach` keeps tests
 * independent without paying the cost of `vi.resetModules()`.
 */
export function _resetForTesting(): void {
  knownTitles.clear()
  listeners.clear()
  snapshot = {}
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
