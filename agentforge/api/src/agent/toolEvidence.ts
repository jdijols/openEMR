import { sourcePackSchema, type SourcePack } from '../openemr/types.js';

/** UUID → navigation_hint from Context Service rows (PRD §4.5 / §6.7); used only for CUI citation clicks. */
export type CitationNavigationHint = {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
};

export type ClinicalToolEvidence = {
  readonly citationUuids: ReadonlySet<string>;
  readonly emptyBacked: ReadonlyMap<string, boolean>;
  readonly medRowsForConflict: ReadonlyArray<{ drugLower: string; statusLower: string; uuid: string }>;
  readonly crossPatientLeak: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep scan unknown JSON for `{ source_pack?: { uuid } }` occurrences. */
function collectSourcePackUuids(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSourcePackUuids(item, into);
    }

    return;
  }

  if (!isPlainObject(value)) {
    return;
  }

  const rawSp = value['source_pack'];
  const parsedSp = sourcePackSchema.safeParse(rawSp);
  if (parsedSp.success && parsedSp.data.uuid !== '') {
    into.add(parsedSp.data.uuid);
  }

  for (const v of Object.values(value)) {
    collectSourcePackUuids(v, into);
  }
}

/** Whether an OpenEMR context read returned `{ ok:true, data: [], ...}` for emptiness proofs. */
function isBackedEmpty(ok: unknown, dataUnknown: unknown): boolean {
  if (ok !== true) {
    return false;
  }

  return Array.isArray(dataUnknown) && dataUnknown.length === 0;
}

/**
 * Accumulate citation IDs (source_pack.uuid) and empty-result proofs from SDK tool results / outputs.
 */
export function buildClinicalToolEvidence(
  boundPatientUuid: string,
  toolResults: readonly { type?: string; toolName?: string; input?: unknown; output?: unknown }[],
): ClinicalToolEvidence {
  const citationUuids = new Set<string>();
  const emptyBacked = new Map<string, boolean>();
  const medRows: Array<{ drugLower: string; statusLower: string; uuid: string }> = [];
  let crossPatientLeak = false;

  for (const tr of toolResults) {
    if (tr.type !== 'tool-result') {
      continue;
    }

    const name = tr.toolName;
    const input = tr.input;
    const output = tr.output;

    const patientInInput =
      isPlainObject(input) && typeof input['patient_uuid'] === 'string' ? input['patient_uuid'] : '';
    if (patientInInput !== '' && patientInInput !== boundPatientUuid) {
      crossPatientLeak = true;
    }

    collectSourcePackUuids(output, citationUuids);

    const outOk = isPlainObject(output) ? output['ok'] : undefined;

    const dataSlice = isPlainObject(output) ? output['data'] : undefined;

    if (typeof name === 'string' && dataSlice !== undefined && isBackedEmpty(outOk, dataSlice)) {
      emptyBacked.set(name, true);
    }

    if (
      typeof name === 'string' &&
      name === 'get_meds' &&
      isPlainObject(output) &&
      output['ok'] === true &&
      Array.isArray(dataSlice)
    ) {
      for (const row of dataSlice) {
        if (!isPlainObject(row)) {
          continue;
        }

        const drugRaw = typeof row['drug'] === 'string' ? row['drug'] : '';
        const statRaw =
          typeof row['status_title'] === 'string'
            ? row['status_title']
            : typeof row['status'] === 'string'
              ? row['status']
              : '';

        let uuid = '';
        const spParsed = sourcePackSchema.safeParse(row['source_pack']);
        if (spParsed.success) {
          uuid = spParsed.data.uuid;
        }

        if (uuid !== '') {
          medRows.push({
            drugLower: drugRaw.toLowerCase(),
            statusLower: statRaw.toLowerCase(),
            uuid,
          });
        }
      }
    }

  }

  return { citationUuids, emptyBacked, medRowsForConflict: medRows, crossPatientLeak };
}

/** Last-write-wins lookup for citation UUID → navigation_hint from tool-result JSON payloads. */
export function buildCitationNavigationIndex(
  toolResults: readonly { type?: string; output?: unknown }[],
): Record<string, CitationNavigationHint> {
  const out: Record<string, CitationNavigationHint> = {};

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }

      return;
    }

    if (!isPlainObject(node)) {
      return;
    }

    const rawSp = node['source_pack'];
    const parsedSp = sourcePackSchema.safeParse(rawSp);
    if (parsedSp.success) {
      const uuid = parsedSp.data.uuid;
      if (uuid !== '') {
        const nh = parsedSp.data.navigation_hint;
        out[uuid] = {
          kind: nh.kind,
          params: nh.params as Readonly<Record<string, unknown>>,
        };
      }
    }

    for (const v of Object.values(node)) {
      walk(v);
    }
  }

  for (const tr of toolResults) {
    if (tr.type !== 'tool-result') {
      continue;
    }

    walk(tr.output);
  }

  return out;
}
