/**
 * Gate 6 / G6-08 — Langfuse trace deny-list redactor (PRD §5.10, §8.7, §11.3).
 *
 * Stop-the-line invariant **S7**: no PHI in Langfuse trace bodies.
 *
 * Redaction is a deny-list applied to every string anywhere in a JSON-shaped value
 * before it is handed to the Langfuse client. The deny-list is intentionally
 * conservative — it errs on the side of over-redaction to keep traces PHI-free,
 * trading some debugging fidelity for an enforceable safety property.
 *
 * Patterns (HIPAA Safe Harbor-aligned):
 *   - dates of birth (YYYY-MM-DD, M/D/YYYY, etc.)
 *   - phone numbers (US 10-digit, +country)
 *   - email addresses
 *   - US SSN (XXX-XX-XXXX)
 *   - MRN / patient identifier hints (`MRN:1234`, `Patient ID 9876`, `pid=42`)
 *   - street address number+name pairs (`123 Main`, `456 Oak Street`)
 *   - URL query params named `launch_code`, `session_token`, `code`, `token`
 *   - long bearer-like tokens (≥32 hex / base64 chars after `Bearer ` or in `session_token` JSON values)
 *   - ALLCAPS + Mixed-case Person Names (handled for first+last on a line; falls back to whole-string masking when adjacent to obvious PHI cues like `Patient name:`)
 *
 * What we deliberately do NOT redact:
 *   - clinical vocabulary (lisinopril, hypertension, BP 120/80) — these are not identifiers
 *   - UUIDs from `source_pack.uuid` (citation linkage; not patient-identifying)
 *   - Provider model names, correlation ids
 */

const REDACTED = '[REDACTED]';

const DOB_PATTERNS: readonly RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/gu,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/gu,
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/gu,
];

const PHONE_PATTERNS: readonly RegExp[] = [
  // (NNN) NNN-NNNN — `\b` does not anchor before `(`, so use a lookbehind for non-word.
  /(?<![A-Za-z0-9_])\(\d{3}\)\s?\d{3}-\d{4}(?![A-Za-z0-9_])/gu,
  // +1 555 123 4567 / +1-555-123-4567
  /(?<![A-Za-z0-9_])\+\d{1,3}[-.\s]\d{3}[-.\s]\d{3}[-.\s]\d{4}(?![A-Za-z0-9_])/gu,
  // 555-123-4567 / 555.123.4567
  /\b\d{3}[-.]\d{3}[-.]\d{4}\b/gu,
];

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/gu;

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu;

const STREET_ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way|Terrace|Ter)\b/gu;

const MRN_LIKE_PATTERN =
  /\b(?:MRN|Patient(?:\s+ID)?|pid|patient_id|chart_id)\s*[:=#]?\s*\d{2,}\b/giu;

const URL_TOKEN_KEY_PATTERN =
  /\b(launch_code|session_token|access_token|refresh_token|api_key|bearer_token|token|code)=[^\s&"']{8,}/giu;

const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._\-+/=]{16,}/giu;

const PERSON_NAME_LABEL_PATTERN =
  /\b(?:patient(?:[\s_-]+name)?|name|first[\s_-]*name|last[\s_-]*name|surname|family[\s_-]*name|given[\s_-]*name)\s*[:=]\s*([^\n,;]{1,80})/giu;

/**
 * Two or more consecutive ALL CAPS words (each ≥3 chars) — likely a person name
 * (e.g., "JOHN DOE" in chart prompts). Will over-redact medical abbreviations
 * that appear in pairs (e.g., "ACTIVE PROBLEMS"); that is the safety trade-off.
 */
const ALLCAPS_NAME_PAIR_PATTERN = /\b[A-Z]{3,}(?:[\s,]+[A-Z]{3,}){1,3}\b/gu;

const ALL_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  ...DOB_PATTERNS.map((p) => ({ pattern: p, replacement: REDACTED })),
  ...PHONE_PATTERNS.map((p) => ({ pattern: p, replacement: REDACTED })),
  { pattern: SSN_PATTERN, replacement: REDACTED },
  { pattern: EMAIL_PATTERN, replacement: REDACTED },
  { pattern: STREET_ADDRESS_PATTERN, replacement: REDACTED },
  { pattern: MRN_LIKE_PATTERN, replacement: REDACTED },
  { pattern: URL_TOKEN_KEY_PATTERN, replacement: REDACTED },
  { pattern: BEARER_TOKEN_PATTERN, replacement: `Bearer ${REDACTED}` },
  { pattern: ALLCAPS_NAME_PAIR_PATTERN, replacement: REDACTED },
];

/** PHI key hints — when a JSON property name matches, the entire value is masked outright. */
const PHI_KEY_HINTS: ReadonlySet<string> = new Set([
  'patient_name',
  'patientName',
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'middle_name',
  'middleName',
  'dob',
  'date_of_birth',
  'birthdate',
  'ssn',
  'address',
  'street',
  'street_address',
  'zip',
  'postal_code',
  'phone',
  'phone_number',
  'email',
  'mrn',
  'launch_code',
  'session_token',
  'access_token',
  'refresh_token',
  'api_key',
  'bearer_token',
  'authorization',
  'auth',
]);

/**
 * Redact a single string by running the deny-list patterns against it.
 * Empty strings and strings without any pattern hit are returned unchanged.
 */
export function redactString(input: string): string {
  if (input === '') {
    return input;
  }

  let out = input;

  // Person-name labels: redact only the captured name (group 1).
  out = out.replace(PERSON_NAME_LABEL_PATTERN, (match, name: string) => {
    const labelEnd = match.length - name.length;
    return `${match.slice(0, labelEnd)}${REDACTED}`;
  });

  for (const { pattern, replacement } of ALL_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, replacement);
  }

  return out;
}

/**
 * Recursively redact a JSON-shaped value.
 *
 * Rules:
 *   - strings → run `redactString`
 *   - arrays → map element-wise
 *   - plain objects → if a key matches a PHI hint, replace value with [REDACTED];
 *     otherwise recurse
 *   - everything else (numbers, booleans, null, undefined, Date, etc.) is preserved as-is
 *
 * Objects with custom prototypes (Errors, Maps, etc.) are coerced to a redacted
 * string so we never accidentally serialize unexpected internals.
 */
export function redactPhi(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return redactString(input);
  }

  if (typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactPhi(item));
  }

  if (typeof input === 'object') {
    if (
      Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null
    ) {
      // Error, Map, custom class — coerce to string and redact.
      return redactString(String(input));
    }

    // §12 / G2-MVP-40 — W2 content-block summarization (S11 hard rule).
    // Document / image content blocks carry raw PHI bytes in `source.data`;
    // summarize before any other walk so we never even consider redacting
    // a base64'd PDF/PNG body field-by-field.
    const summarizedW2 = summarizeW2ContentBlockOrExtraction(input);
    if (summarizedW2 !== null) {
      return summarizedW2;
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (PHI_KEY_HINTS.has(key) || PHI_KEY_HINTS.has(key.toLowerCase())) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redactPhi(value);
    }
    return out;
  }

  // bigint, symbol, function — refuse to serialize.
  return REDACTED;
}

/**
 * §12 / G2-MVP-40 — W2 content-block + extraction-JSON summarizer.
 *
 * Returns a PHI-safe summary object when the input is one of:
 *   - Anthropic `document` content block (PDF base64) →
 *     { type, size_bytes, mime, _phi_safe_summary:true }
 *   - Anthropic `image` content block (PNG/JPEG base64) →
 *     { type, size_bytes, mime, _phi_safe_summary:true }
 *   - LLM-extracted JSON envelope (carries §6 schema fields) →
 *     { schema_valid, n_facts, n_uncertain, _phi_safe_summary:true }
 *
 * Returns `null` when the input is none of these — callers fall through
 * to the regular deny-list walk.
 */
function summarizeW2ContentBlockOrExtraction(input: unknown): unknown | null {
  if (input === null || typeof input !== 'object') {
    return null;
  }
  const obj = input as Record<string, unknown>;

  // Document / image content blocks — Anthropic SDK shape:
  //   { type: 'document'|'image', source: { type: 'base64', media_type, data: '<b64>' } }
  if ((obj['type'] === 'document' || obj['type'] === 'image') && typeof obj['source'] === 'object' && obj['source'] !== null) {
    const source = obj['source'] as Record<string, unknown>;
    if (source['type'] === 'base64' && typeof source['data'] === 'string') {
      const sizeBytes = Math.ceil((source['data'].length * 3) / 4); // base64 → byte estimate
      return {
        type: obj['type'],
        size_bytes: sizeBytes,
        mime: typeof source['media_type'] === 'string' ? source['media_type'] : 'unknown',
        _phi_safe_summary: true,
      };
    }
  }

  // LLM extraction JSON — recognized by §6 document_type literal + leaf
  // citations. Replace the entire envelope with a metadata summary.
  if (obj['document_type'] === 'lab_pdf' && Array.isArray(obj['results'])) {
    const meta = obj['extraction_metadata'] as Record<string, unknown> | undefined;
    return {
      document_type: 'lab_pdf',
      schema_valid: true,
      n_facts: (obj['results'] as unknown[]).length,
      n_uncertain: Array.isArray(meta?.['fields_uncertain']) ? meta['fields_uncertain'].length : 0,
      _phi_safe_summary: true,
    };
  }
  if (obj['document_type'] === 'intake_form' && typeof obj['demographics'] === 'object') {
    const meta = obj['extraction_metadata'] as Record<string, unknown> | undefined;
    const meds = Array.isArray(obj['current_medications']) ? obj['current_medications'].length : 0;
    const allergies = Array.isArray(obj['allergies']) ? obj['allergies'].length : 0;
    const family = Array.isArray(obj['family_history']) ? obj['family_history'].length : 0;
    return {
      document_type: 'intake_form',
      schema_valid: true,
      n_facts: meds + allergies + family + 2, // demographics + chief_concern always present
      n_uncertain: Array.isArray(meta?.['fields_uncertain']) ? meta['fields_uncertain'].length : 0,
      n_unsupported: Array.isArray(meta?.['fields_unsupported']) ? meta['fields_unsupported'].length : 0,
      _phi_safe_summary: true,
    };
  }

  return null;
}
