import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { AuthProvider, type AuthorizedTokens } from './auth/AuthProvider'
import { FhirRequestError } from './fhir/client'
import './index.css'

// Vite injects BASE_URL with a trailing slash; React Router's basename should
// be slash-prefixed without trailing — strip it. In production this resolves
// to `/interface/modules/custom_modules/oe-module-agentforge/public/dashboard`.
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || undefined

// Module-embedded entry. The PHP loader (dashboard.php in the agentforge module)
// injects the patient context + a SMART access token here before this script
// runs, so we boot directly into the authenticated state — no OAuth flow in
// the browser, no patient picker, no consent screen. When this global is
// absent (dev mode at localhost:5174), the OAuth flow runs normally via
// `/login` and `/callback`.
declare global {
  interface Window {
    __AGENTFORGE_DASHBOARD__?: {
      patientId: string
      accessToken: string
      idToken?: string
      expiresIn?: number
    }
  }
}

const injected = window.__AGENTFORGE_DASHBOARD__

const initialAuth: AuthorizedTokens | undefined = injected
  ? {
      accessToken: injected.accessToken,
      idToken: injected.idToken ?? '',
      refreshToken: null,
      expiresIn: injected.expiresIn ?? 3600,
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

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider initialAuth={initialAuth}>
        <BrowserRouter basename={ROUTER_BASENAME}>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
