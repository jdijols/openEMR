import type { z } from 'zod'

export type FhirErrorDetail =
  | { kind: 'unauthorized'; correlationId: string }
  | { kind: 'http'; status: number; correlationId: string }
  | { kind: 'parse'; message: string; correlationId: string }
  | { kind: 'network'; message: string; correlationId: string }

export class FhirRequestError extends Error {
  readonly detail: FhirErrorDetail

  constructor(detail: FhirErrorDetail) {
    super(`FHIR ${detail.kind} (cid:${detail.correlationId})`)
    this.name = 'FhirRequestError'
    this.detail = detail
  }
}

// Relative path so dev goes through Vite's `/apis` proxy (configured in vite.config.ts)
// and prod is same-origin with OpenEMR. Avoids the cross-origin CORS issue that
// OpenEMR's FHIR endpoints don't accommodate by default.
export const FHIR_BASE = '/apis/default/fhir'

export type FhirGetParams = Record<string, string | number | undefined>

function buildUrl(path: string, params: FhirGetParams | undefined): string {
  let url = `${FHIR_BASE}${path}`
  if (params) {
    const search = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) {
        search.set(k, String(v))
      }
    }
    const qs = search.toString()
    if (qs) url += `?${qs}`
  }
  return url
}

export async function fhirGet<T>(
  path: string,
  params: FhirGetParams | undefined,
  schema: z.ZodType<T>,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const correlationId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)

  let resp: Response
  try {
    resp = await fetchImpl(buildUrl(path, params), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })
  } catch (e) {
    throw new FhirRequestError({
      kind: 'network',
      message: e instanceof Error ? e.message : 'Network error',
      correlationId,
    })
  }

  if (resp.status === 401) {
    throw new FhirRequestError({ kind: 'unauthorized', correlationId })
  }

  if (!resp.ok) {
    throw new FhirRequestError({
      kind: 'http',
      status: resp.status,
      correlationId,
    })
  }

  let json: unknown
  try {
    json = await resp.json()
  } catch {
    throw new FhirRequestError({
      kind: 'parse',
      message: 'Response was not valid JSON',
      correlationId,
    })
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new FhirRequestError({
      kind: 'parse',
      message: parsed.error.message,
      correlationId,
    })
  }
  return parsed.data
}
