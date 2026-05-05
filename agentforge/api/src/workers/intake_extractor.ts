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

  // The LLM does not know our internal UUIDs — `patient_uuid` (system
  // canonical) and `source_document_id` (the DocRef we minted at upload)
  // can only be supplied by the caller. Inject them before Zod, and
  // overwrite every leaf citation's `source_id` + `source_type` so the
  // schema's `quote_or_value` cross-check still has a coherent envelope.
  if (llmJson !== null && typeof llmJson === 'object' && !Array.isArray(llmJson)) {
    const obj = llmJson as Record<string, unknown>;
    obj['document_type'] = input.docType;
    obj['patient_uuid'] = input.patientUuidCanonical;
    obj['source_document_id'] = input.docrefUuid;
    injectDocRefIntoCitations(obj, input.docrefUuid, input.docType);
  }

  const schema = input.docType === 'lab_pdf' ? LabPdfExtractionSchema : IntakeFormSchema;
  const parsed = schema.safeParse(llmJson);
  if (!parsed.success) {
    // Diagnostic: keys present + first few Zod issues. PHI-safe (paths only,
    // no values). Remove or downgrade to debug after the smoke is green.
    const obj = (llmJson !== null && typeof llmJson === 'object' && !Array.isArray(llmJson))
      ? (llmJson as Record<string, unknown>)
      : {};
    console.error('intake_extractor_schema_fail', {
      docType: input.docType,
      llm_returned_object: llmJson !== null && typeof llmJson === 'object',
      top_level_keys: Object.keys(obj),
      issues: parsed.error.issues.slice(0, 8).map((iss) => ({
        path: iss.path.join('.'),
        code: iss.code,
        message: iss.message,
      })),
    });
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
      'You are extracting a clinical lab report. Return ONLY a JSON object — no prose, no markdown fences — matching this exact shape:',
      '```',
      '{',
      '  "ordering_provider": "<name>" | null,',
      '  "performing_lab": "<name>" | null,',
      '  "results": [',
      '    {',
      '      "test_name": "<verbatim test name>",',
      '      "loinc": "<code>" | null,',
      '      "value": <number> | "<string for non-numeric>",',
      '      "unit": "<unit>" | null,',
      '      "reference_range_low": <number> | null,',
      '      "reference_range_high": <number> | null,',
      '      "reference_range_text": "<verbatim range text>" | null,',
      '      "collection_date": "<ISO 8601 date>",',
      '      "abnormal_flag": "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal" | "unknown",',
      '      "citation": {',
      '        "source_type": "lab_pdf",',
      '        "source_id": "<docref>",',
      '        "page_or_section": "page:1",',
      '        "field_or_chunk_id": "<short label>",',
      '        "quote_or_value": "<EXACT verbatim text from PDF, must appear character-for-character>"',
      '      }',
      '    }',
      '  ],',
      '  "extraction_metadata": {',
      '    "pages_processed": <int>,',
      '    "overall_confidence": "high" | "medium" | "low",',
      '    "fields_uncertain": ["<field name>", ...]',
      '  }',
      '}',
      '```',
      'Use EXACTLY these JSON keys — do not rename. Use `null` (not omission) for unknown values. Do NOT invent values: if a result row is unreadable, drop the row and add its name to `fields_uncertain`. quote_or_value MUST be a substring of the source PDF.',
      'Do NOT include `document_type`, `patient_uuid`, or `source_document_id` — the caller injects those. Emit ONLY the raw JSON object, no markdown fences.',
    ].join('\n');
  }
  return [
    'You are extracting a patient intake form. Return ONLY a JSON object — no prose, no markdown fences — matching this exact shape:',
    '```',
    '{',
    '  "demographics": {',
    '    "name": "<full name>" | null,',
    '    "dob": "<YYYY-MM-DD>" | null,',
    '    "sex": "male" | "female" | "other" | "unknown" | null,',
    '    "contact_phone": "<phone>" | null,',
    '    "citation": {',
    '      "source_type": "intake_form",',
    '      "source_id": "<docref>",',
    '      "page_or_section": "Demographics",',
    '      "field_or_chunk_id": "demographics",',
    '      "quote_or_value": "<verbatim quote from form>"',
    '    }',
    '  },',
    '  "chief_concern": {',
    '    "text": "<verbatim chief concern>",',
    '    "onset": "<duration>" | null,',
    '    "citation": { ...same shape as above, page_or_section: "Chief Concern" }',
    '  },',
    '  "current_medications": [',
    '    { "name": "<drug>", "dose": "<dose>" | null, "frequency": "<freq>" | null, "citation": { ... } },',
    '    ...',
    '  ],',
    '  "allergies": [',
    '    { "substance": "<drug/agent>", "reaction": "<reaction>" | null, "severity": "mild" | "moderate" | "severe" | "unknown" | null, "citation": { ... } },',
    '    ...',
    '  ],',
    '  "family_history": [',
    '    { "relation": "<father/mother/sibling/...>", "condition": "<condition>", "citation": { ... } },',
    '    ...',
    '  ],',
    '  "extraction_metadata": {',
    '    "pages_processed": <int>,',
    '    "overall_confidence": "high" | "medium" | "low",',
    '    "fields_uncertain": ["<field name>", ...],',
    '    "fields_unsupported": ["<field requested but not visible>", ...]',
    '  }',
    '}',
    '```',
    'Use EXACTLY these JSON keys — do not rename, do not nest under additional wrappers like `personal_details`, `legal_name`, `date_of_birth`, `phone`. Use `null` (not omission) for unknown values. Every leaf observation MUST include `citation` with `quote_or_value` as a verbatim substring of the form. Empty arrays (`[]`) are fine when a section has no entries.',
    'Do NOT include `document_type`, `patient_uuid`, or `source_document_id` — the caller injects those. Do NOT include extra top-level keys like `emergency_contact`, `health_insurance`, `treating_physicians`, `past_medical_surgical_history`, `social_history` — they are out of scope. Emit ONLY the raw JSON object, no markdown fences.',
  ].join('\n');
}

/**
 * Walk every nested object and overwrite each `citation` field's
 * `source_id` + `source_type` to match the caller-provided DocRef. The
 * LLM names citations correctly enough but cannot know our internal IDs.
 */
function injectDocRefIntoCitations(value: unknown, docrefUuid: string, docType: 'lab_pdf' | 'intake_form'): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      injectDocRefIntoCitations(item, docrefUuid, docType);
    }
    return;
  }
  const o = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'citation' && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      c['source_id'] = docrefUuid;
      c['source_type'] = docType;
    } else {
      injectDocRefIntoCitations(v, docrefUuid, docType);
    }
  }
}

function extractJsonFromResponse(response: unknown): unknown {
  const content = (response as { content?: ReadonlyArray<{ type?: string; text?: string }> }).content ?? [];
  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      continue;
    }
    let raw = block.text.trim();

    // Strip markdown fences: ```json ... ``` or ``` ... ```.
    const fence = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
    if (fence) {
      raw = fence[1]?.trim() ?? raw;
    }

    // Find the outermost `{...}` block. Try parsing; on failure, scan
    // inward for a smaller balanced object (Claude sometimes appends prose
    // after the JSON).
    const start = raw.indexOf('{');
    if (start < 0) {
      continue;
    }
    for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        // Try a tighter slice.
      }
    }

    // This block had `{` but no parse worked — log the head so we can debug.
    console.error('intake_extractor_unparseable_text_block', {
      head: raw.slice(0, 400),
      tail: raw.slice(-200),
      length: raw.length,
    });
  }

  // No content block yielded JSON. Log the response shape so we can see
  // what Claude actually returned.
  const blocks = (response as { content?: ReadonlyArray<{ type?: string; text?: string }> }).content ?? [];
  console.error('intake_extractor_no_json_in_response', {
    block_count: blocks.length,
    block_types: blocks.map((b) => b.type),
    first_text_head: blocks.find((b) => b.type === 'text')?.text?.slice(0, 400),
  });

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
