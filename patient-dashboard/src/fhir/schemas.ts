import { z } from 'zod'

// `nullish()` (not `optional()`) because OpenEMR's FHIR serializer emits
// explicit `null` for missing string fields (e.g. `display: null` on coded
// concepts where no human-readable label exists). Zod's `optional()` accepts
// `undefined` but rejects `null`, so a single null on any coding entry would
// fail the whole bundle parse and surface as "Could not load …" on the card.
const FhirCoding = z.object({
  system: z.string().nullish(),
  code: z.string().nullish(),
  display: z.string().nullish(),
})

const FhirCodeableConcept = z.object({
  coding: z.array(FhirCoding).optional(),
  text: z.string().optional(),
})

const FhirReference = z.object({
  reference: z.string().optional(),
  display: z.string().optional(),
  type: z.string().optional(),
})

const FhirHumanName = z.object({
  family: z.string().optional(),
  given: z.array(z.string()).optional(),
  text: z.string().optional(),
  use: z.string().optional(),
})

const FhirIdentifier = z.object({
  system: z.string().optional(),
  value: z.string().optional(),
  type: z.object({ coding: z.array(FhirCoding).optional() }).optional(),
  use: z.string().optional(),
})

const FhirAddress = z.object({
  use: z.string().optional(),
  type: z.string().optional(),
  line: z.array(z.string()).optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
})

const FhirContactPoint = z.object({
  system: z.string().optional(),
  value: z.string().optional(),
  use: z.string().optional(),
})

const FhirQuantity = z.object({
  value: z.number().optional(),
  unit: z.string().optional(),
  system: z.string().optional(),
  code: z.string().optional(),
})

const FhirRange = z.object({
  low: FhirQuantity.optional(),
  high: FhirQuantity.optional(),
})

const FhirPeriod = z.object({
  start: z.string().optional(),
  end: z.string().optional(),
})

export const FhirPatientSchema = z.object({
  resourceType: z.literal('Patient'),
  id: z.string(),
  name: z.array(FhirHumanName).optional(),
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  identifier: z.array(FhirIdentifier).optional(),
  active: z.boolean().optional(),
  deceasedBoolean: z.boolean().optional(),
  deceasedDateTime: z.string().optional(),
  address: z.array(FhirAddress).optional(),
  telecom: z.array(FhirContactPoint).optional(),
  maritalStatus: FhirCodeableConcept.optional(),
  communication: z
    .array(
      z.object({
        language: FhirCodeableConcept.optional(),
        preferred: z.boolean().optional(),
      }),
    )
    .optional(),
})
export type FhirPatient = z.infer<typeof FhirPatientSchema>

export const FhirAllergyIntoleranceSchema = z.object({
  resourceType: z.literal('AllergyIntolerance'),
  id: z.string(),
  code: FhirCodeableConcept.optional(),
  clinicalStatus: FhirCodeableConcept.optional(),
  verificationStatus: FhirCodeableConcept.optional(),
  criticality: z.string().optional(),
  reaction: z
    .array(
      z.object({
        manifestation: z.array(FhirCodeableConcept).optional(),
        severity: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  recordedDate: z.string().optional(),
  note: z.array(z.object({ text: z.string().optional() })).optional(),
  // OpenEMR's FhirAllergyIntoleranceService puts the allergy substance
  // (lists.title — e.g. "eggs", "Penicillin") into the resource narrative
  // when there is no SNOMED-coded diagnosis. Without it, `code.coding[0].
  // display` falls back to "Unknown" and the card shows nothing useful.
  // We read the narrative div as the primary source for the substance name
  // and treat code.text / code.coding[0].display as fallbacks.
  text: z
    .object({
      status: z.string().optional(),
      div: z.string().optional(),
    })
    .optional(),
})
export type FhirAllergyIntolerance = z.infer<typeof FhirAllergyIntoleranceSchema>

export const FhirConditionSchema = z.object({
  resourceType: z.literal('Condition'),
  id: z.string(),
  code: FhirCodeableConcept.optional(),
  category: z.array(FhirCodeableConcept).optional(),
  clinicalStatus: FhirCodeableConcept.optional(),
  verificationStatus: FhirCodeableConcept.optional(),
  onsetDateTime: z.string().optional(),
  recordedDate: z.string().optional(),
})
export type FhirCondition = z.infer<typeof FhirConditionSchema>

export const FhirMedicationRequestSchema = z.object({
  resourceType: z.literal('MedicationRequest'),
  id: z.string(),
  status: z.string().optional(),
  intent: z.string().optional(),
  medicationCodeableConcept: FhirCodeableConcept.optional(),
  authoredOn: z.string().optional(),
  dosageInstruction: z
    .array(
      z.object({
        text: z.string().optional(),
      }),
    )
    .optional(),
  dispenseRequest: z
    .object({
      numberOfRepeatsAllowed: z.number().optional(),
    })
    .optional(),
})
export type FhirMedicationRequest = z.infer<typeof FhirMedicationRequestSchema>

export const FhirCareTeamSchema = z.object({
  resourceType: z.literal('CareTeam'),
  id: z.string(),
  status: z.string().optional(),
  name: z.string().optional(),
  participant: z
    .array(
      z.object({
        member: FhirReference.optional(),
        role: z.array(FhirCodeableConcept).optional(),
        period: FhirPeriod.optional(),
      }),
    )
    .optional(),
})
export type FhirCareTeam = z.infer<typeof FhirCareTeamSchema>

export const FhirObservationSchema = z.object({
  resourceType: z.literal('Observation'),
  id: z.string(),
  status: z.string().optional(),
  category: z.array(FhirCodeableConcept).optional(),
  code: FhirCodeableConcept.optional(),
  effectiveDateTime: z.string().optional(),
  effectivePeriod: FhirPeriod.optional(),
  valueQuantity: FhirQuantity.optional(),
  valueString: z.string().optional(),
  valueCodeableConcept: FhirCodeableConcept.optional(),
  referenceRange: z
    .array(
      z.object({
        low: FhirQuantity.optional(),
        high: FhirQuantity.optional(),
        text: z.string().optional(),
      }),
    )
    .optional(),
  interpretation: z.array(FhirCodeableConcept).optional(),
  component: z
    .array(
      z.object({
        code: FhirCodeableConcept.optional(),
        valueQuantity: FhirQuantity.optional(),
      }),
    )
    .optional(),
})
export type FhirObservation = z.infer<typeof FhirObservationSchema>

export const FhirImmunizationSchema = z.object({
  resourceType: z.literal('Immunization'),
  id: z.string(),
  status: z.string().optional(),
  vaccineCode: FhirCodeableConcept.optional(),
  occurrenceDateTime: z.string().optional(),
  occurrenceString: z.string().optional(),
  lotNumber: z.string().optional(),
})
export type FhirImmunization = z.infer<typeof FhirImmunizationSchema>

export const FhirAppointmentSchema = z.object({
  resourceType: z.literal('Appointment'),
  id: z.string(),
  status: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  serviceType: z.array(FhirCodeableConcept).optional(),
  description: z.string().optional(),
  participant: z
    .array(
      z.object({
        actor: FhirReference.optional(),
        status: z.string().optional(),
      }),
    )
    .optional(),
})
export type FhirAppointment = z.infer<typeof FhirAppointmentSchema>

// Bundle envelope helper. The narrow `entry[].resource` is parameterized so each card
// can ask for a Bundle of a specific resource type.
export function FhirBundleSchema<T extends z.ZodTypeAny>(entrySchema: T) {
  return z.object({
    resourceType: z.literal('Bundle'),
    type: z.string().optional(),
    total: z.number().optional(),
    entry: z
      .array(
        z.object({
          resource: entrySchema.optional(),
        }),
      )
      .optional(),
  })
}

export type FhirBundle<T> = {
  resourceType: 'Bundle'
  type?: string
  total?: number
  entry?: Array<{ resource?: T }>
}

export function bundleEntries<T>(bundle: FhirBundle<T> | undefined): T[] {
  if (!bundle?.entry) return []
  const out: T[] = []
  for (const e of bundle.entry) {
    if (e.resource !== undefined) out.push(e.resource)
  }
  return out
}

const _RangeUnused: z.ZodType<unknown> = FhirRange
void _RangeUnused
