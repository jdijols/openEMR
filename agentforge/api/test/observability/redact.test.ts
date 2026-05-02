/**
 * G6-08 (PRD §5.10, §8.7, §11.3, S7) — synthetic PHI is never observable in trace bodies.
 *
 * The redactor is the contract that lets us turn Langfuse on in Gate 6 without
 * leaking patient identifiers. These tests are the canonical safety property —
 * if any of them fail, S7 fails and the gate cannot ship.
 */

import { describe, expect, it } from 'vitest';
import { redactPhi, redactString } from '../../src/observability/redact.js';

describe('redactString — deny-list patterns', () => {
  it('redacts ISO and US dates of birth', () => {
    expect(redactString('DOB 1980-01-01 noted')).toBe('DOB [REDACTED] noted');
    expect(redactString('born 01/01/1980')).toBe('born [REDACTED]');
    expect(redactString('dob 1-1-80')).toBe('dob [REDACTED]');
  });

  it('redacts US-formatted phone numbers', () => {
    expect(redactString('call 555-123-4567 anytime')).toBe('call [REDACTED] anytime');
    expect(redactString('call (555) 123-4567')).toBe('call [REDACTED]');
    expect(redactString('+1 555 123 4567')).toBe('[REDACTED]');
  });

  it('redacts SSN', () => {
    expect(redactString('SSN 123-45-6789 on file')).toBe('SSN [REDACTED] on file');
  });

  it('redacts email addresses', () => {
    expect(redactString('contact jane.doe@example.com')).toBe('contact [REDACTED]');
  });

  it('redacts street addresses', () => {
    expect(redactString('lives at 123 Main Street')).toBe('lives at [REDACTED]');
    expect(redactString('456 Oak Avenue, apt 7')).toBe('[REDACTED], apt 7');
  });

  it('redacts MRN-like identifiers', () => {
    expect(redactString('MRN: 4477123 and notes')).toBe('[REDACTED] and notes');
    expect(redactString('Patient ID 9876 today')).toBe('[REDACTED] today');
    expect(redactString('see pid=42 in chart')).toBe('see [REDACTED] in chart');
  });

  it('redacts launch codes and tokens in URL params', () => {
    expect(
      redactString('GET /panel?launch_code=abcdef0123456789abcdef0123456789 HTTP/1.1'),
    ).toBe('GET /panel?[REDACTED] HTTP/1.1');
    expect(redactString('?session_token=eyJhbGci.payload.sig and ok')).toBe(
      '?[REDACTED] and ok',
    );
  });

  it('redacts Bearer tokens but keeps the scheme word', () => {
    expect(redactString('Authorization: Bearer eyJhbGci.payload.sigsigsigsig')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  it('redacts the captured value of a person-name label, not the label itself', () => {
    expect(redactString('Patient name: Jane Doe')).toBe('Patient name: [REDACTED]');
    expect(redactString('first_name = Jane')).toBe('first_name = [REDACTED]');
  });

  it('leaves clinical vocabulary unchanged', () => {
    expect(redactString('lisinopril for hypertension; BP 120/80')).toBe(
      'lisinopril for hypertension; BP 120/80',
    );
  });
});

describe('redactPhi — recursive JSON traversal', () => {
  it('redacts strings nested inside arrays and objects', () => {
    const input = {
      blocks: [
        { type: 'text', text: 'Patient DOB 1980-01-01, MRN: 99887766' },
        { type: 'claim', text: 'Allergic to lisinopril' },
      ],
      metadata: {
        phone: '555-123-4567',
      },
    };

    expect(redactPhi(input)).toEqual({
      blocks: [
        { type: 'text', text: 'Patient DOB [REDACTED], [REDACTED]' },
        { type: 'claim', text: 'Allergic to lisinopril' },
      ],
      metadata: {
        phone: '[REDACTED]',
      },
    });
  });

  it('replaces PHI-named keys outright regardless of value content', () => {
    const input = {
      patient_name: 'Whatever value, even one with no obvious PHI cue',
      dob: '1990-05-04',
      authorization: 'Bearer arbitrarily-short-token',
      session_token: 'eyJhbGci.payload.sig',
      launch_code: 'short',
      api_key: 'sk-anything',
      address: { street: '123 Anywhere', zip: '90210' },
      not_phi: 'lisinopril 10mg daily',
    };

    expect(redactPhi(input)).toEqual({
      patient_name: '[REDACTED]',
      dob: '[REDACTED]',
      authorization: '[REDACTED]',
      session_token: '[REDACTED]',
      launch_code: '[REDACTED]',
      api_key: '[REDACTED]',
      // The hint is on the wrapping `address` key, so the entire object is masked.
      address: '[REDACTED]',
      not_phi: 'lisinopril 10mg daily',
    });
  });

  it('passes through numbers, booleans, null, undefined unchanged', () => {
    expect(redactPhi(42)).toBe(42);
    expect(redactPhi(true)).toBe(true);
    expect(redactPhi(false)).toBe(false);
    expect(redactPhi(null)).toBe(null);
    expect(redactPhi(undefined)).toBe(undefined);
  });

  it('coerces non-plain objects (Error, Map) to a redacted string', () => {
    const e = new Error('Patient Jane Doe DOB 1980-01-01 is missing');
    const out = redactPhi(e);
    expect(typeof out).toBe('string');
    expect(out).not.toContain('1980-01-01');
    expect(out).toContain('[REDACTED]');
  });

  it('S7 invariant — the canonical PRD §11.3 example is fully redacted', () => {
    const traceBody = {
      input: 'JOHN DOE 1980-01-01 lives at 456 Oak Avenue, phone 555-123-4567',
      patient_name: 'JOHN DOE',
      metadata: {
        launch_code: 'abcdef0123456789abcdef0123456789',
        session_token: 'eyJ.X.Y',
      },
    };

    const out = redactPhi(traceBody);
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain('1980-01-01');
    expect(serialized).not.toContain('JOHN DOE');
    expect(serialized).not.toContain('456 Oak Avenue');
    expect(serialized).not.toContain('555-123-4567');
    expect(serialized).not.toContain('abcdef0123456789abcdef0123456789');
    expect(serialized).not.toContain('eyJ.X.Y');
    expect(serialized).toContain('[REDACTED]');
  });
});
