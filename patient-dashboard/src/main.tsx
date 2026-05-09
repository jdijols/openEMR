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

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialAuth={initialAuth}>{RouterTree}</AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
