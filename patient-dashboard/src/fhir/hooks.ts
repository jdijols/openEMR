import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { z } from 'zod'
import { useAccessToken } from '../auth/AuthProvider'
import { fhirGet, FhirRequestError, type FhirGetParams } from './client'

export function useFhirQuery<T>(
  path: string,
  params: FhirGetParams | undefined,
  schema: z.ZodType<T>,
): UseQueryResult<T, FhirRequestError> {
  const accessToken = useAccessToken()
  return useQuery<T, FhirRequestError>({
    queryKey: ['fhir', path, params ?? {}],
    queryFn: () => {
      if (!accessToken) {
        throw new FhirRequestError({
          kind: 'unauthorized',
          correlationId:
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : Math.random().toString(36).slice(2),
        })
      }
      return fhirGet(path, params, schema, accessToken)
    },
    enabled: !!accessToken,
    retry: (failureCount, error) => {
      if (error.detail.kind === 'unauthorized') return false
      return failureCount < 1
    },
  })
}
