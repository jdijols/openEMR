import { describe, it, expect } from 'vitest'
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce'

describe('PKCE helpers', () => {
  it('produces a verifier within RFC 7636 length bounds (43-128 chars)', () => {
    const v = generateCodeVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v.length).toBeLessThanOrEqual(128)
  })

  it('produces a verifier using only URL-safe base64 chars', () => {
    const v = generateCodeVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces unique verifiers across calls', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })

  it('produces the RFC 7636 reference challenge for the reference verifier', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generates a CSRF state token using URL-safe base64', () => {
    const s = generateState()
    expect(s.length).toBeGreaterThan(0)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
