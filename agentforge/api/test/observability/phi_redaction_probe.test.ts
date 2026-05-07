/**
 * G2-Final-FB-A-06 — `runPhiRedactionProbe` coverage.
 *
 * The probe runs the live redactor; we only need to assert that the
 * canonical fixture round-trips clean, every pattern is caught, and the
 * redacted_sample contains [REDACTED] markers (not the original PHI).
 */
import { describe, expect, it } from 'vitest';
import { runPhiRedactionProbe } from '../../src/observability/phi_redaction_probe.js';

describe('runPhiRedactionProbe (FB-A-06)', () => {
  it('catches every PHI pattern in the canonical fixture', () => {
    const out = runPhiRedactionProbe();
    expect(out.ok).toBe(true);
    expect(out.all_caught).toBe(true);
    expect(out.patterns_missed).toEqual([]);
    expect(out.patterns_caught).toEqual(out.patterns_tested);
  });

  it('returns side-by-side samples that prove redaction occurred', () => {
    const out = runPhiRedactionProbe();
    expect(out.input_sample).toContain('555-12-3456');
    expect(out.redacted_sample).not.toContain('555-12-3456');
    expect(out.redacted_sample).not.toContain('1980-01-15');
    expect(out.redacted_sample).not.toContain('JOHN DOE');
    expect(out.redacted_sample).not.toContain('john.doe@example.com');
    expect(out.redacted_sample).toContain('[REDACTED]');
  });

  it('exposes the full pattern catalog (6 patterns)', () => {
    const out = runPhiRedactionProbe();
    expect(out.patterns_tested).toHaveLength(6);
    expect(new Set(out.patterns_tested)).toEqual(
      new Set(['ssn', 'dob_iso', 'phone_us', 'email', 'mrn_label', 'person_name']),
    );
  });
});
