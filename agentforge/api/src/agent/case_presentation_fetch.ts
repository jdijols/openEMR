import type { Env } from '../env.js';
import {
  OpenEmrCallError,
  getAllergies,
  getChartContextRows,
  getIdentity,
  type OpenEmrClientContext,
} from '../openemr/client.js';
import type { AllergyRow, ContextRow, IdentityDataRow } from '../openemr/types.js';

/**
 * Read DOB from an identity row in either casing PHP/PatientService may emit
 * ('DOB' from patient_data, 'dob' from older fixtures). Returns the first
 * field whose value parses as a calendar date.
 */
function readDob(identity: IdentityDataRow): string | null {
  const candidates = ['DOB', 'dob', 'date_of_birth'];
  for (const key of candidates) {
    const v = (identity as Record<string, unknown>)[key];
    if (typeof v === 'string' && v.trim() !== '') {
      return v.trim();
    }
  }
  return null;
}

/**
 * Deterministic age from DOB on a known reference date. Returning the value
 * to the prompt removes the need for the LLM to guess "today" — which is
 * the failure mode that produced off-by-one ages in case briefs.
 */
export function computeAgeYears(dob: string, today: Date): number | null {
  // Accept 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS'; ignore anything else.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
  if (m === null) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) {
    return null;
  }
  const todayY = today.getUTCFullYear();
  const todayMo = today.getUTCMonth() + 1;
  const todayD = today.getUTCDate();
  let age = todayY - y;
  if (todayMo < mo || (todayMo === mo && todayD < d)) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

function todayIsoDate(now: Date): string {
  const y = now.getUTCFullYear().toString().padStart(4, '0');
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = now.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type AiToolResultLike = {
  readonly type: 'tool-result';
  readonly toolName: string;
  readonly input: { patient_uuid: string };
  readonly output: unknown;
};

function tr(name: string, patientUuid: string, output: unknown): AiToolResultLike {
  return { type: 'tool-result', toolName: name, input: { patient_uuid: patientUuid }, output };
}

async function safeChartRows(
  env: Env,
  ctx: OpenEmrClientContext,
  patientUuid: string,
  path: string,
): Promise<readonly ContextRow[]> {
  try {
    return await getChartContextRows(env, ctx, patientUuid, path);
  } catch (e) {
    if (e instanceof OpenEmrCallError) {
      return [];
    }

    throw e;
  }
}

async function safeAllergies(
  env: Env,
  ctx: OpenEmrClientContext,
  patientUuid: string,
): Promise<readonly AllergyRow[]> {
  try {
    return await getAllergies(env, ctx, patientUuid);
  } catch (e) {
    if (e instanceof OpenEmrCallError) {
      return [];
    }

    throw e;
  }
}

export type CasePresentationFetched = {
  readonly identity: IdentityDataRow;
  readonly allergies: readonly AllergyRow[];
  readonly encounters: readonly ContextRow[];
  readonly problems: readonly ContextRow[];
  readonly meds: readonly ContextRow[];
  readonly vitals: readonly ContextRow[];
  readonly labs: readonly ContextRow[];
  readonly notes_metadata: readonly ContextRow[];
  readonly social_history: readonly ContextRow[];
  readonly toolResults: readonly AiToolResultLike[];
  readonly bundleForLlm: Record<string, unknown>;
};

const clamp = <T>(arr: readonly T[], n: number): readonly T[] => (arr.length <= n ? arr : arr.slice(0, n));

/**
 * Parallel bounded reads for case presentation; identity must succeed (caller handles throw).
 */
export async function fetchCasePresentationData(
  env: Env,
  ctx: OpenEmrClientContext,
  patientUuid: string,
): Promise<CasePresentationFetched> {
  const identity = await getIdentity(env, ctx, patientUuid);

  const [
    allergies,
    encounters,
    problems,
    meds,
    vitals,
    labs,
    notes_metadata,
    social_history,
  ] = await Promise.all([
    safeAllergies(env, ctx, patientUuid),
    safeChartRows(env, ctx, patientUuid, 'context/encounters.php'),
    safeChartRows(env, ctx, patientUuid, 'context/problems.php'),
    safeChartRows(env, ctx, patientUuid, 'context/meds.php'),
    safeChartRows(env, ctx, patientUuid, 'context/vitals.php'),
    safeChartRows(env, ctx, patientUuid, 'context/labs.php'),
    safeChartRows(env, ctx, patientUuid, 'context/notes_metadata.php'),
    safeChartRows(env, ctx, patientUuid, 'context/social_history.php'),
  ]);

  const toolResults: AiToolResultLike[] = [
    tr('get_identity', patientUuid, {
      ok: true as const,
      data: identity,
      source_packs: [identity.source_pack],
    }),
    tr('get_allergies', patientUuid, {
      ok: true as const,
      data: allergies,
      source_packs: allergies.map((r) => r.source_pack),
    }),
    tr('get_encounters', patientUuid, {
      ok: true as const,
      data: encounters,
      source_packs: encounters.map((r) => r.source_pack),
    }),
    tr('get_problems', patientUuid, {
      ok: true as const,
      data: problems,
      source_packs: problems.map((r) => r.source_pack),
    }),
    tr('get_meds', patientUuid, {
      ok: true as const,
      data: meds,
      source_packs: meds.map((r) => r.source_pack),
    }),
    tr('get_vitals', patientUuid, {
      ok: true as const,
      data: vitals,
      source_packs: vitals.map((r) => r.source_pack),
    }),
    tr('get_labs', patientUuid, {
      ok: true as const,
      data: labs,
      source_packs: labs.map((r) => r.source_pack),
    }),
    tr('get_notes_metadata', patientUuid, {
      ok: true as const,
      data: notes_metadata,
      source_packs: notes_metadata.map((r) => r.source_pack),
    }),
    tr('get_social_history', patientUuid, {
      ok: true as const,
      data: social_history,
      source_packs: social_history.map((r) => r.source_pack),
    }),
  ];

  // Anchor the model to a server-computed "today" and a deterministic age, so the
  // case brief never has to infer either from DOB + training-cutoff guesses. The
  // patient_data 'date' column (row create/update timestamp) was a known foot-gun
  // — strip it from the identity sent to the LLM so it cannot be mistaken for today.
  const now = new Date();
  const today = todayIsoDate(now);
  const dob = readDob(identity);
  const ageYears = dob !== null ? computeAgeYears(dob, now) : null;
  const identityForLlm: Record<string, unknown> = { ...identity };
  delete (identityForLlm as Record<string, unknown>).date;
  if (ageYears !== null) {
    identityForLlm.age_years = ageYears;
  }

  const bundleForLlm: Record<string, unknown> = {
    patient_uuid: patientUuid,
    today,
    identity: identityForLlm,
    allergies: clamp(allergies, 8),
    encounters: clamp(encounters, 5),
    problems: clamp(problems, 12),
    medications: clamp(meds, 12),
    vitals: clamp(vitals, 5),
    labs: clamp(labs, 10),
    notes_metadata: clamp(notes_metadata, 8),
    social_history: clamp(social_history, 8),
  };

  return {
    identity,
    allergies,
    encounters,
    problems,
    meds,
    vitals,
    labs,
    notes_metadata,
    social_history,
    toolResults,
    bundleForLlm,
  };
}
