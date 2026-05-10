/**
 * Phase 2 — `formatPreview(target, payload)` is the single source of truth for
 * the human-readable preview line that renders in the above-composer
 * affordance, in the in-chat resolved-receipt, and (Phase 4) in the bundle
 * review modal.
 *
 * Today the preview string lived only on the tool-result envelope returned by
 * each `propose_*_write` tool — never persisted in `pending_proposals.payload`
 * and re-derived inline at every callsite with subtly different formatting.
 * Phase 2 centralizes the formatting and PERSISTS the result under
 * `payload.preview` so any reader (CUI cache, dashboard direct read via
 * `/proposals/:id`, future cross-session paths) gets the same canonical
 * string without re-deriving.
 *
 * Format rules per target (from the plan's per-target preview spec):
 *
 *   chief_complaint          → first ~50 chars of reason text
 *   chief_complaint_delete   → "Clear chief complaint"
 *   vitals                   → compact key vitals ("BP 120/80 · HR 72 · Wt 180lb")
 *   vitals_delete            → "Void vitals · row <uuid prefix>"
 *   tobacco                  → "Status: <human label>"
 *   clinical_note            → first ~50 chars of text
 *   clinical_note_update     → "Update note · <first ~30 chars>"
 *   clinical_note_delete     → "Delete note"
 *   allergy                  → "<substance> · <reaction> · <severity>" (humanized option_ids)
 *   allergy_delete           → "Remove allergy · row <uuid prefix>" (payload-only fallback)
 *   medication_add           → "<name> <dose> · <frequency>"
 *   medication_discontinue   → "Discontinue · row <uuid prefix>" (payload-only fallback)
 *   family_history_add       → "<relation>: <condition>"
 *   document_delete          → "Remove document · <uuid prefix>" (payload-only fallback)
 *   demographics_update      → "Update <comma-list of changed fields>"
 *   bundle                   → derived from sections (Phase 4 detail)
 *
 * Deletes that only carry a UUID in payload (allergy_delete, vitals_delete,
 * medication_discontinue, document_delete) fall back to a UUID-prefix
 * preview because the human-readable name is on the OpenEMR row, not in the
 * proposal payload. Phase 2.5+ can enrich the propose-tool schemas to ship
 * the display name alongside the UUID; for now the affordance shows enough
 * to disambiguate.
 *
 * Formatters are payload-only: encounter_id, conversation context, and tool
 * input fields beyond payload are intentionally inaccessible. This keeps the
 * helper round-trip-clean — anything readable from `pending_proposals.payload`
 * alone is enough to re-render the preview after a reload or in a different
 * surface.
 */

const TOBACCO_LABELS: Readonly<Record<string, string>> = {
  never_smoker: 'never smoker',
  former_smoker: 'former smoker',
  current_every_day: 'current daily smoker',
  current_some_day: 'current some-day smoker',
  unknown: 'unknown',
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function humanizeOptionId(value: string): string {
  return value
    .trim()
    .replace(/_severity$/, '')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

function capitalizeFirst(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function uuidPrefix(value: string): string {
  return `${value.slice(0, 8)}…`;
}

function formatChiefComplaint(p: Record<string, unknown>): string {
  const reason = asString(p['reason']);
  return reason !== null ? truncate(reason, 50) : 'Chief complaint';
}

function formatVitals(p: Record<string, unknown>): string {
  const parts: string[] = [];
  const bp = asString(p['bp']);
  if (bp !== null) {
    parts.push(`BP ${bp}`);
  }
  const hr = p['hr'];
  if (hr !== undefined && hr !== null && `${hr}`.trim() !== '') {
    parts.push(`HR ${hr}`);
  }
  const temp = p['temp'];
  if (temp !== undefined && temp !== null && `${temp}`.trim() !== '') {
    parts.push(`Temp ${temp}`);
  }
  const weight = p['weight_lb'];
  if (weight !== undefined && weight !== null && `${weight}`.trim() !== '') {
    parts.push(`Wt ${weight}lb`);
  }
  const height = p['height_in'];
  if (height !== undefined && height !== null && `${height}`.trim() !== '') {
    parts.push(`Ht ${height}"`);
  }
  const pain = p['pain'];
  if (pain !== undefined && pain !== null && `${pain}`.trim() !== '') {
    parts.push(`Pain ${pain}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Vitals';
}

function formatVitalsDelete(p: Record<string, unknown>): string {
  const uuid = asString(p['vitals_uuid']);
  return uuid !== null ? `Void vitals · row ${uuidPrefix(uuid)}` : 'Void vitals';
}

function formatTobacco(p: Record<string, unknown>): string {
  const status = asString(p['status']);
  if (status === null) {
    return 'Tobacco status';
  }
  const label = TOBACCO_LABELS[status] ?? humanizeOptionId(status).toLowerCase();
  return `Status: ${label}`;
}

function formatClinicalNote(p: Record<string, unknown>): string {
  const text = asString(p['text']);
  return text !== null ? truncate(text, 50) : 'Clinical note';
}

function formatClinicalNoteUpdate(p: Record<string, unknown>): string {
  const text = asString(p['text']);
  return text !== null ? `Update note · ${truncate(text, 30)}` : 'Update note';
}

function formatAllergyAdd(p: Record<string, unknown>): string {
  const parts: string[] = [];
  const substance = asString(p['substance']);
  if (substance !== null) {
    parts.push(capitalizeFirst(substance));
  }
  const reaction = asString(p['reaction']);
  if (reaction !== null) {
    parts.push(humanizeOptionId(reaction));
  }
  const severity = asString(p['severity']);
  if (severity !== null) {
    parts.push(humanizeOptionId(severity));
  }
  return parts.length > 0 ? parts.join(' · ') : 'New allergy';
}

function formatAllergy(p: Record<string, unknown>): string {
  const action = asString(p['action']) ?? 'add';
  if (action === 'add') {
    return formatAllergyAdd(p);
  }
  if (action === 'update_substance') {
    const substance = asString(p['substance']);
    return substance !== null ? `Update substance → ${capitalizeFirst(substance)}` : 'Update allergy substance';
  }
  if (action === 'update_reaction') {
    const reaction = asString(p['reaction']);
    return reaction !== null ? `Update reaction → ${humanizeOptionId(reaction)}` : 'Update allergy reaction';
  }
  if (action === 'update_severity') {
    const severity = asString(p['severity']);
    return severity !== null ? `Update severity → ${humanizeOptionId(severity)}` : 'Update allergy severity';
  }
  return `Allergy ${action}`;
}

function formatAllergyDelete(p: Record<string, unknown>): string {
  const uuid = asString(p['allergy_uuid']);
  return uuid !== null ? `Remove allergy · row ${uuidPrefix(uuid)}` : 'Remove allergy';
}

function formatMedicationAdd(p: Record<string, unknown>): string {
  const name = asString(p['name']);
  if (name === null) {
    return 'New medication';
  }
  const dose = asString(p['dose']);
  const frequency = asString(p['frequency']);
  const head = dose !== null ? `${name} ${dose}` : name;
  return frequency !== null ? `${head} · ${frequency}` : head;
}

function formatMedicationDiscontinue(p: Record<string, unknown>): string {
  const uuid = asString(p['medication_uuid']);
  return uuid !== null ? `Discontinue · row ${uuidPrefix(uuid)}` : 'Discontinue medication';
}

function formatFamilyHistory(p: Record<string, unknown>): string {
  const relation = asString(p['relation']);
  const condition = asString(p['condition']);
  if (relation === null && condition === null) {
    return 'Family history';
  }
  if (relation === null) {
    return condition!;
  }
  if (condition === null) {
    return capitalizeFirst(relation);
  }
  return `${capitalizeFirst(relation)}: ${truncate(condition, 60)}`;
}

function formatDocumentDelete(p: Record<string, unknown>): string {
  const uuid = asString(p['docref_uuid']);
  return uuid !== null ? `Remove document · ${uuidPrefix(uuid)}` : 'Remove document';
}

function formatDemographicsUpdate(p: Record<string, unknown>): string {
  const fields = Object.keys(p).filter((k) => !k.startsWith('_') && k !== 'preview');
  if (fields.length === 0) {
    return 'Update demographics';
  }
  return `Update ${fields.join(', ')}`;
}

function formatBundle(p: Record<string, unknown>): string {
  // Phase 4 ships a richer derivation off `payload.sections`; for Phase 2
  // tools that don't emit bundles yet, fall back to whatever the bundle
  // assembler stamped into `payload.preview` (or a generic placeholder).
  const stored = asString(p['preview']);
  return stored !== null ? stored : 'Bundle proposal';
}

/**
 * Single source of truth for the affordance preview line.
 *
 * `target` is the `pending_proposals.write_target` value (or `'bundle'` for
 * Phase 4 multi-section proposals). `payload` is `pending_proposals.payload`
 * — strict-shape per target, with `preview` and any leading-underscore
 * metadata keys harmlessly ignored by the per-target formatters.
 *
 * Returns a non-empty string. Unknown targets fall back to the raw target
 * name so a misrouted block is still legible while the regression is fixed.
 */
export function formatPreview(target: string, payload: Record<string, unknown>): string {
  switch (target) {
    case 'chief_complaint':
      return formatChiefComplaint(payload);
    case 'chief_complaint_delete':
      return 'Clear chief complaint';
    case 'vitals':
      return formatVitals(payload);
    case 'vitals_delete':
      return formatVitalsDelete(payload);
    case 'tobacco':
      return formatTobacco(payload);
    case 'clinical_note':
      return formatClinicalNote(payload);
    case 'clinical_note_update':
      return formatClinicalNoteUpdate(payload);
    case 'clinical_note_delete':
      return 'Delete note';
    case 'allergy':
      return formatAllergy(payload);
    case 'allergy_delete':
      return formatAllergyDelete(payload);
    case 'medication_add':
      return formatMedicationAdd(payload);
    case 'medication_discontinue':
      return formatMedicationDiscontinue(payload);
    case 'family_history_add':
      return formatFamilyHistory(payload);
    case 'document_delete':
      return formatDocumentDelete(payload);
    case 'demographics_update':
      return formatDemographicsUpdate(payload);
    case 'bundle':
      return formatBundle(payload);
    default:
      return target;
  }
}
