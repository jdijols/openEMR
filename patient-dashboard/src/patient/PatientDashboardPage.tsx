import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
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
import { subscribe as subscribeProposalEvents } from '../proposals/proposalBus'

export function PatientDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const credential = useFhirCredential()
  const queryClient = useQueryClient()

  /**
   * G2-Final — subscribe to `chart:updated` broadcasts from the CUI iframe.
   * Whenever the agent (or the physician via the CUI's confirm action)
   * lands a write through the legacy /conversations/:id/confirm path or
   * the new /proposals/:id/confirm path, the CUI emits this event so the
   * dashboard knows to invalidate its FHIR react-query cache and refetch.
   *
   * Without this, intake-form rows write to OpenEMR successfully but the
   * dashboard cards keep showing the pre-write state because react-query
   * has no way to know data changed underneath.
   *
   * `patient_uuid` is on the event so we can scope-check, but for tonight
   * we invalidate anything under the 'fhir' key — same patient or not, a
   * stale cache for the wrong patient costs us a single re-fetch.
   */
  useEffect(() => {
    return subscribeProposalEvents((event) => {
      if (event.type === 'chart:updated') {
        void queryClient.invalidateQueries({ queryKey: ['fhir'] })
      }
    })
  }, [queryClient])

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
            - Top row: 3-col (Allergies / Medical Problems / Medications)
            - Middle: full-width Prescriptions + Care Team
            - Bottom: 2-col (Demographics + Appointments / Labs + Health Concerns
              / Vitals + Immunizations)
          All sections collapse to a single column below md (~768px) so the
          dashboard stays readable when the CUI rail is open or on mobile.
        */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
          <AllergiesCard patientId={id} />
          <ProblemListCard patientId={id} />
          <MedicationsCard patientId={id} />
        </section>

        <PrescriptionsCard patientId={id} />
        <CareTeamCard patientId={id} />

        {/*
          Two independent vertical columns (not a 3×2 grid): each column is a
          flex stack, so a short card sits directly under its column-mate
          rather than being padded out to match a tall card in the other
          column. Mirrors the legacy dashboard's column-flow layout.
        */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
          <div className="flex flex-col gap-5">
            <DemographicsCard patientId={id} />
            <LabsCard patientId={id} />
            <VitalsCard patientId={id} />
          </div>
          <div className="flex flex-col gap-5">
            <AppointmentsCard patientId={id} />
            <HealthConcernsCard patientId={id} />
            <ImmunizationsCard patientId={id} />
          </div>
        </section>
      </main>
    </div>
  )
}
