import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { AuthProvider, type AuthorizedTokens } from './auth/AuthProvider'
import { FhirRequestError } from './fhir/client'
import './index.css'

// Vite injects BASE_URL with a trailing slash; React Router's basename should
// be slash-prefixed without trailing — strip it. In production this resolves
// to `/interface/modules/custom_modules/oe-module-agentforge/public/dashboard`.
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined

// Module-embedded entry. The PHP loader (public/dashboard.php in the agentforge
// module) injects the patient context + a same-origin LocalApi CSRF token
// before this script runs, so we boot directly into the authenticated state —
// no OAuth flow in the browser, no patient picker, no consent screen. FHIR
// requests are sent with `APICSRFTOKEN: <csrfToken>` + the existing OpenEMR
// session cookie (same-origin). When this global is absent (dev mode at
// localhost:5174), the OAuth flow runs normally via `/login` and `/callback`,
// and FHIR requests use `Authorization: Bearer <accessToken>`.
declare global {
  interface Window {
    __AGENTFORGE_DASHBOARD__?: {
      patientId: string
      pid?: number
      csrfToken: string
      fhirBase?: string
      webroot?: string
      authUser?: string
      // AgentForge proposal API (Hono service, separate auth from FHIR).
      // `apiBase` and `launchCode` are injected by dashboard.php on every
      // page load; `afSessionToken` is set by the JS bootstrap below after
      // redeeming the single-use launch code. The modal in
      // proposals/session.ts gates on `afSessionToken` and degrades to an
      // explicit error state when redemption fails or the agentforge env
      // var is unset. Mirrors panel.php's CUI handshake flow.
      apiBase?: string
      launchCode?: string
      afSessionToken?: string
    }
  }
}

const injected = window.__AGENTFORGE_DASHBOARD__

const initialAuth: AuthorizedTokens | undefined = injected
  ? {
      mode: 'localApi',
      accessToken: injected.csrfToken,
      idToken: '',
      refreshToken: null,
      expiresIn: 3600,
      patientId: injected.patientId,
    }
  : undefined

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof FhirRequestError && error.detail.kind === 'unauthorized') {
        const loginPath = `${ROUTER_BASENAME ?? ''}/login`
        if (window.location.pathname !== loginPath) {
          window.location.assign(loginPath)
        }
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element in index.html')

// Routing strategy depends on mode:
// - Embedded: the iframe URL is dashboard.php (NOT under /dashboard/), so the
//   Vite-derived BrowserRouter basename doesn't match the pathname and no
//   route renders. We don't need URL routing in embedded mode anyway — the
//   PHP loader hands us the patient ID directly. MemoryRouter is keyed off
//   an in-memory history, so the iframe URL is irrelevant.
// - Standalone-dev: localhost:5174 serves at base "/", BrowserRouter works
//   normally for the OAuth /login → /callback → /patient/:id flow.
const RouterTree = injected ? (
  <MemoryRouter initialEntries={[`/patient/${injected.patientId}`]}>
    <App />
  </MemoryRouter>
) : (
  <BrowserRouter basename={ROUTER_BASENAME}>
    <App />
  </BrowserRouter>
)

/**
 * G2-Final — redeem the agentforge launch code for a session token before
 * the React app boots. Mirrors the CUI's `useHandshake` redemption: the
 * launch code is single-use, server-issued (dashboard.php), and time-bound;
 * the resulting session token is what the proposal-lifecycle API requires.
 *
 * Failure modes degrade rather than throw — the dashboard's read-only cards
 * (FHIR fetched via the OpenEMR LocalApi pathway) are unaffected. The
 * AllergyModal's `proposals/session.ts` returns null when `afSessionToken`
 * is missing, which surfaces as an explicit "AgentForge session not
 * available. Reload the chart to continue." inside the modal.
 */
async function redeemAgentforgeSession(): Promise<void> {
  if (injected === undefined) {
    return
  }
  const code = injected.launchCode
  const base = injected.apiBase
  if (typeof code !== 'string' || code === '' || typeof base !== 'string' || base === '') {
    return
  }
  const apiBase = base.replace(/\/+$/, '')
  try {
    const res = await fetch(`${apiBase}/handshake/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ launch_code: code }),
    })
    if (!res.ok) {
      // Single-use code may have been consumed by a duplicate fetch under
      // StrictMode dev double-mount. Don't fail the boot; the modal will
      // surface its degraded state and the user can reload.
      // eslint-disable-next-line no-console
      console.warn('agentforge handshake redeem failed:', res.status)
      return
    }
    const json = (await res.json()) as { session_token?: unknown }
    if (typeof json.session_token === 'string' && json.session_token !== '') {
      injected.afSessionToken = json.session_token
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('agentforge handshake redeem error:', e)
  }
}

void redeemAgentforgeSession().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider initialAuth={initialAuth}>{RouterTree}</AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
})
