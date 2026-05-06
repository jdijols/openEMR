/**
 * §11 / G2-Early-31..33 — boolean rubric runners (`schema_valid`,
 * `citation_present`, `no_phi_in_logs`).
 */

import { describe, it, expect } from 'vitest';
import { schemaValid, citationPresent, noPhiInLogs } from '../../eval/runner.js';

// Reusable §6 citation builder so test fixtures stay narrow and the test
// reads as the rule it asserts (citation present + valid).
function makeCitation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source_type: 'lab_pdf',
    source_id: 'docref-1',
    page_or_section: 'page 1',
    field_or_chunk_id: 'results[0]',
    quote_or_value: 'LDL Cholesterol 158 mg/dL',
    ...overrides,
  };
}

function makeValidLabExtraction() {
  return {
    document_type: 'lab_pdf',
    patient_uuid: '11111111-1111-1111-1111-111111111111',
    source_document_id: 'docref-1',
    ordering_provider: 'Dr. Lee',
    performing_lab: 'LabCorp',
    results: [
      {
        test_name: 'LDL',
        loinc: null,
        value: 158,
        unit: 'mg/dL',
        reference_range_low: null,
        reference_range_high: 100,
        reference_range_text: '<100',
        collection_date: '2026-04-30',
        abnormal_flag: 'high',
        citation: makeCitation(),
      },
    ],
    extraction_metadata: {
      pages_processed: 1,
      overall_confidence: 'high',
      fields_uncertain: [],
    },
  };
}

function makeValidIntakeExtraction() {
  return {
    document_type: 'intake_form',
    patient_uuid: '22222222-2222-2222-2222-222222222222',
    source_document_id: 'docref-2',
    demographics: {
      name: null,
      dob: null,
      sex: null,
      contact_phone: null,
      citation: makeCitation({ source_type: 'intake_form', source_id: 'docref-2', field_or_chunk_id: 'demographics', quote_or_value: 'header' }),
    },
    chief_concern: {
      text: 'follow-up visit',
      onset: null,
      citation: makeCitation({ source_type: 'intake_form', source_id: 'docref-2', field_or_chunk_id: 'chief_concern.text', quote_or_value: 'follow-up' }),
    },
    current_medications: [],
    allergies: [],
    family_history: [],
    extraction_metadata: {
      pages_processed: 1,
      overall_confidence: 'high',
      fields_uncertain: [],
      fields_unsupported: [],
    },
  };
}

describe('§11 G2-Early-31 — schema_valid', () => {
  it('passes a §6-valid lab_pdf extraction', () => {
    const r = schemaValid({ schema: 'lab_pdf', extraction: makeValidLabExtraction() });
    expect(r.pass).toBe(true);
  });

  it('rejects a lab_pdf extraction missing required test_name', () => {
    const ex = makeValidLabExtraction();
    delete (ex.results[0] as { test_name?: unknown }).test_name;
    const r = schemaValid({ schema: 'lab_pdf', extraction: ex });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/lab_pdf rejected/);
  });

  it('passes a §6-valid intake_form extraction', () => {
    const r = schemaValid({ schema: 'intake_form', extraction: makeValidIntakeExtraction() });
    expect(r.pass).toBe(true);
  });

  it('rejects an intake_form extraction with empty quote_or_value in citation', () => {
    const ex = makeValidIntakeExtraction();
    ex.demographics.citation.quote_or_value = '';
    const r = schemaValid({ schema: 'intake_form', extraction: ex });
    expect(r.pass).toBe(false);
  });

  it('rejects an unknown schema name', () => {
    const r = schemaValid({ schema: 'mystery_form', extraction: {} });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/unknown schema/);
  });
});

describe('§11 G2-Early-32 — citation_present', () => {
  const goodCitation = {
    source_type: 'lab_pdf' as const,
    source_id: 'docref-1',
    page_or_section: 'page 1',
    field_or_chunk_id: 'results[0]',
    quote_or_value: 'LDL 158',
  };

  it('passes when every claim has a §6-shaped citation', () => {
    const claims = [
      { text: 'LDL is 158 mg/dL', citation: goodCitation },
      { text: 'TG is 178 mg/dL', citation: { ...goodCitation, field_or_chunk_id: 'results[1]', quote_or_value: 'TG 178' } },
    ];
    expect(citationPresent({ claims }).pass).toBe(true);
  });

  it('fails when a claim is missing its citation', () => {
    const claims = [{ text: 'LDL is 158 mg/dL' /* no citation */ }];
    const r = citationPresent({ claims });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/citation missing/);
  });

  it('fails when a claim has a malformed citation (missing source_type)', () => {
    const claims = [{ text: 'LDL is 158', citation: { ...goodCitation, source_type: undefined } }];
    const r = citationPresent({ claims });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/invalid/);
  });

  it('fails when claims is empty', () => {
    const r = citationPresent({ claims: [] });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/no claims/);
  });
});

describe('§11 G2-Early-33 — no_phi_in_logs', () => {
  it('passes a clean trace text', () => {
    const text =
      'tool_name=evidence_retrieve query_chars=84 chunks_returned=5 cost_usd=0.012';
    expect(noPhiInLogs({ trace_text: text }).pass).toBe(true);
  });

  it('fails when trace contains an SSN-like pattern', () => {
    const text = 'audit row included ssn 123-45-6789 by mistake';
    const r = noPhiInLogs({ trace_text: text });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/ssn/);
  });

  it('fails when trace contains an MRN-like pattern', () => {
    const text = 'patient lookup MRN: 04492 returned 1 row';
    const r = noPhiInLogs({ trace_text: text });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/mrn/);
  });

  it('fails when trace contains a cohort patient full name', () => {
    const text = 'extracted facts for Margaret Chen written to chart';
    const r = noPhiInLogs({ trace_text: text });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/cohort_full_name/);
  });

  it('fails when trace contains a DOB pattern', () => {
    const text = 'birthdate=1967-08-14 surfaced in retrieval span';
    const r = noPhiInLogs({ trace_text: text });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/dob/);
  });
});
