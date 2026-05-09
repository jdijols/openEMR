import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AuthProvider, useAccessToken, useAuth, useFhirCredential } from './AuthProvider'

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>
}

describe('<AuthProvider>', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('starts unauthenticated when sessionStorage is empty', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.state.status).toBe('unauthenticated')
  })

  it('useAccessToken returns null when unauthenticated', () => {
    const { result } = renderHook(() => useAccessToken(), { wrapper })
    expect(result.current).toBeNull()
  })

  it('beginAuthorization persists verifier+csrfState to sessionStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => {
      result.current.beginAuthorization('verifier-abc', 'state-xyz')
    })
    expect(result.current.state.status).toBe('authenticating')
    if (result.current.state.status === 'authenticating') {
      expect(result.current.state.pkceVerifier).toBe('verifier-abc')
      expect(result.current.state.csrfState).toBe('state-xyz')
    }
    const raw = sessionStorage.getItem('patient-dashboard:pending-auth')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw ?? 'null') as { pkceVerifier: string; csrfState: string }
    expect(parsed.pkceVerifier).toBe('verifier-abc')
    expect(parsed.csrfState).toBe('state-xyz')
  })

  it('rehydrates authenticating state from sessionStorage on fresh mount', () => {
    sessionStorage.setItem(
      'patient-dashboard:pending-auth',
      JSON.stringify({ pkceVerifier: 'restored-v', csrfState: 'restored-s' }),
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.state.status).toBe('authenticating')
    if (result.current.state.status === 'authenticating') {
      expect(result.current.state.pkceVerifier).toBe('restored-v')
      expect(result.current.state.csrfState).toBe('restored-s')
    }
  })

  it('ignores malformed sessionStorage data', () => {
    sessionStorage.setItem('patient-dashboard:pending-auth', '{not-json')
    const { result } = renderHook(() => useAuth(), { wrapper })
    expect(result.current.state.status).toBe('unauthenticated')
  })

  it('completeAuthorization stores tokens, clears sessionStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => {
      result.current.beginAuthorization('v', 's')
    })
    expect(sessionStorage.getItem('patient-dashboard:pending-auth')).not.toBeNull()
    act(() => {
      result.current.completeAuthorization({
        mode: 'bearer',
        accessToken: 'access',
        idToken: 'id',
        refreshToken: 'refresh',
        expiresIn: 3600,
        patientId: 'pt-123',
      })
    })
    expect(result.current.state.status).toBe('authenticated')
    if (result.current.state.status === 'authenticated') {
      expect(result.current.state.mode).toBe('bearer')
      expect(result.current.state.accessToken).toBe('access')
      expect(result.current.state.refreshToken).toBe('refresh')
      expect(result.current.state.patientId).toBe('pt-123')
      expect(result.current.state.expiresAt).toBeGreaterThan(Date.now())
    }
    expect(sessionStorage.getItem('patient-dashboard:pending-auth')).toBeNull()
  })

  it('logout clears state and sessionStorage', () => {
    const { result } = renderHook(() => useAuth(), { wrapper })
    act(() => {
      result.current.beginAuthorization('v', 's')
    })
    expect(sessionStorage.getItem('patient-dashboard:pending-auth')).not.toBeNull()
    act(() => {
      result.current.completeAuthorization({
        mode: 'bearer',
        accessToken: 'a',
        idToken: 'i',
        refreshToken: null,
        expiresIn: 60,
        patientId: null,
      })
    })
    act(() => {
      result.current.logout()
    })
    expect(result.current.state.status).toBe('unauthenticated')
    expect(sessionStorage.getItem('patient-dashboard:pending-auth')).toBeNull()
  })

  it('useFhirCredential returns null when unauthenticated', () => {
    const { result } = renderHook(() => useFhirCredential(), { wrapper })
    expect(result.current).toBeNull()
  })

  it('useFhirCredential returns {mode, token} after completeAuthorization', () => {
    const { result } = renderHook(
      () => ({ auth: useAuth(), credential: useFhirCredential() }),
      { wrapper },
    )
    act(() => {
      result.current.auth.completeAuthorization({
        mode: 'localApi',
        accessToken: 'csrf-40-char-token',
        idToken: '',
        refreshToken: null,
        expiresIn: 3600,
        patientId: 'pt-1',
      })
    })
    expect(result.current.credential).toEqual({
      mode: 'localApi',
      token: 'csrf-40-char-token',
    })
  })

  it('useAuth throws outside <AuthProvider>', () => {
    expect(() => renderHook(() => useAuth())).toThrow(/useAuth must be used inside/)
  })
})
