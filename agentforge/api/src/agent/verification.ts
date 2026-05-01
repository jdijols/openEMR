import type { Observability } from '../observability/index.js';
import type { ChatBlock } from '../openemr/types.js';
import type { ClinicalToolEvidence } from './toolEvidence.js';

const NEGATIVE_ALLERGY_PATTERN = /\b(no|without|denies)\b.+allerg/i;
const NEGATIVE_LABS_PATTERN = /\bno\s+(recent\s+)?labs?\b|\b(without\s+).*\blabs?\b/i;

async function emitCategory(obs: Observability, correlationId: string, category: string): Promise<void> {
  await obs.recordToolCall({ correlationId, toolName: 'verification', meta: { category } });
}

/**
 * BP string parser for §9.2 defense-in-depth (numeric ranges). Returns violated vital key or null.
 */
export function detectImpossibleBloodPressure(bp: string): string | null {
  const trimmed = bp.trim();
  const m =
    /^(\d{2,3})\s*[/]\s*(\d{2,3})$/u.exec(trimmed) ??
    /^(\d{2,3})\s+over\s+(\d{2,3})$/iu.exec(trimmed);
  if (!m) {
    return null;
  }

  const sys = Number(m[1]);
  const dia = Number(m[2]);
  if (Number.isNaN(sys) || Number.isNaN(dia)) {
    return null;
  }

  // PRD §9.2.3 ranges — systolic [40,300], diastolic [20,200]
  if (sys < 40 || sys > 300 || dia < 20 || dia > 200) {
    return 'impossible_vital';
  }

  return null;
}

type ClaimBlock = Extract<ChatBlock, { type: 'claim' }>;

function claimBody(b: ClaimBlock): { readonly fullText: string; readonly citationIds: readonly string[] } {
  if ('segments' in b && b.segments !== undefined && b.segments.length > 0) {
    return {
      fullText: b.segments.map((s) => s.text).join(''),
      citationIds: b.segments.filter((s) => s.type === 'cite').map((s) => s.citation_id),
    };
  }

  return {
    fullText: b.text ?? '',
    citationIds: b.citation_ids ?? [],
  };
}

function citesAny(claimIds: readonly string[], cited: ReadonlySet<string>): boolean {
  if (claimIds.length === 0) {
    return false;
  }

  return claimIds.some((id) => cited.has(id));
}

function backingForNegativeAllergies(ev: ClinicalToolEvidence): boolean {
  return ev.emptyBacked.get('get_allergies') === true;
}

function backingForNegativeLabs(ev: ClinicalToolEvidence): boolean {
  return ev.emptyBacked.get('get_labs') === true;
}

/**
 * Gates 3–6 — deterministic verification pipeline (§9.1 §9.2 §9.3 slices).
 */
export async function verifyClinicalBlocks(
  obs: Observability,
  correlationId: string,
  blocks: ChatBlock[],
  evidence: ClinicalToolEvidence,
): Promise<ChatBlock[]> {
  if (evidence.crossPatientLeak) {
    await emitCategory(obs, correlationId, 'verification.cross_patient_block');
    return [{ type: 'refusal', reason: 'blocked_cross_patient_tool_args' }];
  }

  let strippedUncited = 0;
  const out: ChatBlock[] = [];

  for (const b of blocks) {
    if (b.type !== 'claim') {
      out.push(b);
      continue;
    }

    const { fullText: text, citationIds } = claimBody(b);

    if (NEGATIVE_ALLERGY_PATTERN.test(text) && !backingForNegativeAllergies(evidence)) {
      await emitCategory(obs, correlationId, 'verification.negative_claim_removed');
      strippedUncited++;
      continue;
    }

    if (NEGATIVE_LABS_PATTERN.test(text) && !backingForNegativeLabs(evidence)) {
      await emitCategory(obs, correlationId, 'verification.negative_claim_removed');
      strippedUncited++;
      continue;
    }

    const medConflict = evaluateMedInactiveConflict(text, citationIds, evidence);
    const citedOk = citesAny(citationIds, evidence.citationUuids);

    if (!citedOk) {
      strippedUncited++;
      await emitCategory(obs, correlationId, 'verification.uncited_claim_removed');
      continue;
    }

    if (medConflict !== null) {
      await emitCategory(obs, correlationId, 'verification.med_status_conflict_warning');
      out.push({ type: 'warning', text: medConflict });
    }

    if ('segments' in b && b.segments !== undefined && b.segments.length > 0) {
      out.push(b);
    } else {
      out.push({ ...b, text });
    }
  }

  const nonEmptyClinical = out.some(
    (x) =>
      x.type === 'claim' ||
      x.type === 'text' ||
      x.type === 'tool_call' ||
      x.type === 'tool_result' ||
      x.type === 'warning',
  );

  if (!nonEmptyClinical) {
    await emitCategory(obs, correlationId, 'verification.uncited_claim_removed');

    return [{ type: 'refusal', reason: 'insufficient_evidence_after_verification' }];
  }

  if (strippedUncited > 0) {
    await emitCategory(obs, correlationId, 'verification.uncited_claim_removed_summary');
  }

  return out;
}

function evaluateMedInactiveConflict(
  claimText: string,
  citationIds: readonly string[] | undefined,
  evidence: ClinicalToolEvidence,
): string | null {
  const lower = claimText.toLowerCase();
  if (!/currently\s+taking|active\s+medication|still\s+on\b/i.test(lower)) {
    return null;
  }

  const ids = citationIds ?? [];

  for (const row of evidence.medRowsForConflict) {
    if (!ids.includes(row.uuid)) {
      continue;
    }

    if (row.statusLower.includes('inactive') || row.statusLower.includes('discontinu')) {
      const drug = row.drugLower.trim();
      if (drug !== '' && lower.includes(drug)) {
        return 'Source medication row indicates this drug is inactive; verify before relying on chronic-use language.';
      }
    }
  }

  return null;
}
