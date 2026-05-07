/**
 * Gate 4 G4-05 — strict Zod: allergy delete cannot be represented without widening the union.
 */

import { describe, expect, it } from 'vitest';
import { exportedSchemasGate4 } from '../../src/tools/propose_writes.js';

describe('propose_writes Zod (G4-05)', () => {
  it('does not admit allergy action delete via union', () => {
    const allergySchema = exportedSchemasGate4.allergySchema;
    const malformed: unknown = {
      patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'.toUpperCase(),
      action: 'delete',
      substance: 'penicillin',
    };
    const out = allergySchema.safeParse(malformed);
    expect(out.success).toBe(false);
  });

  it('accepts allergy add/update keys (allergy is patient-scoped — encounter_id not in schema)', () => {
    expect(
      exportedSchemasGate4.allergySchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        action: 'add',
        substance: 'penicillin',
      }).success,
    ).toBe(true);
  });

  it('requires encounter_id for propose-chief payloads', () => {
    expect(
      exportedSchemasGate4.chiefSchema.safeParse({
        patient_uuid: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'.toUpperCase(),
        reason: 'Sore throat',
      }).success,
    ).toBe(false);
  });

  it('rejects extra encounter_id on patient-scoped tobacco proposals', () => {
    expect(
      exportedSchemasGate4.tobaccoSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        status: 'never_smoker',
      }).success,
    ).toBe(true);
  });
});

// G2-Early-25 — the 5 new W2 propose-write schemas. Mirrors the PHP payload parsers.
describe('propose_writes Zod (G2-Early-25)', () => {
  it('medication_add accepts {name, dose, frequency}', () => {
    expect(
      exportedSchemasGate4.medicationAddSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        name: 'Lisinopril',
        dose: '10 mg',
        frequency: 'PO daily',
      }).success,
    ).toBe(true);
  });

  it('medication_add rejects missing name', () => {
    expect(
      exportedSchemasGate4.medicationAddSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        dose: '10 mg',
      }).success,
    ).toBe(false);
  });

  it('medication_add rejects extra unknown keys (strict)', () => {
    expect(
      exportedSchemasGate4.medicationAddSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        name: 'Lisinopril',
        rogue_key: 'value',
      }).success,
    ).toBe(false);
  });

  it('medication_discontinue requires medication_uuid', () => {
    expect(
      exportedSchemasGate4.medicationDiscontinueSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }).success,
    ).toBe(false);
  });

  it('allergy_delete is a separate schema (does not piggy-back on allergy_write delete)', () => {
    expect(
      exportedSchemasGate4.allergyDeleteSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        allergy_uuid: '11111111-2222-4333-a444-aaaaaaaaaaaa',
      }).success,
    ).toBe(true);
  });

  it('family_history_add rejects unknown relation', () => {
    expect(
      exportedSchemasGate4.familyHistoryAddSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        relation: 'cousin',
        condition: 'T2DM',
      }).success,
    ).toBe(false);
  });

  it('family_history_add accepts mother + condition', () => {
    expect(
      exportedSchemasGate4.familyHistoryAddSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        relation: 'mother',
        condition: 'T2DM',
      }).success,
    ).toBe(true);
  });

  it('document_delete requires docref_uuid in canonical UUID form', () => {
    expect(
      exportedSchemasGate4.documentDeleteSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        docref_uuid: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

// G2-Final-12 — demographics_update Zod.
describe('propose_writes Zod (G2-Final-12)', () => {
  it('demographics_update accepts a single field plus patient_uuid', () => {
    expect(
      exportedSchemasGate4.demographicsUpdateSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        contact_phone: '(510) 555-0148',
      }).success,
    ).toBe(true);
  });

  it('demographics_update rejects when only patient_uuid is supplied', () => {
    expect(
      exportedSchemasGate4.demographicsUpdateSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }).success,
    ).toBe(false);
  });

  it('demographics_update rejects malformed dob', () => {
    expect(
      exportedSchemasGate4.demographicsUpdateSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        dob: '1980/01/15',
      }).success,
    ).toBe(false);
  });

  it('demographics_update rejects out-of-enum sex', () => {
    expect(
      exportedSchemasGate4.demographicsUpdateSchema.safeParse({
        patient_uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        sex: 'other',
      }).success,
    ).toBe(false);
  });
});
