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
  panel_name: 'LIPID PANEL WITH DIRECT LDL',
  date_collected: '2026-04-22',
  date_reported: '2026-04-22',
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
      result_comments: null,
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
      result_comments: null,
      citation: {
        source_type: 'lab_pdf',
        source_id: DOCREF_UUID,
        page_or_section: 'page:1',
        field_or_chunk_id: 'lipid.row2',
        quote_or_value: '48',
      },
    },
  ],
  interpretive_comments: null,
  interpretive_comments_citation: null,
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
  // The cross-check needs enough text on every "real text-layer PDF"
  // case that we're above the image-only threshold (~100 stripped
  // chars). Padding keeps the pdf-parse stub looking like a populated
  // lab without disturbing the citation strings each test asserts on.
  const PAD =
    'PACIFIC DIAGNOSTICS LAB ' +
    'PATIENT MARGARET CHEN DOB 1967-08-14 ' +
    'COLLECTED 2026-04-22 ORDERING PROVIDER RAO ANJALI MD ' +
    'LIPID PANEL WITH DIRECT LDL REFERENCE RANGE OPTIMAL ';

  it('all quotes verified → crossCheckStatus="verified"', async () => {
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      // raw text contains BOTH quote_or_value strings
      pdfParseFn: async () => ({ text: PAD + 'LDL 158 mg/dL HDL 48 mg/dL' }),
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
      pdfParseFn: async () => ({ text: PAD + 'LDL 158 mg/dL only' }), // 158 yes, 48 no
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
      pdfParseFn: async () => ({ text: PAD + 'a different document entirely' }),
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

  it('image-only PDF (empty text layer) → crossCheckStatus="not_applicable"', async () => {
    // A scanned-then-saved-as-PDF lab has no usable text layer; pdf-parse
    // returns essentially nothing. Vision still extracts values, so the
    // schema parses, but the substring check has no signal — mark
    // not_applicable so the persistence gate trusts vision (the only
    // OCR source) and writes the proposed observation.
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: '   ' }),
    });
    expect(result.crossCheckStatus).toBe('not_applicable');
    expect(result.factsTotal).toBe(0);
    expect(result.factsVerified).toBe(0);
  });

  it('image-only PDF with a few stray metadata chars → still "not_applicable"', async () => {
    // Some image-only PDFs carry a title or page number in the text
    // layer; that's well below the empty-layer threshold and must still
    // route through the vision-trust path.
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: 'Page 1' }),
    });
    expect(result.crossCheckStatus).toBe('not_applicable');
    expect(result.factsTotal).toBe(0);
  });

  it('whitespace mismatch (column wrap inside quote) still verifies', async () => {
    // pdf-parse routinely inserts newlines inside multi-word phrases
    // when columns wrap. Normalization collapses whitespace runs so the
    // substring still matches.
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({ text: PAD + 'LDL\n158\tmg/dL    HDL  48 mg/dL' }),
    });
    expect(result.crossCheckStatus).toBe('verified');
    expect(result.factsVerified).toBe(2);
  });

  it('text layer present but quote not in it → "unverified" (hallucination guard intact)', async () => {
    // A real text-layer PDF whose quotes can't be located is the
    // hallucination case the cross-check is built to catch. Normalization
    // does not weaken this — it removes formatting noise, not content.
    const client = makeMockClient(validLabExtractionJson);
    const result = await runIntakeExtractor(makeInput('application/pdf'), {
      client,
      pdfParseFn: async () => ({
        text: PAD + 'totally unrelated text with no LDL or HDL values anywhere',
      }),
    });
    expect(result.crossCheckStatus).toBe('unverified');
    expect(result.factsVerified).toBe(0);
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
        legal_name_first: 'Margaret',
        legal_name_last: 'Chen',
        legal_name_middle: 'L.',
        dob: '1967-08-14',
        sex: 'Female',
        contact_phone: '(510) 555-0148',
        street: null,
        city: null,
        state: null,
        postal_code: null,
        email: null,
        occupation: null,
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

describe('countQuoteMatches — text-layer normalization', () => {
  // Direct unit coverage for the substring-match normalization. The
  // pipeline normalizes both rawText and each quote via:
  //   NFKC + collapse-whitespace-runs + lowercase + trim.
  // These cases fail under a naive String.includes but should pass here.

  function makeLab(quote: string): LabPdfExtraction {
    return {
      document_type: 'lab_pdf',
      patient_uuid: PATIENT_UUID,
      source_document_id: DOCREF_UUID,
      ordering_provider: null,
      performing_lab: null,
      panel_name: null,
      date_collected: null,
      date_reported: null,
      results: [
        {
          test_name: 'Cholesterol, Total',
          loinc: null,
          value: 232,
          unit: 'mg/dL',
          reference_range_low: null,
          reference_range_high: 200,
          reference_range_text: null,
          collection_date: '2026-04-22',
          abnormal_flag: 'high',
          result_comments: null,
          citation: {
            source_type: 'lab_pdf',
            source_id: DOCREF_UUID,
            page_or_section: 'page:1',
            field_or_chunk_id: 'lipid.row1',
            quote_or_value: quote,
          },
        },
      ],
      interpretive_comments: null,
      interpretive_comments_citation: null,
      extraction_metadata: {
        pages_processed: 1,
        overall_confidence: 'high',
        fields_uncertain: [],
      },
    };
  }

  it('collapses newlines and tabs inside the PDF text layer', () => {
    // pdf-parse splits column-wrapped phrases across newlines; the LLM
    // emits the phrase on one line.
    const lab = makeLab('Cholesterol, Total 232 mg/dL');
    const rawText = 'Cholesterol,\nTotal\t232\nmg/dL';
    expect(countQuoteMatches(lab, rawText)).toEqual({ total: 1, verified: 1 });
  });

  it('matches across non-breaking spaces (U+00A0) between number and unit', () => {
    // PDFs commonly glue the number and unit with NBSP; the LLM emits
    // a regular space.
    const lab = makeLab('232 mg/dL');
    const rawText = '232 mg/dL';
    expect(countQuoteMatches(lab, rawText)).toEqual({ total: 1, verified: 1 });
  });

  it('matches across NBSP in the quote vs regular space in raw text', () => {
    // Symmetric: vision occasionally emits NBSP if it sees one in the image.
    const lab = makeLab('232 mg/dL');
    const rawText = '232 mg/dL';
    expect(countQuoteMatches(lab, rawText)).toEqual({ total: 1, verified: 1 });
  });

  it('folds ligatures (U+FB01 fi) via NFKC', () => {
    // Some PDF text layers carry ligature codepoints; the LLM emits
    // the decomposed form.
    const lab = makeLab('confirmed');
    const rawText = 'conﬁrmed reading';
    expect(countQuoteMatches(lab, rawText)).toEqual({ total: 1, verified: 1 });
  });

  it('is case-insensitive', () => {
    const lab = makeLab('LIPID PANEL');
    const rawText = 'Lipid Panel with direct LDL';
    expect(countQuoteMatches(lab, rawText)).toEqual({ total: 1, verified: 1 });
  });

  it('still fails when the quote content is genuinely absent (hallucination guard)', () => {
    const lab = makeLab('675 mg/dL');
    const rawText = 'Cholesterol, Total 232 mg/dL HDL 48 mg/dL';
    expect(countQuoteMatches(lab, rawText)).toEqual({ total: 1, verified: 0 });
  });
});
