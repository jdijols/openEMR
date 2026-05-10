import '@testing-library/jest-dom/vitest'

// Vitest 4's `--localstorage-file` emulation isn't wired up in this project,
// so the global `localStorage` is an empty object with no Storage methods —
// `localStorage.getItem` is undefined. Code under test (e.g. cardCollapseStore)
// wraps storage access in try/catch and degrades to in-memory only, which
// hides persistence assertions from tests. Provide a Map-backed Storage
// polyfill so tests can actually exercise the localStorage codepath.
if (typeof localStorage.getItem !== 'function') {
  const store = new Map<string, string>()
  const polyfill: Storage = {
    get length() {
      return store.size
    },
    clear: () => {
      store.clear()
    },
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v))
    },
    removeItem: (k: string) => {
      store.delete(k)
    },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: polyfill,
    writable: false,
    configurable: true,
  })
}
