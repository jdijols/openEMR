import { describe, expect, it } from 'vitest';
import {
  IntakeFormSchema,
  LabPdfExtractionSchema,
  LabResultSchema,
  SourceCitationSchema,
  type LabPdfExtraction,
} from '../../src/schemas/extraction.js';

/**
 * §6 / G2-MVP-11 — schema validation tests required by the W2 brief.
 *
 * The five scenarios below match `W2_ARCHITECTURE.md` §6 "Validation tests"
 * verbatim and gate the `schema_valid` rubric category in the eval suite
 * (S8 stop-the-line invariant boundary). If any of these regress, the
 * citation contract is broken and the eval gate must fail.
 */

const validCitation = {
  source_type: 'lab_pdf' as const,
  source_id: '11111111-1111-1111-1111-111111111111',
  page_or_section: 'page:1',
  field_or_chunk_id: 'lipid_panel_table.row_3.col_value',
  quote_or_value: '158',
  bbox: [0.12, 0.34, 0.56, 0.78] as [number, number, number, number],
  confidence: 0.95,
};

const validLabResult = {
  test_name: 'LDL Cholesterol, Calculated',
  loinc: '13457-7',
  value: 158 as number | string,
  unit: 'mg/dL',
  reference_range_low: null,
  reference_range_high: 100,
  reference_range_text: 'Optimal <100',
  collection_date: '2026-04-22',
  abnormal_flag: 'high' as const,
  citation: validCitation,
};

const validLabExtraction: LabPdfExtraction = {
  document_type: 'lab_pdf',
  patient_uuid: '00000000-0000-0000-0000-000000000001',
  source_document_id: 'docref-uuid-001',
  ordering_provider: 'RAO, ANJALI MD',
  performing_lab: 'Pacific Diagnostics Lab',
  results: [validLabResult],
  extraction_metadata: {
    pages_processed: 1,
    overall_confidence: 'high',
    fields_uncertain: [],
  },
};

describe('§6 extraction schema validation', () => {
  it('1. Round-trip: valid LabPdfExtraction parses and re-serializes identically', () => {
    const parsed = LabPdfExtractionSchema.parse(validLabExtraction);
    expect(parsed).toEqual(validLabExtraction);
    // JSON round-trip — proves the parsed shape is fully serializable without drift.
    const reSerialized = JSON.parse(JSON.stringify(parsed));
    expect(reSerialized).toEqual(JSON.parse(JSON.stringify(validLabExtraction)));
  });

  it('2. Missing citation: a LabResult without `citation` fails parsing', () => {
    const { citation: _omit, ...resultWithoutCitation } = validLabResult;
    const result = LabResultSchema.safeParse(resultWithoutCitation);
    expect(result.success).toBe(false);
  });

  it('3. Empty quote_or_value: citation with empty `quote_or_value` fails parsing', () => {
    const bad = { ...validCitation, quote_or_value: '' };
    const result = SourceCitationSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('4. Source-type enum violation: `source_type` outside the enum fails parsing', () => {
    const bad = { ...validCitation, source_type: 'wikipedia' };
    const result = SourceCitationSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('5. Bbox arity: bbox tuple of wrong arity fails parsing', () => {
    const bad = { ...validCitation, bbox: [0.1, 0.2, 0.3] };
    const result = SourceCitationSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe('§6 IntakeFormSchema (smoke)', () => {
  it('round-trips a minimal valid intake form', () => {
    const intakeCitation = {
      ...validCitation,
      source_type: 'intake_form' as const,
      field_or_chunk_id: 'demographics.legal_name',
      quote_or_value: 'Chen, Margaret L.',
    };
    const validIntake = {
      document_type: 'intake_form' as const,
      patient_uuid: '00000000-0000-0000-0000-000000000001',
      source_document_id: 'docref-uuid-002',
      demographics: {
        name: 'Chen, Margaret L.',
        dob: '1967-08-14',
        sex: 'female' as const,
        contact_phone: '(510) 555-0148',
        citation: intakeCitation,
      },
      chief_concern: {
        text: 'Tired during the day, mild chest tightness when walking uphill.',
        onset: '~3 weeks',
        citation: { ...intakeCitation, field_or_chunk_id: 'chief_concern.text', quote_or_value: 'Tired during the day' },
      },
      current_medications: [],
      allergies: [],
      family_history: [],
      extraction_metadata: {
        pages_processed: 1,
        overall_confidence: 'high' as const,
        fields_uncertain: [],
        fields_unsupported: [],
      },
    };
    const parsed = IntakeFormSchema.parse(validIntake);
    expect(parsed).toEqual(validIntake);
  });
});
