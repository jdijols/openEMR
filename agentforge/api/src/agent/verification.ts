/**
 * Clinical verification layer — runs after the LLM produces its draft response
 * and after every tool call has returned. Strips uncited claims, blocks unbacked
 * negative statements, flags impossible vitals, and warns on medication-status
 * conflicts. If every block in a turn is stripped, returns a single refusal.
 *
 * Four layers, each anchored to a PRD section:
 *   1. Citation enforcement (§9.1) — every claim cites a tool-result UUID.
 *   2. Negative-claim backing (§9.3) — "no allergies on file" requires an
 *      empty-query observation; otherwise the claim is stripped.
 *   3. BP range guard (§9.2.3) — defense-in-depth numeric parser; flags
 *      systolic outside [40,300] or diastolic outside [20,200].
 *   4. Medication-inactive warning — claims of chronic-use language that cite
 *      a row marked inactive/discontinued surface as a warning, not a strip.
 *
 * Cross-patient leak short-circuits before any block is examined and returns
 * `blocked_cross_patient_tool_args`.
 *
 * Architectural story, known limitations, and interview-defense framing live
 * in VERIFICATION.md at repo root.
 */

import type { Observability } from '../observability/index.js';
import type { ChatBlock } from '../openemr/types.js';
import type { ClinicalToolEvidence } from './toolEvidence.js';

const NEGATIVE_ALLERGY_PATTERN = /\b(no|without|denies)\b.+allerg/i;
const NEGATIVE_LABS_PATTERN = /\bno\s+(recent\s+)?labs?\b|\b(without\s+).*\blabs?\b/i;

async function emitCategory(obs: Observability, correlationId: string, category: string): Promise<void> {
  await obs.recordEvent({ correlationId, name: `verification.${category}`, meta: { category } });
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
 *
 * LIMITATION (fidelity drift): citation enforcement guarantees every claim has
 * a matching tool-result UUID, but does not check that the claim's prose
 * accurately represents the cited row's values. A model that quotes a wrong
 * dose for a correctly-cited medication will pass verification. Defense
 * against this requires a structured-extraction pass and is deferred to V2.
 * See VERIFICATION.md §"What verification does NOT catch" §1.
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

    // G2-Final-FB-D-05 — quote-drift check. For every cited chunk that
    // we have a (quote, sourceText) snapshot for, the quote MUST be a
    // substring of the full chunk text. Catches truncation regressions
    // and post-rerank quote drift. Claims that fail are dropped (not
    // warning-tagged) — drifted quotes are an evidence-integrity failure,
    // not a hint.
    if (hasQuoteDrift(citationIds, evidence)) {
      strippedUncited++;
      await emitCategory(obs, correlationId, 'quote_drift_removed');
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
      x.type === 'warning' ||
      x.type === 'extraction',
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

/**
 * G2-Final-FB-D-05 — true if any of the claim's cited chunks shows
 * `quote_or_value` NOT contained in the chunk's full source text. Cited
 * chunks the evidence layer doesn't have a snapshot for (non-retrieval
 * citations: lab_pdf rows, openemr_record rows, etc.) are skipped — they
 * have their own verification surface (S14 PDF cross-check for lab_pdf).
 */
function hasQuoteDrift(citationIds: readonly string[], evidence: ClinicalToolEvidence): boolean {
  // Older test fixtures construct ClinicalToolEvidence without the new
  // map; treat absent as "no snapshots to verify against."
  const map = evidence.citationQuoteSourceMap;
  if (citationIds.length === 0 || map === undefined) {
    return false;
  }
  for (const id of citationIds) {
    const snapshot = map.get(id);
    if (snapshot === undefined) {
      continue;
    }
    if (!snapshot.sourceText.includes(snapshot.quote)) {
      return true;
    }
  }
  return false;
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
