import { Navigate, useParams } from 'react-router-dom'
import { PatientHeader } from './PatientHeader'
import { PatientSubNav } from './PatientSubNav'
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
import { useFhirCredential } from '../auth/AuthProvider'

export function PatientDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const credential = useFhirCredential()

  // Token is in memory only (D1) — a hard refresh wipes it. In bearer mode
  // (standalone-dev) re-route to /login. In localApi mode (production) a
  // missing credential means the PHP loader was never reached, so /login
  // wouldn't help — the parent OpenEMR session needs to recover. Show an
  // explicit message rather than render the dashboard in a broken state.
  if (!credential) {
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
    <div className="min-h-screen bg-gradient-to-b from-af-surface-alt via-af-surface-alt to-sky-50/30">
      <PatientHeader patientId={id} />
      <PatientSubNav />
      {/*
        px-5 (20 px) matches the inter-card gap-5 / space-y-5 (also 20 px),
        so the breathing room on the left edge of the leftmost card equals
        the gap between adjacent cards. No max-width / mx-auto by design:
        the dashboard fills whatever horizontal space the chart-shell iframe
        gives it, so the cards expand to occupy the full canvas regardless
        of whether the CUI rail is open or collapsed. Same 20 px padding
        on both edges at every viewport.
      */}
      <main className="px-5 py-6 space-y-5">
        {/*
          Layout mirrors the legacy demographics.php structure with our reduced
          card set:
            - Top row: 3-col (Allergies / Problem List / Medications)
            - Middle: full-width Prescriptions + Care Team
            - Bottom: 2-col (Demographics + Appointments / Labs + Health Concerns
              / Vitals + Immunizations)
          All sections collapse to a single column below md (~768px) so the
          dashboard stays readable when the CUI rail is open or on mobile.
        */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <AllergiesCard patientId={id} />
          <ProblemListCard patientId={id} />
          <MedicationsCard patientId={id} />
        </section>

        <PrescriptionsCard patientId={id} />
        <CareTeamCard patientId={id} />

        <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <DemographicsCard patientId={id} />
          <AppointmentsCard patientId={id} />
          <LabsCard patientId={id} />
          <HealthConcernsCard patientId={id} />
          <VitalsCard patientId={id} />
          <ImmunizationsCard patientId={id} />
        </section>
      </main>
    </div>
  )
}
