/**
 * Coverage matrix for the PHI redactor (`observability/redact.ts`).
 *
 * The redactor sits between every observability call and the Langfuse client.
 * Over-redaction is intentional — the deny-list errs toward false positives
 * to keep traces PHI-free, trading some debugging fidelity for an enforceable
 * safety property (OBSERVABILITY.md §"PHI redactor — Deliberate over-redaction").
 *
 * This test is the regression gate for the redactor's coverage. It asserts:
 *
 *   1. Strings that must be redacted (HIPAA Safe Harbor categories: SSN, DOB,
 *      phone, email, MRN, street address, bearer tokens, person names).
 *   2. Strings that must SURVIVE redaction (clinical vocabulary, UUIDs, model
 *      names, correlation ids, plain numbers) — these carry no patient identity
 *      and over-redacting them costs debugging fidelity for no safety gain.
 *   3. Object key hints that mask the entire value regardless of shape.
 *   4. The two deliberate over-redaction cases (ALL-CAPS pairs catching both
 *      person names and section headings).
 *
 * If a row here flips outcome, either the redactor changed (intentional —
 * update OBSERVABILITY.md AND this matrix) or the redactor regressed
 * (unintentional — fix the redactor).
 */

import { describe, expect, it } from 'vitest';
import { redactPhi, redactString } from '../../src/observability/redact.js';

const REDACTED = '[REDACTED]';

describe('PHI patterns that MUST be redacted', () => {
  describe('Dates of birth (multiple formats)', () => {
    const cases = [
      { label: 'ISO YYYY-MM-DD', input: 'DOB 1980-04-15 noted', expected: 'DOB [REDACTED] noted' },
      { label: 'US M/D/YYYY', input: 'born 4/15/1980', expected: 'born [REDACTED]' },
      { label: 'US MM/DD/YY', input: 'visit 04/15/80', expected: 'visit [REDACTED]' },
      { label: 'dash M-D-YYYY', input: 'recorded 4-15-1980', expected: 'recorded [REDACTED]' },
    ];
    for (const c of cases) {
      it(c.label, () => {
        expect(redactString(c.input)).toBe(c.expected);
      });
    }
  });

  describe('Phone numbers (multiple formats)', () => {
    const cases = [
      { label: 'parens + dash', input: 'call (555) 123-4567 today', expected: 'call [REDACTED] today' },
      { label: 'dotted', input: 'cell 555.123.4567', expected: 'cell [REDACTED]' },
      { label: 'dashed', input: 'work 555-123-4567', expected: 'work [REDACTED]' },
      { label: '+country', input: 'intl +1 555 123 4567 line', expected: 'intl [REDACTED] line' },
    ];
    for (const c of cases) {
      it(c.label, () => {
        expect(redactString(c.input)).toBe(c.expected);
      });
    }
  });

  it('SSN', () => {
    expect(redactString('SSN 123-45-6789')).toBe('SSN [REDACTED]');
  });

  it('email address', () => {
    expect(redactString('contact jane.doe@example.com please')).toBe('contact [REDACTED] please');
  });

  describe('Street addresses', () => {
    const cases = [
      '123 Main Street',
      '456 Oak Avenue',
      '789 Pine Boulevard',
      '12 Elm Court',
    ];
    for (const text of cases) {
      it(`redacts: "${text}"`, () => {
        expect(redactString(text)).toBe(REDACTED);
      });
    }
  });

  describe('MRN-like identifiers', () => {
    const cases = ['MRN:12345', 'Patient ID 9876', 'pid=42', 'chart_id 9999'];
    for (const text of cases) {
      it(`redacts: "${text}"`, () => {
        expect(redactString(text)).toBe(REDACTED);
      });
    }
  });

  describe('URL token params', () => {
    const cases = [
      'launch_code=abc123def456',
      'session_token=xyz98765abcdefg',
      'access_token=eyJhbGciOiJIUzI1NiJ9',
      'api_key=sk-proj-deadbeef12345',
    ];
    for (const text of cases) {
      it(`redacts: "${text}"`, () => {
        expect(redactString(text)).toBe(REDACTED);
      });
    }
  });

  it('Bearer tokens (long base64-like values)', () => {
    expect(redactString('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe(
      'Authorization: Bearer [REDACTED]',
    );
  });

  describe('ALL-CAPS name pairs', () => {
    const cases = ['JOHN DOE', 'MARY SMITH', 'ROBERT JONES'];
    for (const text of cases) {
      it(`redacts: "${text}"`, () => {
        expect(redactString(text)).toBe(REDACTED);
      });
    }
  });

  describe('Person-name labels (label preserved, value replaced)', () => {
    it('redacts the value but keeps the label', () => {
      expect(redactString('first_name: Jane')).toBe('first_name: [REDACTED]');
    });
    it('redacts patient_name', () => {
      expect(redactString('patient_name = Bob Smith')).toBe('patient_name = [REDACTED]');
    });
  });
});

describe('Strings that MUST SURVIVE redaction (no patient identity)', () => {
  describe('Clinical vocabulary', () => {
    // Drug names, condition names, vital values, lab abbreviations — none are
    // identifiers under HIPAA Safe Harbor and over-redacting them costs
    // debugging fidelity for no safety gain.
    const cases = [
      'lisinopril 10mg daily',
      'patient has hypertension and type 2 diabetes',
      'BP 120/80 mmHg',
      'A1c 7.2 percent',
      'temperature 98.6 F',
      'chief complaint: sore throat',
    ];
    for (const text of cases) {
      it(`survives: "${text}"`, () => {
        expect(redactString(text)).toBe(text);
      });
    }
  });

  describe('Internal identifiers (UUIDs, model names, correlation ids)', () => {
    // Source-pack UUIDs are needed for citation linkage; model names and
    // correlation ids are non-patient-identifying and useful for debugging.
    const cases = [
      'source_pack uuid 11111111-1111-1111-1111-111111111111',
      'model claude-haiku-4-5 invoked',
      'correlation_id 8a7c3f9d-1234-5678-9abc-def012345678',
    ];
    for (const text of cases) {
      it(`survives: "${text}"`, () => {
        expect(redactString(text)).toBe(text);
      });
    }
  });

  describe('Plain numbers and short strings', () => {
    const cases = [
      'count 5',
      '13 cases passed',
      'rows: 42',
      'status: ok',
    ];
    for (const text of cases) {
      it(`survives: "${text}"`, () => {
        expect(redactString(text)).toBe(text);
      });
    }
  });
});

describe('Deliberate over-redaction (documented trade-off)', () => {
  // OBSERVABILITY.md §"PHI redactor — Deliberate over-redaction" calls out that
  // the ALL-CAPS pair pattern catches both person names AND clinical section
  // headings. The trade-off is intentional. If these flip to "survives," the
  // safety property has weakened — update the doc before the test.
  const overRedacted = ['ACTIVE PROBLEMS', 'FAMILY HISTORY', 'CHIEF COMPLAINT'];
  for (const text of overRedacted) {
    it(`over-redacts (by design): "${text}"`, () => {
      expect(redactString(text)).toBe(REDACTED);
    });
  }
});

describe('Object recursion + key hints', () => {
  it('masks the entire value when a property name matches a PHI hint', () => {
    const out = redactPhi({
      patient_name: 'Jane Doe',
      dob: '1980-04-15',
      ssn: '123-45-6789',
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '(555) 123-4567',
      mrn: '99887766',
    }) as Record<string, unknown>;

    expect(out['patient_name']).toBe(REDACTED);
    expect(out['dob']).toBe(REDACTED);
    expect(out['ssn']).toBe(REDACTED);
    expect(out['first_name']).toBe(REDACTED);
    expect(out['last_name']).toBe(REDACTED);
    expect(out['phone']).toBe(REDACTED);
    expect(out['mrn']).toBe(REDACTED);
  });

  it('preserves non-PHI keys through recursion', () => {
    const out = redactPhi({
      tool_name: 'get_allergies',
      row_count: 2,
      status: 'ok',
      nested: { provider_model: 'claude-haiku-4-5', input_tokens: 1024 },
    }) as Record<string, unknown>;

    expect(out['tool_name']).toBe('get_allergies');
    expect(out['row_count']).toBe(2);
    expect(out['status']).toBe('ok');
    expect((out['nested'] as Record<string, unknown>)['provider_model']).toBe('claude-haiku-4-5');
    expect((out['nested'] as Record<string, unknown>)['input_tokens']).toBe(1024);
  });

  it('redacts strings inside arrays element-wise', () => {
    const out = redactPhi(['patient: 1980-04-15', 'lisinopril 10mg', 'SSN 123-45-6789']) as string[];
    expect(out[0]).toBe('patient: [REDACTED]');
    expect(out[1]).toBe('lisinopril 10mg');
    expect(out[2]).toBe('SSN [REDACTED]');
  });

  it('coerces and redacts non-plain-object types (Error, Map)', () => {
    const out = redactPhi(new Error('failed for SSN 123-45-6789'));
    expect(typeof out).toBe('string');
    expect(out as string).toContain('[REDACTED]');
    expect(out as string).not.toContain('123-45-6789');
  });

  it('preserves null, undefined, numbers, booleans unchanged', () => {
    expect(redactPhi(null)).toBe(null);
    expect(redactPhi(undefined)).toBe(undefined);
    expect(redactPhi(42)).toBe(42);
    expect(redactPhi(true)).toBe(true);
    expect(redactPhi(false)).toBe(false);
  });
});
