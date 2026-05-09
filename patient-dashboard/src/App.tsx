import { Navigate, Route, Routes } from 'react-router-dom'
import { Callback } from './auth/callback'
import { Login } from './auth/login'
import { useAuth } from './auth/AuthProvider'
import { PatientDashboardPage } from './patient/PatientDashboardPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/login" element={<Login />} />
      <Route path="/callback" element={<Callback />} />
      <Route path="/patient/:id" element={<PatientDashboardPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

// Module-embedded mode: the PHP loader injects auth state, so AuthProvider
// boots `authenticated` with a patient context — go straight to the dashboard.
// Standalone-dev mode: nothing injected, kick off the OAuth flow.
function HomeRoute() {
  const { state } = useAuth()
  if (state.status === 'authenticated' && state.patientId) {
    return <Navigate to={`/patient/${state.patientId}`} replace />
  }
  return <Navigate to="/login" replace />
}

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-af-gray-100">
      <div className="text-af-text-muted">Not found</div>
    </div>
  )
}
