import { useEffect, useRef } from 'react'
import { useAuth } from './AuthProvider'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'

const OPENEMR_BASE = import.meta.env.VITE_OPENEMR_BASE_URL
const CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID
const REDIRECT_URI = import.meta.env.VITE_OAUTH_REDIRECT_URI
const SCOPES =
  import.meta.env.VITE_OAUTH_SCOPES ??
  'openid fhirUser launch/patient patient/Patient.read patient/AllergyIntolerance.read patient/Condition.read patient/MedicationRequest.read patient/CareTeam.read patient/Observation.read patient/Immunization.read patient/Appointment.read'

export function Login() {
  const { beginAuthorization } = useAuth()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    void (async () => {
      if (!OPENEMR_BASE || !CLIENT_ID || !REDIRECT_URI) return

      const verifier = generateCodeVerifier()
      const challenge = await generateCodeChallenge(verifier)
      const state = generateState()
      beginAuthorization(verifier, state)

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      window.location.assign(`${OPENEMR_BASE}/oauth2/authorize?${params.toString()}`)
    })()
  }, [beginAuthorization])

  const configMissing = !OPENEMR_BASE || !CLIENT_ID || !REDIRECT_URI
  if (configMissing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-af-surface-alt">
        <div className="max-w-md p-8 rounded-af-card bg-af-surface border border-af-border shadow-sm text-center">
          <div className="text-af-danger font-medium mb-2">OAuth2 config missing</div>
          <div className="text-af-text-subtle text-sm">
            Copy <code className="font-mono text-xs">.env.example</code> to{' '}
            <code className="font-mono text-xs">.env</code> and fill in{' '}
            <code className="font-mono text-xs">VITE_OAUTH_CLIENT_ID</code> from PD-16.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-af-surface-alt">
      <div className="text-af-text-subtle">Redirecting to OpenEMR…</div>
    </div>
  )
}
