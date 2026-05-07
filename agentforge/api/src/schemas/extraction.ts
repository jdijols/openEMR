import { z } from 'zod';

/**
 * §6 — Document extraction schemas (W2 citation contract).
 *
 * Strict Zod schemas for `lab_pdf` and `intake_form` extraction outputs. The
 * `SourceCitationSchema` primitive is shared and is the W2 citation contract
 * verbatim — every clinical claim that ships to the CUI must carry a citation
 * conforming to this shape (S8 stop-the-line invariant).
 *
 * **Schema source-of-truth = the OpenEMR write surface, NOT the document.** The
 * schema is shaped around what the chart can actually persist (per the live
 * field map of `lists` / `lists_medication` / `history_data` / `patient_data` /
 * `procedure_report` / `procedure_result`). When the LLM finds a value, the
 * dispatcher writes it to the matching column; when it doesn't, the column is
 * left untouched (null in JSON, no SQL `SET` for that column).
 *
 * Fields-not-in-source MUST be `null`, not empty strings — null tells the
 * dispatcher "no edit," empty string would clobber existing chart data on
 * a re-run. The `extraction_metadata.fields_unsupported` array surfaces the
 * fields the model looked for and didn't find in the source.
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

// ─── Lab schema ──────────────────────────────────────────────────────────
// Maps to OpenEMR's procedure_order → procedure_report → procedure_result tables
// (see Documentation/AgentForge/research/openemr-lab-write-surface for the field map).
// For the W2 demo the lab chart-write target is the encounter's clinical_note row
// (via propose_clinical_note_write); a future iteration writes to procedure_*
// tables proper. Either way, the schema captures the full set so the upgrade is
// a dispatcher swap, not a re-extraction.

export const LabResultSchema = z.object({
  test_name: z.string(),                            // procedure_result.result_text
  loinc: z.string().nullable(),                     // procedure_result.result_code (best-effort)
  value: z.union([z.number(), z.string()]),         // procedure_result.result (string for non-numeric like "Negative")
  unit: z.string().nullable(),                      // procedure_result.units
  reference_range_low: z.number().nullable(),
  reference_range_high: z.number().nullable(),
  reference_range_text: z.string().nullable(),      // procedure_result.range — verbatim if VLM cannot split
  collection_date: z.string(),                      // ISO 8601 → procedure_result.date
  abnormal_flag: z.enum([                           // procedure_result.abnormal (mapped to proc_res_abnormal option_id)
    'normal',          // 'no'
    'low',             // 'low'
    'high',            // 'high'
    'critical_low',    // 'vlow'
    'critical_high',   // 'vhigh'
    'abnormal',        // 'yes' (catch-all)
    'unknown',
  ]),
  result_comments: z.string().nullable(),           // procedure_result.comments — per-result note
  citation: SourceCitationSchema,                   // mandatory per result
});

export type LabResult = z.infer<typeof LabResultSchema>;

export const LabPdfExtractionSchema = z.object({
  document_type: z.literal('lab_pdf'),
  patient_uuid: z.string().uuid(),
  source_document_id: z.string(),                   // DocumentReference UUID

  // Order metadata → procedure_order columns
  ordering_provider: z.string().nullable(),         // procedure_order.provider_id (resolved by name)
  performing_lab: z.string().nullable(),            // procedure_order.lab_id (resolved by name)
  panel_name: z.string().nullable(),                // free-text panel header (e.g., "LIPID PANEL WITH DIRECT LDL")
  date_collected: z.string().nullable(),            // ISO datetime → procedure_order.date_collected (top-level convenience)
  date_reported: z.string().nullable(),             // ISO datetime → procedure_report.date_report

  // Result rows → procedure_result rows (1+ per panel)
  results: z.array(LabResultSchema),

  // Free-text interpretive guidance from the lab → procedure_report.report_notes.
  // This is the most clinically important new field — without it, the lab summary
  // shows just the values without the lab's recommended action. The example case:
  // "Multiple lipid abnormalities consistent with mixed dyslipidemia... consider
  // intensification of statin therapy in patients with diabetes mellitus and ASCVD
  // risk factors" — that paragraph is what makes the note actionable downstream.
  interpretive_comments: z.string().nullable(),
  interpretive_comments_citation: SourceCitationSchema.nullable(),

  extraction_metadata: z.object({
    pages_processed: z.number().int().positive(),
    overall_confidence: z.enum(['high', 'medium', 'low']),
    fields_uncertain: z.array(z.string()),
  }),
});

export type LabPdfExtraction = z.infer<typeof LabPdfExtractionSchema>;

// ─── Intake form schema ─────────────────────────────────────────────────
// Maps to lists / lists_medication / history_data / patient_data / form_encounter columns.
// Field names use the PHP propose-write payload keys (snake_case, English) rather than
// the raw DB column names so the dispatcher can pass the JSON straight to the write
// endpoint without renaming.

const SexEnum = z.enum(['Male', 'Female', 'Unknown']);
const SeverityEnum = z.enum(['mild', 'moderate', 'severe', 'life_threatening', 'unknown']);
const FamilyRelationEnum = z.enum([
  'mother', 'father',
  'sibling', 'brother', 'sister',
  'offspring', 'son', 'daughter', 'child',
  'spouse', 'partner',
]);

// Demographics — patient_data columns (subset that intake forms realistically supply).
const IntakeDemographicsSchema = z.object({
  legal_name_first: z.string().nullable(),         // patient_data.fname
  legal_name_last: z.string().nullable(),          // patient_data.lname
  legal_name_middle: z.string().nullable(),        // patient_data.mname
  dob: z.string().nullable(),                      // patient_data.DOB (ISO YYYY-MM-DD)
  sex: SexEnum.nullable(),                         // patient_data.sex
  contact_phone: z.string().nullable(),            // patient_data.phone_cell
  street: z.string().nullable(),                   // patient_data.street
  city: z.string().nullable(),                     // patient_data.city
  state: z.string().nullable(),                    // patient_data.state
  postal_code: z.string().nullable(),              // patient_data.postal_code
  email: z.string().nullable(),                    // patient_data.email
  occupation: z.string().nullable(),               // patient_data.occupation
  citation: SourceCitationSchema,                  // single citation covers the demographics block
});

// Chief concern — form_encounter.reason + onset metadata.
const IntakeChiefConcernSchema = z.object({
  text: z.string(),                                // form_encounter.reason
  onset: z.string().nullable(),                    // free-text onset description (e.g., "~3 weeks")
  citation: SourceCitationSchema,
});

// Medications — lists.type='medication' + lists_medication metadata.
// Each row maps to one INSERT into `lists` plus an optional companion `lists_medication`
// metadata row carrying dosage instructions / usage_category / request_intent.
const IntakeMedicationSchema = z.object({
  name: z.string(),                                // lists.title
  dose: z.string().nullable(),                     // free-text strength (e.g., "10 mg") — captured in lists.comments
  frequency: z.string().nullable(),                // free-text frequency (e.g., "PO daily") — captured in lists.comments
  sig: z.string().nullable(),                      // full sig text → lists_medication.drug_dosage_instructions
  indication: z.string().nullable(),               // what condition treated → lists.diagnosis
  begdate: z.string().nullable(),                  // ISO YYYY-MM-DD → lists.begdate (start date)
  enddate: z.string().nullable(),                  // ISO YYYY-MM-DD → lists.enddate (rare on a new-patient intake)
  citation: SourceCitationSchema,
});

// Allergies — lists.type='allergy' via AllergyIntoleranceService.
// `severity` extends to `life_threatening` (matches PHP severityAlOptionId mapping table).
const IntakeAllergySchema = z.object({
  substance: z.string(),                           // lists.title
  reaction: z.string().nullable(),                 // lists.comments (free-text manifestation)
  severity: SeverityEnum.nullable(),               // lists.severity_al (severity_ccda option_id)
  onset_date: z.string().nullable(),               // ISO YYYY-MM-DD → lists.begdate
  comments: z.string().nullable(),                 // extra free-text notes separate from reaction
  citation: SourceCitationSchema,
});

// Family history — history_data.history_{relation} free-text columns + structured relatives_*.
// `deceased` + `age_of_onset` capture the common "father, deceased of MI age 52" pattern that
// medical-office intake forms record. Both feed into the appended free-text on the relative's
// column (e.g., history_father becomes "MI age 52 (deceased)").
const IntakeFamilyHistorySchema = z.object({
  relation: FamilyRelationEnum,
  condition: z.string(),
  age_of_onset: z.string().nullable(),             // free-text age (e.g., "52", "early 60s")
  deceased: z.boolean().nullable(),                // true/false/null (null = unknown)
  citation: SourceCitationSchema,
});

export const IntakeFormSchema = z.object({
  document_type: z.literal('intake_form'),
  patient_uuid: z.string().uuid(),
  source_document_id: z.string(),
  demographics: IntakeDemographicsSchema,
  chief_concern: IntakeChiefConcernSchema,
  current_medications: z.array(IntakeMedicationSchema),
  allergies: z.array(IntakeAllergySchema),
  family_history: z.array(IntakeFamilyHistorySchema),
  extraction_metadata: z.object({
    pages_processed: z.number().int().positive(),
    overall_confidence: z.enum(['high', 'medium', 'low']),
    fields_uncertain: z.array(z.string()),
    fields_unsupported: z.array(z.string()),       // requested fields NOT visible in source
  }),
});

export type IntakeForm = z.infer<typeof IntakeFormSchema>;
export type IntakeDemographics = z.infer<typeof IntakeDemographicsSchema>;
export type IntakeMedication = z.infer<typeof IntakeMedicationSchema>;
export type IntakeAllergy = z.infer<typeof IntakeAllergySchema>;
export type IntakeFamilyHistoryEntry = z.infer<typeof IntakeFamilyHistorySchema>;
