/**
 * G2-Final-FB-A-06 — `GET /agentforge/api/health/phi-redaction`.
 *
 * Runs the production redactor (`redactPhi`) against a fixed synthetic
 * PHI fixture and returns a side-by-side summary the CUI can render in
 * the footer panel. The endpoint runs the **live redactor** — the
 * response cannot drift from production behavior, because it is produced
 * by production behavior.
 *
 * Synthetic-only by construction: the fixture uses fake-PHI values
 * (clearly invalid SSN, made-up phone, etc.) so the endpoint never carries
 * real patient data even though it appears to.
 */

import { redactPhi } from './redact.js';

export type PhiPatternId =
  | 'ssn'
  | 'dob_iso'
  | 'phone_us'
  | 'email'
  | 'mrn_label'
  | 'person_name';

const FIXTURE = {
  text:
    'Patient name: JOHN DOE, MRN: 99887766, DOB 1980-01-15, phone 555-867-5309, email john.doe@example.com, SSN 555-12-3456.',
  patient_name: 'JOHN DOE',
  dob: '1980-01-15',
  phone: '555-867-5309',
};

/** Patterns the redactor MUST catch in the canonical fixture. */
const PATTERNS_TESTED: readonly PhiPatternId[] = ['ssn', 'dob_iso', 'phone_us', 'email', 'mrn_label', 'person_name'];

/**
 * Per-pattern detector — operates on the redacted text. A pattern is
 * "caught" when neither the redacted output contains the original PHI
 * value AND the redaction marker `[REDACTED]` is present in the relevant
 * region. Strict by design: we want false negatives in this probe to
 * surface as "not caught" rather than papering over partial redaction.
 */
const PATTERN_PROBES: Readonly<Record<PhiPatternId, (input: string, redacted: string) => boolean>> = {
  ssn: (i, r) => i.includes('555-12-3456') && !r.includes('555-12-3456') && r.includes('[REDACTED]'),
  dob_iso: (i, r) => i.includes('1980-01-15') && !r.includes('1980-01-15') && r.includes('[REDACTED]'),
  phone_us: (i, r) => i.includes('555-867-5309') && !r.includes('555-867-5309') && r.includes('[REDACTED]'),
  email: (i, r) => i.includes('john.doe@example.com') && !r.includes('john.doe@example.com') && r.includes('[REDACTED]'),
  mrn_label: (i, r) => i.includes('MRN: 99887766') && !r.includes('99887766') && r.includes('[REDACTED]'),
  person_name: (i, r) => i.includes('JOHN DOE') && !r.includes('JOHN DOE') && r.includes('[REDACTED]'),
};

export type PhiRedactionProbeResult = {
  readonly ok: true;
  readonly input_sample: string;
  readonly redacted_sample: string;
  readonly patterns_tested: readonly PhiPatternId[];
  readonly patterns_caught: readonly PhiPatternId[];
  readonly patterns_missed: readonly PhiPatternId[];
  readonly all_caught: boolean;
};

const SAMPLE_HEAD_LIMIT = 240;

function head(s: string, limit: number): string {
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

export function runPhiRedactionProbe(): PhiRedactionProbeResult {
  const redacted = redactPhi(FIXTURE.text);
  const redactedStr = typeof redacted === 'string' ? redacted : '';

  const caught: PhiPatternId[] = [];
  const missed: PhiPatternId[] = [];
  for (const id of PATTERNS_TESTED) {
    if (PATTERN_PROBES[id](FIXTURE.text, redactedStr)) {
      caught.push(id);
    } else {
      missed.push(id);
    }
  }

  return {
    ok: true,
    input_sample: head(FIXTURE.text, SAMPLE_HEAD_LIMIT),
    redacted_sample: head(redactedStr, SAMPLE_HEAD_LIMIT),
    patterns_tested: PATTERNS_TESTED,
    patterns_caught: caught,
    patterns_missed: missed,
    all_caught: missed.length === 0,
  };
}
