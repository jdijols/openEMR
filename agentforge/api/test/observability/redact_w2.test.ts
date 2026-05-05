import { describe, expect, it } from 'vitest';
import { redactPhi } from '../../src/observability/redact.js';

/**
 * §12 / G2-MVP-40 — W2 content-block + extraction-JSON summarization.
 *
 * Three scenarios:
 *  (a) `document` content block bytes → summary; raw base64 disappears.
 *  (b) `image` content block bytes → summary; raw base64 disappears.
 *  (c) Extracted §6 lab_pdf / intake_form JSON → summary; raw fact
 *      values + verbatim quotes disappear from the trace body.
 *  (d) S7 regression: pre-existing redact behavior on non-W2 content
 *      stays intact (PHI-key denylist still wins, MRN strings still
 *      get masked).
 */

describe('§12 G2-MVP-40 — W2 redaction', () => {
  it('(a) document content block bytes are replaced with summary; PHI base64 disappears', () => {
    const phiBase64 = 'JVBERi0xLjQKJcDM4OPLU' + 'A'.repeat(2000); // simulates a PDF body
    const span = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: phiBase64 },
    };
    const out = redactPhi(span) as Record<string, unknown>;
    expect(out['_phi_safe_summary']).toBe(true);
    expect(out['type']).toBe('document');
    expect(out['mime']).toBe('application/pdf');
    expect(typeof out['size_bytes']).toBe('number');
    expect(JSON.stringify(out)).not.toContain(phiBase64);
  });

  it('(b) image content block bytes are replaced with summary', () => {
    const phiBase64 = 'iVBORw0KGgoAAAANSUhEUgAA' + 'B'.repeat(2000);
    const span = {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: phiBase64 },
    };
    const out = redactPhi(span) as Record<string, unknown>;
    expect(out['_phi_safe_summary']).toBe(true);
    expect(out['type']).toBe('image');
    expect(out['mime']).toBe('image/png');
    expect(JSON.stringify(out)).not.toContain(phiBase64);
  });

  it('(c) lab_pdf extraction JSON is replaced with metadata summary', () => {
    const extraction = {
      document_type: 'lab_pdf',
      patient_uuid: '00000000-0000-0000-0000-000000000001',
      source_document_id: 'docref-uuid-aaaa',
      ordering_provider: 'RAO, ANJALI MD',
      performing_lab: 'Pacific Diagnostics Lab',
      results: [
        {
          test_name: 'LDL Cholesterol, Calculated',
          value: 158,
          unit: 'mg/dL',
          collection_date: '2026-04-22',
          abnormal_flag: 'high',
          citation: { source_type: 'lab_pdf', source_id: 'docref-uuid-aaaa', page_or_section: 'page:1', field_or_chunk_id: 'lipid.row3', quote_or_value: 'LDL 158 mg/dL Margaret Chen DOB 1967-08-14' },
        },
        {
          test_name: 'HDL',
          value: 48,
          unit: 'mg/dL',
          collection_date: '2026-04-22',
          abnormal_flag: 'low',
          citation: { source_type: 'lab_pdf', source_id: 'docref-uuid-aaaa', page_or_section: 'page:1', field_or_chunk_id: 'lipid.row2', quote_or_value: 'HDL 48' },
        },
      ],
      extraction_metadata: { pages_processed: 1, overall_confidence: 'high', fields_uncertain: ['Triglyceride lower bound'] },
    };
    const out = redactPhi(extraction) as Record<string, unknown>;
    expect(out['_phi_safe_summary']).toBe(true);
    expect(out['document_type']).toBe('lab_pdf');
    expect(out['n_facts']).toBe(2);
    expect(out['n_uncertain']).toBe(1);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Margaret Chen');
    expect(serialized).not.toContain('1967-08-14');
    expect(serialized).not.toContain('LDL 158 mg/dL');
  });

  it('(c2) intake_form extraction JSON summary counts demographics + chief_concern + meds + allergies + family', () => {
    const extraction = {
      document_type: 'intake_form',
      patient_uuid: '00000000-0000-0000-0000-000000000001',
      source_document_id: 'docref-uuid-bbbb',
      demographics: { name: 'Chen, Margaret L.', dob: '1967-08-14', sex: 'female', contact_phone: '(510) 555-0148', citation: { source_type: 'intake_form', source_id: 'docref-uuid-bbbb', page_or_section: 'demographics', field_or_chunk_id: 'name', quote_or_value: 'Chen, Margaret L.' } },
      chief_concern: { text: 'Tired during the day', onset: '~3 weeks', citation: { source_type: 'intake_form', source_id: 'docref-uuid-bbbb', page_or_section: 'chief', field_or_chunk_id: 'text', quote_or_value: 'Tired during the day' } },
      current_medications: [
        { name: 'Lisinopril', dose: '10 mg', frequency: 'PO daily', citation: { source_type: 'intake_form', source_id: 'docref-uuid-bbbb', page_or_section: 'meds', field_or_chunk_id: 'med0', quote_or_value: 'Lisinopril 10 mg PO daily' } },
        { name: 'Metformin', dose: '500 mg', frequency: 'PO BID', citation: { source_type: 'intake_form', source_id: 'docref-uuid-bbbb', page_or_section: 'meds', field_or_chunk_id: 'med1', quote_or_value: 'Metformin 500 mg' } },
      ],
      allergies: [],
      family_history: [{ relation: 'Mother', condition: 'Type 2 diabetes', citation: { source_type: 'intake_form', source_id: 'docref-uuid-bbbb', page_or_section: 'family', field_or_chunk_id: 'fam0', quote_or_value: 'Mother T2DM' } }],
      extraction_metadata: { pages_processed: 1, overall_confidence: 'high', fields_uncertain: [], fields_unsupported: ['social.tobacco_pack_years'] },
    };
    const out = redactPhi(extraction) as Record<string, unknown>;
    expect(out['_phi_safe_summary']).toBe(true);
    expect(out['document_type']).toBe('intake_form');
    // demographics(1) + chief_concern(1) + meds(2) + allergies(0) + family(1) = 5
    expect(out['n_facts']).toBe(5);
    expect(out['n_unsupported']).toBe(1);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('Margaret');
    expect(serialized).not.toContain('1967-08-14');
    expect(serialized).not.toContain('Lisinopril');
  });

  it('(d) S7 regression — non-W2 content is still walked normally with PHI key denylist', () => {
    const span = {
      tool_name: 'get_identity',
      meta: { row_count: 1 },
      patient_name: 'Margaret Chen',           // PHI key → REDACTED
      mrn: 'MRN-2026-04481',                    // PHI key → REDACTED
      counts: { abnormal: 5, total: 5 },        // benign → preserved
    };
    const out = redactPhi(span) as Record<string, unknown>;
    expect(out['tool_name']).toBe('get_identity');
    expect(out['patient_name']).not.toBe('Margaret Chen');
    expect(out['mrn']).not.toBe('MRN-2026-04481');
    expect((out['counts'] as Record<string, unknown>)['abnormal']).toBe(5);
  });
});
