import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'

// `bearer` is the standalone-dev path (OAuth2 + PKCE → access token in memory).
// `localApi` is the module-embedded production path: same-origin session cookie
// + APICSRFTOKEN header against OpenEMR's LocalApi auth strategy. Both produce
// authorized FHIR calls; the wire format differs (Authorization: Bearer vs
// APICSRFTOKEN). The `token` field carries the credential under either mode.
export type FhirAuthMode = 'bearer' | 'localApi'

export type AuthState =
  | { status: 'unauthenticated' }
  | { status: 'authenticating'; pkceVerifier: string; csrfState: string }
  | {
      status: 'authenticated'
      mode: FhirAuthMode
      accessToken: string
      idToken: string
      refreshToken: string | null
      expiresAt: number
      patientId: string | null
    }

export type AuthorizedTokens = {
  mode: FhirAuthMode
  accessToken: string
  idToken: string
  refreshToken: string | null
  expiresIn: number
  patientId: string | null
}

type AuthContextValue = {
  state: AuthState
  beginAuthorization: (pkceVerifier: string, csrfState: string) => void
  completeAuthorization: (tokens: AuthorizedTokens) => void
  logout: () => void
}

// Pending auth (PKCE verifier + CSRF state) lives in sessionStorage so it survives the
// full-page navigation to OpenEMR and back. Access/ID/refresh tokens stay in-memory only (D1).
const PENDING_KEY = 'patient-dashboard:pending-auth'

function readPending(): { pkceVerifier: string; csrfState: string } | null {
  if (typeof sessionStorage === 'undefined') return null
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { pkceVerifier?: unknown }).pkceVerifier === 'string' &&
      typeof (parsed as { csrfState?: unknown }).csrfState === 'string'
    ) {
      return {
        pkceVerifier: (parsed as { pkceVerifier: string }).pkceVerifier,
        csrfState: (parsed as { csrfState: string }).csrfState,
      }
    }
    return null
  } catch {
    return null
  }
}

function writePending(pkceVerifier: string, csrfState: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ pkceVerifier, csrfState }))
}

function clearPending(): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.removeItem(PENDING_KEY)
}

function initialState(initialAuth: AuthorizedTokens | undefined): AuthState {
  // Module-embedded mode: PHP loader injects a credential + patient context
  // before the React app boots, so we start in `authenticated` immediately —
  // no OAuth round-trip in the browser, no patient picker, no consent screen.
  if (initialAuth) {
    return {
      status: 'authenticated',
      mode: initialAuth.mode,
      accessToken: initialAuth.accessToken,
      idToken: initialAuth.idToken,
      refreshToken: initialAuth.refreshToken,
      expiresAt: Date.now() + initialAuth.expiresIn * 1000,
      patientId: initialAuth.patientId,
    }
  }
  // Standalone-dev fallback: rehydrate from sessionStorage if a redirect
  // cycle is in progress (PKCE verifier survived a full-page navigation).
  const pending = readPending()
  if (pending) {
    return { status: 'authenticating', ...pending }
  }
  return { status: 'unauthenticated' }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({
  children,
  initialAuth,
}: {
  children: ReactNode
  initialAuth?: AuthorizedTokens
}) {
  const [state, setState] = useState<AuthState>(() => initialState(initialAuth))

  const beginAuthorization = useCallback((pkceVerifier: string, csrfState: string) => {
    writePending(pkceVerifier, csrfState)
    setState({ status: 'authenticating', pkceVerifier, csrfState })
  }, [])

  const completeAuthorization = useCallback((tokens: AuthorizedTokens) => {
    clearPending()
    setState({
      status: 'authenticated',
      mode: tokens.mode,
      accessToken: tokens.accessToken,
      idToken: tokens.idToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
      patientId: tokens.patientId,
    })
  }, [])

  const logout = useCallback(() => {
    clearPending()
    setState({ status: 'unauthenticated' })
  }, [])

  return (
    <AuthContext.Provider value={{ state, beginAuthorization, completeAuthorization, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

export function useAccessToken(): string | null {
  const { state } = useAuth()
  return state.status === 'authenticated' ? state.accessToken : null
}

export type FhirCredential = { mode: FhirAuthMode; token: string }

export function useFhirCredential(): FhirCredential | null {
  const { state } = useAuth()
  if (state.status !== 'authenticated') return null
  return { mode: state.mode, token: state.accessToken }
}

export function usePendingAuth(): { pkceVerifier: string; csrfState: string } | null {
  const { state } = useAuth()
  if (state.status !== 'authenticating') return null
  return { pkceVerifier: state.pkceVerifier, csrfState: state.csrfState }
}
