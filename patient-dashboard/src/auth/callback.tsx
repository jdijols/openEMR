import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, usePendingAuth } from './AuthProvider'

const OPENEMR_BASE = import.meta.env.VITE_OPENEMR_BASE_URL
const CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID
const CLIENT_SECRET = import.meta.env.VITE_OAUTH_CLIENT_SECRET ?? ''
const REDIRECT_URI = import.meta.env.VITE_OAUTH_REDIRECT_URI

type View = { status: 'pending' } | { status: 'error'; message: string }

export function Callback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { completeAuthorization } = useAuth()
  const pending = usePendingAuth()
  const [view, setView] = useState<View>({ status: 'pending' })
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    void (async () => {
      const code = params.get('code')
      const state = params.get('state')
      const oauthError = params.get('error')

      if (oauthError) {
        setView({ status: 'error', message: `OpenEMR returned error: ${oauthError}` })
        return
      }
      if (!code || !state) {
        setView({ status: 'error', message: 'Missing code or state in callback URL' })
        return
      }
      if (!pending) {
        setView({ status: 'error', message: 'No pending authorization — start over from /login' })
        return
      }
      if (state !== pending.csrfState) {
        setView({ status: 'error', message: 'State mismatch — possible CSRF attempt' })
        return
      }
      if (!OPENEMR_BASE || !CLIENT_ID || !REDIRECT_URI) {
        setView({ status: 'error', message: 'Missing OAuth2 env config' })
        return
      }

      try {
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code_verifier: pending.pkceVerifier,
        })

        const resp = await fetch(`${OPENEMR_BASE}/oauth2/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })

        if (!resp.ok) {
          setView({ status: 'error', message: `Token exchange failed (${resp.status})` })
          return
        }

        const tokens = (await resp.json()) as {
          access_token: string
          id_token: string
          refresh_token?: string
          expires_in: number
          patient?: string
        }

        const patientId =
          (typeof tokens.patient === 'string' && tokens.patient.length > 0 ? tokens.patient : null) ??
          extractPatientFromIdToken(tokens.id_token)

        if (!patientId) {
          setView({
            status: 'error',
            message:
              'No patient context returned from OpenEMR. The launch/patient scope did not produce a patient binding — check the SMART launch configuration.',
          })
          return
        }

        completeAuthorization({
          mode: 'bearer',
          accessToken: tokens.access_token,
          idToken: tokens.id_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresIn: tokens.expires_in,
          patientId,
        })

        navigate(`/patient/${patientId}`, { replace: true })
      } catch {
        setView({ status: 'error', message: 'Token exchange threw — check network and try again' })
      }
    })()
  }, [completeAuthorization, navigate, params, pending])

  if (view.status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-af-surface-alt">
        <div className="max-w-md p-8 rounded-af-card bg-af-surface border border-af-border shadow-sm text-center">
          <div className="text-af-danger font-medium mb-2">Authentication failed</div>
          <div className="text-af-text-subtle text-sm mb-6">{view.message}</div>
          <a
            href="/login"
            className="inline-block px-4 py-2 rounded-af-control bg-af-text text-white text-sm hover:bg-af-gray-800"
          >
            Retry login
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-af-surface-alt">
      <div className="text-af-text-subtle">Completing sign in…</div>
    </div>
  )
}

function extractPatientFromIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return null
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed: unknown = JSON.parse(decoded)
    if (typeof parsed !== 'object' || parsed === null) return null
    const claims = parsed as Record<string, unknown>
    const patient = claims.patient
    return typeof patient === 'string' ? patient : null
  } catch {
    return null
  }
}
