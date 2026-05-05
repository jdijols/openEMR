import Anthropic from '@anthropic-ai/sdk';
import {
  IntakeFormSchema,
  LabPdfExtractionSchema,
  type IntakeForm,
  type LabPdfExtraction,
} from '../schemas/extraction.js';

/**
 * §5 / G2-MVP-32..34 — `intake_extractor` worker.
 *
 * Three responsibilities, deterministically composed:
 *
 *  1. **MIME dispatch + Claude call** — `application/pdf` goes through
 *     Claude's `document` content block; `image/png` and `image/jpeg` go
 *     through the `image` content block. Same model, same prompt
 *     skeleton; the doc-type drives which schema we parse against.
 *  2. **Zod cross-check** — parse the LLM's JSON envelope against
 *     `LabPdfExtractionSchema` or `IntakeFormSchema`. Schema failure
 *     short-circuits with `schemaValid=false` (gates `schema_valid`
 *     rubric / S8).
 *  3. **PDF deterministic cross-check (S14)** — for PDF inputs, run
 *     `pdf-parse` on the raw bytes and string-match every leaf
 *     citation's `quote_or_value` against the extracted text. Facts
 *     whose quote is not present are marked unverified and the
 *     extraction's overall status is downgraded; the verification gate
 *     downstream is responsible for not persisting unverified facts.
 *
 * Bbox population (G2-MVP-34) is delegated to a separately-injected
 * `populateBboxes` function so tests can verify the dispatch contract
 * without booting `pdfjs-dist`.
 */

export type IntakeExtractorInput = {
  readonly docrefUuid: string;
  readonly patientUuidCanonical: string;
  readonly docType: 'lab_pdf' | 'intake_form';
  readonly fileBytes: Uint8Array;
  readonly mimeType: string;
};

export type IntakeExtractorResult = {
  readonly schemaValid: boolean;
  readonly extraction: LabPdfExtraction | IntakeForm | null;
  readonly schemaErrors: ReadonlyArray<unknown>;
  readonly crossCheckStatus: 'verified' | 'partial' | 'unverified' | 'not_applicable';
  readonly factsTotal: number;
  readonly factsVerified: number;
  readonly factsUnverified: number;
  readonly metadata: {
    readonly mime: string;
    readonly docType: 'lab_pdf' | 'intake_form';
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
};

export type ContentBlock =
  | {
      readonly type: 'document';
      readonly source: { readonly type: 'base64'; readonly media_type: 'application/pdf'; readonly data: string };
    }
  | {
      readonly type: 'image';
      readonly source: { readonly type: 'base64'; readonly media_type: 'image/png' | 'image/jpeg'; readonly data: string };
    };

export type IntakeExtractorDeps = {
  readonly client: Pick<Anthropic, 'messages'> & { messages: { create: Anthropic['messages']['create'] } };
  /** Returns the raw text layer of a PDF; injectable for tests. */
  readonly pdfParseFn: (bytes: Uint8Array) => Promise<{ text: string }>;
  /** Mutates citation.bbox in place using pdfjs-dist; injectable for tests. */
  readonly populateBboxes?: (
    extraction: LabPdfExtraction | IntakeForm,
    bytes: Uint8Array,
  ) => Promise<void>;
};

const SUPPORTED_PDF_MIME = 'application/pdf';
const SUPPORTED_IMAGE_MIMES = ['image/png', 'image/jpeg'] as const;

export function buildContentBlock(input: IntakeExtractorInput): ContentBlock {
  const data = bytesToBase64(input.fileBytes);
  if (input.mimeType === SUPPORTED_PDF_MIME) {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    };
  }
  if ((SUPPORTED_IMAGE_MIMES as readonly string[]).includes(input.mimeType)) {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.mimeType as 'image/png' | 'image/jpeg',
        data,
      },
    };
  }
  throw new Error(`unsupported_mime: ${input.mimeType}`);
}

export async function runIntakeExtractor(
  input: IntakeExtractorInput,
  deps: IntakeExtractorDeps,
): Promise<IntakeExtractorResult> {
  const contentBlock = buildContentBlock(input);
  const userPrompt = buildPromptForDocType(input.docType);

  const llmResponse = await deps.client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        // The Anthropic SDK accepts arrays of mixed text/image/document blocks.
        content: [contentBlock as never, { type: 'text', text: userPrompt } as never],
      },
    ],
  });

  const inputTokens = (llmResponse as unknown as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? 0;
  const outputTokens = (llmResponse as unknown as { usage?: { output_tokens?: number } }).usage?.output_tokens ?? 0;

  const llmJson = extractJsonFromResponse(llmResponse);
  const schema = input.docType === 'lab_pdf' ? LabPdfExtractionSchema : IntakeFormSchema;
  const parsed = schema.safeParse(llmJson);
  if (!parsed.success) {
    return {
      schemaValid: false,
      extraction: null,
      schemaErrors: parsed.error.issues,
      crossCheckStatus: input.mimeType === SUPPORTED_PDF_MIME ? 'unverified' : 'not_applicable',
      factsTotal: 0,
      factsVerified: 0,
      factsUnverified: 0,
      metadata: { mime: input.mimeType, docType: input.docType, inputTokens, outputTokens },
    };
  }

  // PDF deterministic cross-check (S14).
  let crossCheckStatus: 'verified' | 'partial' | 'unverified' | 'not_applicable' = 'not_applicable';
  let factsTotal = 0;
  let factsVerified = 0;
  if (input.mimeType === SUPPORTED_PDF_MIME) {
    const rawText = (await deps.pdfParseFn(input.fileBytes)).text;
    const counts = countQuoteMatches(parsed.data, rawText);
    factsTotal = counts.total;
    factsVerified = counts.verified;
    if (factsTotal === 0) {
      crossCheckStatus = 'unverified';
    } else if (factsVerified === factsTotal) {
      crossCheckStatus = 'verified';
    } else if (factsVerified > 0) {
      crossCheckStatus = 'partial';
    } else {
      crossCheckStatus = 'unverified';
    }
  }

  // Bbox population is best-effort; failures must not break the
  // extraction (the verification gate works without bboxes).
  if (input.mimeType === SUPPORTED_PDF_MIME && deps.populateBboxes) {
    try {
      await deps.populateBboxes(parsed.data, input.fileBytes);
    } catch {
      // Swallow; missing bboxes are tolerated.
    }
  }

  const factsUnverified = factsTotal - factsVerified;

  return {
    schemaValid: true,
    extraction: parsed.data,
    schemaErrors: [],
    crossCheckStatus,
    factsTotal,
    factsVerified,
    factsUnverified,
    metadata: { mime: input.mimeType, docType: input.docType, inputTokens, outputTokens },
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function buildPromptForDocType(docType: 'lab_pdf' | 'intake_form'): string {
  if (docType === 'lab_pdf') {
    return [
      'You are extracting a clinical lab report. Return ONLY a JSON object conforming to LabPdfExtractionSchema.',
      'Required top-level keys: document_type="lab_pdf", patient_uuid (UUID), source_document_id, ordering_provider, performing_lab, results, extraction_metadata.',
      'For each result populate test_name, value, unit, reference_range_low/high or reference_range_text, collection_date (ISO 8601), abnormal_flag (one of normal|low|high|critical_low|critical_high|abnormal|unknown), and a citation (source_type="lab_pdf", source_id=document UUID, page_or_section like "page:1", field_or_chunk_id, quote_or_value as VERBATIM source text).',
      'Do NOT invent values. If a field is not visible, list its name in extraction_metadata.fields_uncertain and omit the result row entirely.',
      'No prose; emit raw JSON.',
    ].join('\n\n');
  }
  return [
    'You are extracting a patient intake form. Return ONLY a JSON object conforming to IntakeFormSchema.',
    'Required keys: document_type="intake_form", patient_uuid, source_document_id, demographics, chief_concern, current_medications, allergies, family_history, extraction_metadata.',
    'Every leaf observation (each medication, each allergy, each family-history entry, demographics, chief_concern) must include a citation with verbatim quote_or_value drawn from the source.',
    'Do NOT invent values. If a field is requested but not visible, list its name in extraction_metadata.fields_unsupported.',
    'No prose; emit raw JSON.',
  ].join('\n\n');
}

function extractJsonFromResponse(response: unknown): unknown {
  const content = (response as { content?: ReadonlyArray<{ type?: string; text?: string }> }).content ?? [];
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      const trimmed = block.text.trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Walk every leaf citation in the extraction and string-match its
 * `quote_or_value` against `rawText`. Returns counts; the caller maps
 * counts to a status enum.
 */
export function countQuoteMatches(
  extraction: LabPdfExtraction | IntakeForm,
  rawText: string,
): { total: number; verified: number } {
  let total = 0;
  let verified = 0;

  const visit = (citation: { quote_or_value: string } | undefined): void => {
    if (!citation || typeof citation.quote_or_value !== 'string' || citation.quote_or_value.length === 0) {
      return;
    }
    total += 1;
    if (rawText.includes(citation.quote_or_value)) {
      verified += 1;
    }
  };

  if (extraction.document_type === 'lab_pdf') {
    for (const result of extraction.results) {
      visit(result.citation);
    }
  } else {
    visit(extraction.demographics.citation);
    visit(extraction.chief_concern.citation);
    for (const med of extraction.current_medications) {
      visit(med.citation);
    }
    for (const allergy of extraction.allergies) {
      visit(allergy.citation);
    }
    for (const fam of extraction.family_history) {
      visit(fam.citation);
    }
  }

  return { total, verified };
}
