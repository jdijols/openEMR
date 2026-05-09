import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { z } from 'zod'
import { useFhirCredential } from '../auth/AuthProvider'
import { fhirGet, FhirRequestError, type FhirGetParams } from './client'

export function useFhirQuery<T>(
  path: string,
  params: FhirGetParams | undefined,
  schema: z.ZodType<T>,
): UseQueryResult<T, FhirRequestError> {
  const credential = useFhirCredential()
  return useQuery<T, FhirRequestError>({
    queryKey: ['fhir', credential?.mode ?? 'none', path, params ?? {}],
    queryFn: () => {
      if (!credential) {
        throw new FhirRequestError({
          kind: 'unauthorized',
          correlationId:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : Math.random().toString(36).slice(2),
        })
      }
      return fhirGet(path, params, schema, credential)
    },
    enabled: !!credential,
    retry: (failureCount, error) => {
      if (error.detail.kind === 'unauthorized') return false
      return failureCount < 1
    },
  })
}
