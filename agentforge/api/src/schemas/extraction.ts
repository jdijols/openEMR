import { z } from 'zod';

/**
 * §6 — Document extraction schemas (W2 citation contract).
 *
 * Strict Zod schemas for `lab_pdf` and `intake_form` extraction outputs. The
 * `SourceCitationSchema` primitive is shared and is the W2 citation contract
 * verbatim — every clinical claim that ships to the CUI must carry a citation
 * conforming to this shape (S8 stop-the-line invariant).
 *
 * Schemas are kept verbatim with W2_ARCHITECTURE.md §6. Drift here without
 * updating the architecture doc breaks the eval gate's `schema_valid` rubric.
 */

export const SourceCitationSchema = z.object({
  source_type: z.enum(['lab_pdf', 'intake_form', 'guideline_chunk', 'openemr_record']),
  source_id: z.string(),                           // DocumentReference UUID, chunk_id, or OpenEMR row uuid
  page_or_section: z.string(),                     // "page:2", "Chief Concern", "USPSTF §3.1"
  field_or_chunk_id: z.string(),                   // form field name, table cell coord, chunk id
  quote_or_value: z.string().min(1),               // VERBATIM text or value from the source — must be non-empty (gates `citation_present` rubric)
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),  // [x0,y0,x1,y1] normalized 0-1; PDFs only
  confidence: z.number().min(0).max(1).optional(), // VLM self-reported, surfaced in verification
});

export type SourceCitation = z.infer<typeof SourceCitationSchema>;

export const LabResultSchema = z.object({
  test_name: z.string(),
  loinc: z.string().nullable(),                    // best-effort, not required
  value: z.union([z.number(), z.string()]),       // string for non-numeric ("Negative")
  unit: z.string().nullable(),
  reference_range_low: z.number().nullable(),
  reference_range_high: z.number().nullable(),
  reference_range_text: z.string().nullable(),    // verbatim if VLM cannot split
  collection_date: z.string(),                     // ISO 8601
  abnormal_flag: z.enum(['normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal', 'unknown']),
  citation: SourceCitationSchema,                  // mandatory per result
});

export type LabResult = z.infer<typeof LabResultSchema>;

export const LabPdfExtractionSchema = z.object({
  document_type: z.literal('lab_pdf'),
  patient_uuid: z.string().uuid(),
  source_document_id: z.string(),                  // DocumentReference UUID
  ordering_provider: z.string().nullable(),
  performing_lab: z.string().nullable(),
  results: z.array(LabResultSchema),
  extraction_metadata: z.object({
    pages_processed: z.number().int().positive(),
    overall_confidence: z.enum(['high', 'medium', 'low']),
    fields_uncertain: z.array(z.string()),         // names of fields VLM flagged uncertain
  }),
});

export type LabPdfExtraction = z.infer<typeof LabPdfExtractionSchema>;

export const IntakeFormSchema = z.object({
  document_type: z.literal('intake_form'),
  patient_uuid: z.string().uuid(),
  source_document_id: z.string(),
  demographics: z.object({
    name: z.string().nullable(),
    dob: z.string().nullable(),
    sex: z.enum(['male', 'female', 'other', 'unknown']).nullable(),
    contact_phone: z.string().nullable(),
    citation: SourceCitationSchema,
  }),
  chief_concern: z.object({
    text: z.string(),
    onset: z.string().nullable(),
    citation: SourceCitationSchema,
  }),
  current_medications: z.array(z.object({
    name: z.string(),
    dose: z.string().nullable(),
    frequency: z.string().nullable(),
    citation: SourceCitationSchema,
  })),
  allergies: z.array(z.object({
    substance: z.string(),
    reaction: z.string().nullable(),
    severity: z.enum(['mild', 'moderate', 'severe', 'unknown']).nullable(),
    citation: SourceCitationSchema,
  })),
  family_history: z.array(z.object({
    relation: z.string(),
    condition: z.string(),
    citation: SourceCitationSchema,
  })),
  extraction_metadata: z.object({
    pages_processed: z.number().int().positive(),
    overall_confidence: z.enum(['high', 'medium', 'low']),
    fields_uncertain: z.array(z.string()),
    fields_unsupported: z.array(z.string()),       // requested fields NOT visible in source
  }),
});

export type IntakeForm = z.infer<typeof IntakeFormSchema>;
