import { describe, it, expect } from 'vitest'
import {
  FhirPatientSchema,
  FhirAllergyIntoleranceSchema,
  FhirConditionSchema,
  FhirMedicationRequestSchema,
  FhirCareTeamSchema,
  FhirObservationSchema,
  FhirImmunizationSchema,
  FhirAppointmentSchema,
  FhirBundleSchema,
  bundleEntries,
} from './schemas'

describe('FHIR schemas', () => {
  it('parses a minimal Patient', () => {
    const r = FhirPatientSchema.safeParse({ resourceType: 'Patient', id: '1' })
    expect(r.success).toBe(true)
  })

  it('parses a fully-populated Patient', () => {
    const r = FhirPatientSchema.safeParse({
      resourceType: 'Patient',
      id: '1',
      name: [{ family: 'Reyes', given: ['Sofia', 'M'] }],
      birthDate: '1983-12-19',
      gender: 'female',
      identifier: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', value: '0031' }],
      active: true,
    })
    expect(r.success).toBe(true)
  })

  it('rejects wrong resourceType', () => {
    const r = FhirPatientSchema.safeParse({ resourceType: 'NotPatient', id: '1' })
    expect(r.success).toBe(false)
  })

  it('parses AllergyIntolerance with reaction array', () => {
    const r = FhirAllergyIntoleranceSchema.safeParse({
      resourceType: 'AllergyIntolerance',
      id: 'a1',
      code: { text: 'Ibuprofen' },
      criticality: 'high',
      reaction: [{ severity: 'severe', manifestation: [{ text: 'GI bleed' }] }],
    })
    expect(r.success).toBe(true)
  })

  it('parses Condition', () => {
    const r = FhirConditionSchema.safeParse({
      resourceType: 'Condition',
      id: 'c1',
      code: { text: 'Hypertension' },
      category: [{ coding: [{ code: 'problem-list-item' }] }],
    })
    expect(r.success).toBe(true)
  })

  it('parses MedicationRequest', () => {
    const r = FhirMedicationRequestSchema.safeParse({
      resourceType: 'MedicationRequest',
      id: 'm1',
      status: 'active',
      intent: 'order',
      medicationCodeableConcept: { text: 'Metformin' },
      dosageInstruction: [{ text: '1000 mg BID' }],
    })
    expect(r.success).toBe(true)
  })

  it('parses CareTeam with participant', () => {
    const r = FhirCareTeamSchema.safeParse({
      resourceType: 'CareTeam',
      id: 'ct1',
      name: 'Great Clinic',
      status: 'active',
      participant: [
        {
          member: { reference: 'Practitioner/123', display: 'Lee, Donna' },
          role: [{ text: 'Primary Care Provider' }],
        },
      ],
    })
    expect(r.success).toBe(true)
  })

  it('parses Observation with valueQuantity', () => {
    const r = FhirObservationSchema.safeParse({
      resourceType: 'Observation',
      id: 'o1',
      code: { text: 'BMI' },
      effectiveDateTime: '2026-05-09T08:48:00',
      valueQuantity: { value: 26, unit: 'kg/m2' },
    })
    expect(r.success).toBe(true)
  })

  it('parses Immunization', () => {
    const r = FhirImmunizationSchema.safeParse({
      resourceType: 'Immunization',
      id: 'i1',
      vaccineCode: { text: 'COVID-19, mRNA' },
      occurrenceDateTime: '2026-04-01',
      status: 'completed',
    })
    expect(r.success).toBe(true)
  })

  it('parses Immunization with null coding fields (OpenEMR shape)', () => {
    // OpenEMR's FHIR serializer emits explicit `null` (not omitted) for
    // missing string fields on Coding entries. Regression for a real bundle
    // received from /apis/default/fhir/Immunization where `display: null`
    // failed schema parsing and broke the card.
    const r = FhirImmunizationSchema.safeParse({
      resourceType: 'Immunization',
      id: 'a1ba47a5-c3ba-41b6-bca4-8f135eb30dff',
      status: 'not-done',
      vaccineCode: {
        coding: [
          {
            system: 'http://hl7.org/fhir/sid/cvx',
            code: '03',
            display: null,
          },
        ],
      },
      occurrenceDateTime: '2018-05-08T11:00:00+00:00',
    })
    expect(r.success).toBe(true)
  })

  it('parses Appointment', () => {
    const r = FhirAppointmentSchema.safeParse({
      resourceType: 'Appointment',
      id: 'ap1',
      status: 'booked',
      start: '2026-05-10T08:00:00',
    })
    expect(r.success).toBe(true)
  })

  it('FhirBundleSchema wraps a typed entry resource', () => {
    const Bundle = FhirBundleSchema(FhirPatientSchema)
    const r = Bundle.safeParse({
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [{ resource: { resourceType: 'Patient', id: 'p1' } }],
    })
    expect(r.success).toBe(true)
  })

  it('bundleEntries flattens entry[].resource and skips missing entries', () => {
    const out = bundleEntries({
      resourceType: 'Bundle' as const,
      entry: [
        { resource: { resourceType: 'Patient', id: 'a' } },
        { resource: undefined },
        { resource: { resourceType: 'Patient', id: 'b' } },
      ],
    })
    expect(out.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('bundleEntries returns [] for undefined bundle', () => {
    expect(bundleEntries(undefined)).toEqual([])
  })
})
