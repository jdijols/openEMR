import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { fhirGet, FhirRequestError } from './client'

const PatientLite = z.object({ resourceType: z.literal('Patient'), id: z.string() })

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('fhirGet', () => {
  it('builds the URL with query params and returns the parsed body', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toContain('/Patient/abc')
      expect(String(url)).toContain('foo=bar')
      return jsonResponse({ resourceType: 'Patient', id: 'abc' })
    })
    const res = await fhirGet('/Patient/abc', { foo: 'bar' }, PatientLite, 'tok', fetchMock as unknown as typeof fetch)
    expect(res.id).toBe('abc')
  })

  it('attaches Bearer auth header', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('Authorization')).toBe('Bearer my-tok')
      return jsonResponse({ resourceType: 'Patient', id: 'p' })
    })
    await fhirGet('/Patient/p', undefined, PatientLite, 'my-tok', fetchMock as unknown as typeof fetch)
  })

  it('throws unauthorized on 401', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }))
    await expect(
      fhirGet('/Patient/x', undefined, PatientLite, 't', fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ detail: { kind: 'unauthorized' } })
  })

  it('throws http error on non-ok non-401', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }))
    try {
      await fhirGet('/Patient/x', undefined, PatientLite, 't', fetchMock as unknown as typeof fetch)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(FhirRequestError)
      if (e instanceof FhirRequestError) {
        expect(e.detail.kind).toBe('http')
        if (e.detail.kind === 'http') expect(e.detail.status).toBe(500)
      }
    }
  })

  it('throws parse error on schema mismatch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ wrong: 'shape' }))
    await expect(
      fhirGet('/Patient/x', undefined, PatientLite, 't', fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ detail: { kind: 'parse' } })
  })

  it('throws network error when fetch rejects', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused')
    })
    await expect(
      fhirGet('/Patient/x', undefined, PatientLite, 't', fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({ detail: { kind: 'network', message: 'connection refused' } })
  })

  it('attaches a correlation id to every error', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }))
    try {
      await fhirGet('/x', undefined, PatientLite, 't', fetchMock as unknown as typeof fetch)
    } catch (e) {
      if (e instanceof FhirRequestError) {
        expect(typeof e.detail.correlationId).toBe('string')
        expect(e.detail.correlationId.length).toBeGreaterThan(0)
      }
    }
  })
})
