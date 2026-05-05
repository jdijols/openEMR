import { describe, expect, it, vi } from 'vitest';
import {
  buildContentBlock,
  countQuoteMatches,
  runIntakeExtractor,
  type IntakeExtractorDeps,
  type IntakeExtractorInput,
} from '../../src/workers/intake_extractor.js';
import type { IntakeForm, LabPdfExtraction } from '../../src/schemas/extraction.js';

/**
 * §5 / G2-MVP-32..34 — intake_extractor tests.
 *
 * G2-MVP-32 (4 scenarios): MIME dispatch + Zod parse + schema validity contract.
 * G2-MVP-33 (4 scenarios): pdf-parse cross-check status enum.
 * G2-MVP-34 (3 scenarios): bbox lookup dispatch (delegated; PNG skip).
 */

const PATIENT_UUID = '00000000-0000-0000-0000-000000000001';
const DOCREF_UUID = 'docref-uuid-test';

const validLabExtractionJson: LabPdfExtraction = {
  document_type: 'lab_pdf',
  patient_uuid: PATIENT_UUID,
  source_document_id: DOCREF_UUID,
  ordering_provider: 'RAO, ANJALI MD',
  performing_lab: 'Pacific Diagnostics Lab',
  results: [
    {
      test_name: 'LDL Cholesterol, Calculated',
      loinc: '13457-7',
      value: 158,
      unit: 'mg/dL',
      reference_range_low: null,
      reference_range_high: 100,
      reference_range_text: 'Optimal <100',
      collection_date: '2026-04-22',
      abnormal_flag: 'high',
      citation: {
        source_type: 'lab_pdf',
        source_id: DOCREF_UUID,
        page_or_section: 'page:1',
        field_or_chunk_id: 'lipid.row3',
        quote_or_value: '158',
      },
    },
    {
      test_name: 'HDL Cholesterol',
      loinc: '2085-9',
      value: 48,
      unit: 'mg/dL',
      reference_range_low: 50,
      reference_range_high: null,
      reference_range_text: null,
      collection_date: '2026-04-22',
      abnormal_flag: 'low',
      citation: {
        source_type: 'lab_pdf',
        source_id: DOCREF_UUID,
        page_or_section: 'page:1',
        field_or_chunk_id: 'lipid.row2',
        quote_or_value: '48',
      },
    },
  ],
  extraction_metadata: {
    pages_processed: 1,
    overall_confidence: 'high',
    fields_uncertain: [],
  },
};

function makeMockClient(jsonResponse: unknown, options?: { inputTokens?: number; outputTokens?: number }): IntakeExtractorDeps['client'] {
  const create = vi.fn(async () => ({
    content: [
      { type: 'text', text: typeof jsonResponse === 'string' ? jsonResponse : JSON.stringify(jsonResponse) },
    ],
    usage: { input_tokens: options?.inputTokens ?? 100, output_tokens: options?.outputTokens ?? 50 },
  }));
  return { messages: { create } } as unknown as IntakeExtractorDeps['client'];
}

function makeInput(mimeType: string, docType: 'lab_pdf' | 'intake_form' = 'lab_pdf', bytes = new Uint8Array([1, 2, 3])): IntakeExtractorInput {
  return {
    docrefUuid: DOCREF_UUID,
    patientUuidCanonical: PATIENT_UUID,
    docType,
    fileBytes: bytes,
    mimeType,
  };
}

describe('§5 G2-MVP-32 — MIME dispatch + Zod parse', () => {
  it('PDF input produces a `document` content block', () => {
    const block = buildContentBlock(makeInput('application/pdf'));
    expect(block.type).toBe('document');
    if (block.type === 'document') {
      expect(block.source.media_type).toBe('application/pdf');
    }
  });

  it('PNG input produces an `image` content block', () => {
    const block = buildContentBlock(makeInput('image/png'));
    expect(block.type).toBe('image');
    if (block.type === 'image') {
      expect(block.source.media_type).toBe('image/png');
    }
  });

  it('Zod-invalid LLM output → schemaValid=false, extraction=null', async () => {
    const client = makeMockClient({ document_type: 'lab_pdf', patient_uuid: 'not-a-uuid' });
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: 'irrelevant' }),
    });
    expect(result.schemaValid).toBe(false);
    expect(result.extraction).toBeNull();
    expect(result.schemaErrors.length).toBeGreaterThan(0);
  });

  it('Zod-valid output passes through cleanly with metadata + tokens', async () => {
    const client = makeMockClient(validLabExtractionJson, { inputTokens: 4284, outputTokens: 700 });
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: 'LDL 158 HDL 48' }),
    });
    expect(result.schemaValid).toBe(true);
    expect(result.extraction).not.toBeNull();
    expect(result.metadata.inputTokens).toBe(4284);
    expect(result.metadata.outputTokens).toBe(700);
  });
});

describe('§5 G2-MVP-33 — pdf-parse deterministic cross-check', () => {
  it('all quotes verified → crossCheckStatus="verified"', async () => {
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      // raw text contains BOTH quote_or_value strings
      pdfParseFn: async () => ({ text: 'LDL 158 mg/dL HDL 48 mg/dL' }),
    });
    expect(result.crossCheckStatus).toBe('verified');
    expect(result.factsTotal).toBe(2);
    expect(result.factsVerified).toBe(2);
    expect(result.factsUnverified).toBe(0);
  });

  it('some quotes missing → crossCheckStatus="partial"', async () => {
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: 'LDL 158 mg/dL only' }), // 158 yes, 48 no
    });
    expect(result.crossCheckStatus).toBe('partial');
    expect(result.factsTotal).toBe(2);
    expect(result.factsVerified).toBe(1);
    expect(result.factsUnverified).toBe(1);
  });

  it('all quotes missing → crossCheckStatus="unverified"', async () => {
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: 'a different document entirely' }),
    });
    expect(result.crossCheckStatus).toBe('unverified');
    expect(result.factsVerified).toBe(0);
  });

  it('PNG input → crossCheckStatus="not_applicable" (no text layer to match)', async () => {
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('image/png'), {
      client,
      pdfParseFn: async () => ({ text: '' }),
    });
    expect(result.crossCheckStatus).toBe('not_applicable');
    expect(result.factsTotal).toBe(0);
  });
});

describe('§5 G2-MVP-34 — bbox lookup dispatch', () => {
  it('PDF input invokes populateBboxes when provided', async () => {
    const populateBboxes = vi.fn(async () => undefined);
    const client = makeMockClient(validLabExtractionJson);
    await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: 'LDL 158 HDL 48' }),
      populateBboxes,
    });
    expect(populateBboxes).toHaveBeenCalledOnce();
  });

  it('PNG input does NOT invoke populateBboxes', async () => {
    const populateBboxes = vi.fn(async () => undefined);
    const client = makeMockClient(validLabExtractionJson);
    await runIntakeExtractor(makeInput('image/png'), {
      client,
      pdfParseFn: async () => ({ text: '' }),
      populateBboxes,
    });
    expect(populateBboxes).not.toHaveBeenCalled();
  });

  it('populateBboxes failure does not break the extraction', async () => {
    const populateBboxes = vi.fn(async () => {
      throw new Error('pdfjs broke');
    });
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: 'LDL 158 HDL 48' }),
      populateBboxes,
    });
    expect(result.schemaValid).toBe(true);
    expect(result.extraction).not.toBeNull();
  });
});

describe('countQuoteMatches helper (intake form)', () => {
  it('walks every leaf citation across an intake form', () => {
    const intake: IntakeForm = {
      document_type: 'intake_form',
      patient_uuid: PATIENT_UUID,
      source_document_id: DOCREF_UUID,
      demographics: {
        name: 'Chen, Margaret L.',
        dob: '1967-08-14',
        sex: 'female',
        contact_phone: '(510) 555-0148',
        citation: {
          source_type: 'intake_form',
          source_id: DOCREF_UUID,
          page_or_section: 'demographics',
          field_or_chunk_id: 'name',
          quote_or_value: 'Chen, Margaret L.',
        },
      },
      chief_concern: {
        text: 'Tired during the day',
        onset: '~3 weeks',
        citation: {
          source_type: 'intake_form',
          source_id: DOCREF_UUID,
          page_or_section: 'chief_concern',
          field_or_chunk_id: 'text',
          quote_or_value: 'Tired during the day',
        },
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
    const counts = countQuoteMatches(intake, 'Chen, Margaret L. Tired during the day');
    expect(counts.total).toBe(2);
    expect(counts.verified).toBe(2);
  });
});
