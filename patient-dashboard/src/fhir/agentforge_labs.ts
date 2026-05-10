/**
 * QA-pass shortcut — fetch lab observations from the agentforge JSON sidecar
 * store via the PHP endpoint at
 * `/interface/modules/custom_modules/oe-module-agentforge/public/context/lab_observations_for_dashboard.php`.
 *
 * The W2 MVP deferred writing FHIR Observation rows ("Thursday upgrade")
 * and lab data lives on disk as JSON sidecars. The PHP endpoint reads
 * those sidecars + reshapes into FHIR Observation Bundle. This hook
 * surfaces them in the dashboard's LabsCard until proper Observation
 * persistence lands.
 *
 * Authenticated via the agentforge session token (same one
 * proposalsApi uses), POSTed to a same-origin path. The dashboard SPA
 * runs from `<host>/dashboard/...` so the relative URL hits OpenEMR.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { readAgentforgeSession } from '../proposals/session'
import { FhirBundleSchema, FhirObservationSchema, type FhirObservation } from './schemas'
import { z } from 'zod'

const Schema = FhirBundleSchema(FhirObservationSchema)

const ENDPOINT_PATH =
  '/interface/modules/custom_modules/oe-module-agentforge/public/context/lab_observations_for_dashboard.php'

export class AgentForgeLabsError extends Error {
  readonly correlationId: string
  constructor(message: string, correlationId: string) {
    super(message)
    this.name = 'AgentForgeLabsError'
    this.correlationId = correlationId
  }
}

export type AgentForgeLabsResult = z.infer<typeof Schema>

export function useAgentForgeLabs(
  patientUuid: string,
): UseQueryResult<AgentForgeLabsResult, AgentForgeLabsError> {
  return useQuery<AgentForgeLabsResult, AgentForgeLabsError>({
    queryKey: ['agentforge-labs', patientUuid],
    queryFn: async () => {
      const session = readAgentforgeSession()
      const correlationId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      if (!session) {
        throw new AgentForgeLabsError('agentforge_session_missing', correlationId)
      }
      const resp = await fetch(ENDPOINT_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify({
          session_token: session.sessionToken,
          patient_uuid: patientUuid,
        }),
      })
      if (!resp.ok) {
        throw new AgentForgeLabsError(`http_${resp.status}`, correlationId)
      }
      const json = await resp.json()
      const parsed = Schema.safeParse(json)
      if (!parsed.success) {
        throw new AgentForgeLabsError('schema_invalid', correlationId)
      }
      return parsed.data
    },
    // The sidecar store is small; refresh on every chart:updated invalidate.
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

export type { FhirObservation }
