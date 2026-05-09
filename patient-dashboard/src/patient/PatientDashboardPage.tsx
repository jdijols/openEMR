import { Navigate, useParams } from 'react-router-dom'
import { PatientHeader } from './PatientHeader'
import { AllergiesCard } from '../cards/AllergiesCard'
import { ProblemListCard } from '../cards/ProblemListCard'
import { MedicationsCard } from '../cards/MedicationsCard'
import { PrescriptionsCard } from '../cards/PrescriptionsCard'
import { CareTeamCard } from '../cards/CareTeamCard'
import { VitalsCard } from '../cards/VitalsCard'
import { DemographicsCard } from '../cards/DemographicsCard'
import { HealthConcernsCard } from '../cards/HealthConcernsCard'
import { ImmunizationsCard } from '../cards/ImmunizationsCard'
import { AppointmentsCard } from '../cards/AppointmentsCard'
import { LabsCard } from '../cards/LabsCard'
import { useAccessToken } from '../auth/AuthProvider'

export function PatientDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const accessToken = useAccessToken()

  // Token is in memory only (D1) — a hard refresh wipes it. Re-route to /login
  // rather than render the dashboard in a broken state.
  if (!accessToken) {
    return <Navigate to="/login" replace />
  }
  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-af-surface-alt">
        <div className="text-af-text-subtle">Missing patient id.</div>
      </div>
    )
  }
  return (
    <div className="min-h-screen bg-af-surface-alt">
      <PatientHeader patientId={id} />
      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <AllergiesCard patientId={id} />
        <ProblemListCard patientId={id} />
        <HealthConcernsCard patientId={id} />
        <MedicationsCard patientId={id} />
        <PrescriptionsCard patientId={id} />
        <CareTeamCard patientId={id} />
        <VitalsCard patientId={id} />
        <LabsCard patientId={id} />
        <ImmunizationsCard patientId={id} />
        <AppointmentsCard patientId={id} />
        <DemographicsCard patientId={id} />
      </main>
    </div>
  )
}
