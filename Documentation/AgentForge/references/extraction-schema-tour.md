---
title: AgentForge — Extraction Schema Tour (W2)
brief: Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf
related:
  - W2_ARCHITECTURE.md (§6)
  - agentforge/api/src/schemas/extraction.ts
  - agentforge/api/src/workers/intake_extractor.ts
  - agentforge/api/eval/runner.ts (`schema_valid` rule)
created: 2026-05-09
status: reference — annotated walkthrough of the W2 strict schemas
---

# Extraction Schema Tour

This document is the annotated companion to `agentforge/api/src/schemas/extraction.ts`. The W2 brief requires every extracted fact to round-trip through a strict Zod schema with a verbatim source citation; the schemas in that file ARE the contract. This tour walks through them top-down so a reviewer can verify the contract without reading TypeScript.

## Where the schemas are enforced

- **Worker side:** `agentforge/api/src/workers/intake_extractor.ts` calls `safeParse` against the LLM's JSON envelope. A failed parse short-circuits with `schemaValid: false` — no extraction is persisted, no claim is shipped to the chat.
- **Eval side:** `agentforge/api/eval/runner.ts` registers `schema_valid` as one of the five W2 rubric rules (G2-Early-31). The runner imports the production schemas directly so the eval rule cannot drift from runtime behavior — see W2-D4 in `Documentation/AgentForge/submission.md`.
- **CUI side:** the `synthesizeAgentSteps` helper in `agentforge/api/src/agent/orchestrator.ts` (G2-Final-FB-A-02) surfaces `schema_valid: true | false` in the `agent_step` strip every reviewer sees.

## SourceCitationSchema — the citation primitive

Every clinical claim that ships to the CUI must carry one of these. Anything else is dropped by `verifyClinicalBlocks` (S8 stop-the-line invariant).

| Field | Type | Required | Purpose |
|---|---|---|---|
| `source_type` | `'lab_pdf' \| 'intake_form' \| 'guideline_chunk' \| 'openemr_record'` | yes | Discriminator for click-through behavior in the CUI |
| `source_id` | `string` | yes | `DocumentReference` UUID, RAG chunk_id, or OpenEMR row UUID |
| `page_or_section` | `string` | yes | Human label: `"page:2"`, `"Chief Concern"`, `"USPSTF §3.1"` |
| `field_or_chunk_id` | `string` | yes | Form field name, table cell coordinate, or chunk id |
| `quote_or_value` | non-empty `string` | yes | **Verbatim** text/value from the source. Cross-checked against the source PDF for `lab_pdf`/`intake_form`; substring of the chunk text for `guideline_chunk` (G2-Final-FB-D-05) |
| `bbox` | `[x0, y0, x1, y1]` (normalized 0–1) | no | PDF only — drives the yellow rectangle overlay |
| `confidence` | `number` 0–1 | no | VLM self-reported; surfaced in verification + Langfuse |

**Example (intake form, allergy section):**

```json
{
  "source_type": "intake_form",
  "source_id": "docref-chen-intake",
  "page_or_section": "Allergies",
  "field_or_chunk_id": "allergies[0]",
  "quote_or_value": "Penicillin — hives in 2018"
}
```

**Example (guideline chunk):**

```json
{
  "source_type": "guideline_chunk",
  "source_id": "uspstf-statin#high-intensity",
  "page_or_section": "USPSTF §3.1",
  "field_or_chunk_id": "uspstf-statin#high-intensity",
  "quote_or_value": "Adults with diabetes and elevated LDL benefit from high-intensity statin therapy."
}
```

## LabPdfExtractionSchema

Mirrors `agentforge/api/src/schemas/extraction.ts` lines 41–55. The shape:

```jsonc
{
  "document_type": "lab_pdf",
  "patient_uuid": "<uuid>",
  "source_document_id": "<DocumentReference UUID>",
  "ordering_provider": "Dr. ..." | null,
  "performing_lab": "Quest Diagnostics" | null,
  "results": [
    {
      "test_name": "LDL Cholesterol",
      "loinc": "13457-7" | null,
      "value": 158,                                      // number OR string for non-numeric ("Negative")
      "unit": "mg/dL" | null,
      "reference_range_low": 0 | null,
      "reference_range_high": 99 | null,
      "reference_range_text": "0-99 mg/dL" | null,
      "collection_date": "2025-12-15",                   // ISO 8601
      "abnormal_flag": "high",                           // enum: normal|low|high|critical_low|critical_high|abnormal|unknown
      "citation": { /* SourceCitation, page_or_section: "page:1" */ }
    }
  ],
  "extraction_metadata": {
    "pages_processed": 1,
    "overall_confidence": "high" | "medium" | "low",
    "fields_uncertain": []
  }
}
```

**Things the schema enforces (and that the eval `schema_valid` rule catches):**

- `document_type` must be the literal `'lab_pdf'`.
- `patient_uuid` must be a valid UUID (system canonical, injected by the caller — the LLM never knows this value).
- `results[].value` accepts numbers OR strings — qualitative results like `"Negative"` are allowed.
- `results[].abnormal_flag` is enum-restricted; an out-of-enum value rejects the whole extraction.
- `extraction_metadata.pages_processed` must be a positive integer (zero is rejected — see eval case `w2-schema-valid-lab-pages-processed-zero-rejected`).
- Every `LabResult` has its own non-optional `citation`.

## IntakeFormSchema

Mirrors `agentforge/api/src/schemas/extraction.ts` lines 60–95. The shape:

```jsonc
{
  "document_type": "intake_form",
  "patient_uuid": "<uuid>",
  "source_document_id": "<DocumentReference UUID>",
  "demographics": {
    "name": "Margaret Chen" | null,
    "dob": "1962-03-08" | null,
    "sex": "female" | null,                              // enum: male|female|other|unknown|null
    "contact_phone": "555-867-5309" | null,
    "citation": { /* SourceCitation, page_or_section: "Demographics" */ }
  },
  "chief_concern": {
    "text": "Follow-up for elevated A1C and statin reconciliation",
    "onset": "ongoing 6 months" | null,
    "citation": { ... }
  },
  "current_medications": [
    { "name": "metformin", "dose": "1000 mg", "frequency": "BID", "citation": { ... } }
  ],
  "allergies": [
    { "substance": "penicillin", "reaction": "hives", "severity": "moderate", "citation": { ... } }
  ],
  "family_history": [
    { "relation": "father", "condition": "T2DM", "citation": { ... } }
  ],
  "extraction_metadata": {
    "pages_processed": 2,
    "overall_confidence": "high",
    "fields_uncertain": [],
    "fields_unsupported": []
  }
}
```

**Things the schema enforces:**

- Every leaf observation (demographics, chief_concern, each medication, each allergy, each family_history row) carries its own `SourceCitation`.
- `sex` and `severity` are enum-restricted — invalid enum values reject the extraction.
- Empty arrays are valid: a patient with no allergies on the form correctly produces `"allergies": []`.
- `extraction_metadata.fields_unsupported` is intake-only — captures sections the LLM saw on the form but were out of W2 scope (e.g., emergency contact, insurance details).

## How the schemas plug into the verification gate

After `runIntakeExtractor` parses + cross-checks the extraction, the result flows into `agentforge/api/src/agent/verification.ts` via the `attach_and_extract` tool's output. The verification gate then:

1. **Drops** any claim that lacks a citation (S8).
2. **Drops** any claim whose `citation_id` doesn't resolve to one of the SourceCitations the worker returned.
3. **Drops** any negative claim ("no allergies on file") not backed by an empty-query observation (PRD §9.3).
4. **Tightens** (G2-Final-FB-D-05) — the `quote_or_value` must appear as a substring of the cited chunk's full text, not just the 400-char preview.

A claim that survives all four gates is what the CUI renders as a clickable citation pill.

## Eval coverage

| Rubric | Cases | What's tested |
|---|---|---|
| `schema_valid` | 10 | §6 Zod parse rejects malformed lab/intake fixtures (out-of-enum, missing required, empty quote, etc.) |
| `citation_present` | 10 | Every clinical claim carries a `SourceCitation` conforming to `SourceCitationSchema` |
| `citation_quote_in_source` | added at FB-D-04 | `quote_or_value` appears as substring in the cited chunk's full text |

Run the suite from `agentforge/api/`:

```bash
npm run eval
```

The latest report lands under `agentforge/api/eval/reports/` and is also surfaced live in the CUI footer via the `EvalGateBadge` (G2-Final-FB-A-05).

## Why the schemas matter

The brief's MVP-feedback DM flagged "schema enforcement" as a verification-visibility surface. This is the contract a reviewer can grep for in one minute:

- See `agentforge/api/src/schemas/extraction.ts` for the source of truth (90 lines, no surprises).
- See `agentforge/api/test/schemas/extraction.test.ts` for the round-trip Vitest scenarios.
- See `agentforge/api/eval/cases/curated/w2-schema-valid-*.json` for the malformed-fixture rejections.
- See the `agent_step` strip in the CUI for `schema_valid: ✓ / ✗` per-turn.

If any of these four surfaces shows a regression, the gate fails — locally via `prek`, on PRs via GitHub Actions, and visibly in the deployed app via the footer pill.
