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
  /**
   * G2-Final-FB-D-05 — per-chunk quote vs source-text snapshot for the
   * evidence-retriever surface. `quote` is the §6 `SourceCitation.quote_or_value`
   * (truncated to 400 chars before reaching the model); `sourceText` is the
   * chunk's full untruncated text. The verification gate asserts the quote
   * is a substring of sourceText so a regression in the truncation logic
   * (or a model that fabricates a quote off the cited chunk) drops the claim.
   */
  readonly citationQuoteSourceMap: ReadonlyMap<string, { quote: string; sourceText: string }>;
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
  const citationQuoteSourceMap = new Map<string, { quote: string; sourceText: string }>();

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

    // G2-Final-FB-D-05 — capture per-chunk (quote, full source text)
    // pairs from evidence_retrieve outputs so the verification layer can
    // assert the quote is a substring of the chunk's full text.
    if (
      typeof name === 'string' &&
      name === 'evidence_retrieve' &&
      isPlainObject(output) &&
      output['ok'] === true &&
      Array.isArray(output['chunks'])
    ) {
      for (const chunk of output['chunks'] as readonly unknown[]) {
        if (!isPlainObject(chunk)) continue;
        const chunkId =
          typeof chunk['chunk_id'] === 'string' ? (chunk['chunk_id'] as string) : '';
        const fullText = typeof chunk['text'] === 'string' ? (chunk['text'] as string) : '';
        const citation = chunk['citation'];
        let quote = '';
        if (isPlainObject(citation) && typeof citation['quote_or_value'] === 'string') {
          quote = citation['quote_or_value'] as string;
        }
        if (chunkId !== '' && quote !== '' && fullText !== '') {
          citationQuoteSourceMap.set(chunkId, { quote, sourceText: fullText });
        }
      }
    }

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

  return {
    citationUuids,
    emptyBacked,
    medRowsForConflict: medRows,
    crossPatientLeak,
    citationQuoteSourceMap,
  };
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
