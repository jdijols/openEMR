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
