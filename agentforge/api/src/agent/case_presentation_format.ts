import type { ChatBlock, ContextRow } from '../openemr/types.js';
import type { CasePresentationFetched } from './case_presentation_fetch.js';

export type PriorVisitSummary = Readonly<{
  citationUuid: string;
  summary: string;
}>;

export type PriorVisitSummaryInput = Readonly<{
  citation_uuid: string;
  encounterId: number | null;
  date: string;
  reason: string;
  notes: readonly Record<string, unknown>[];
  vitals: readonly Record<string, unknown>[];
  labs: readonly Record<string, unknown>[];
}>;

function readString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

function readNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function dateKey(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function sourceUuid(row: ContextRow): string {
  return row.source_pack.uuid;
}

function encounterId(row: ContextRow): number | null {
  return readNumber(row, 'eid');
}

function encounterDate(row: ContextRow): string {
  return dateKey(readString(row, 'date'));
}

function recordedAt(row: ContextRow): string {
  return dateKey(readString(row, 'recorded_at'));
}

export function findCurrentEncounter(
  encounters: readonly ContextRow[],
  encounterIdClaim: number | null,
  today: string,
): ContextRow | null {
  if (encounterIdClaim !== null) {
    const byId = encounters.find((row) => encounterId(row) === encounterIdClaim);
    if (byId !== undefined) {
      return byId;
    }
  }

  return encounters.find((row) => encounterDate(row) === today) ?? null;
}

export function previousEncounters(
  encounters: readonly ContextRow[],
  current: ContextRow | null,
): readonly ContextRow[] {
  if (current === null) {
    return encounters.slice(0, 3);
  }

  const currentId = encounterId(current);
  const currentUuid = sourceUuid(current);
  const currentIndex = encounters.findIndex((row) => {
    const rowId = encounterId(row);
    return (currentId !== null && rowId === currentId) || sourceUuid(row) === currentUuid;
  });

  const candidates =
    currentIndex >= 0 ?
      encounters.slice(currentIndex + 1)
    : encounters.filter((row) => {
        const rowId = encounterId(row);
        return !((currentId !== null && rowId === currentId) || sourceUuid(row) === currentUuid);
      });

  return candidates.slice(0, 3);
}

function vitalsRowEncounterId(row: ContextRow): number | null {
  const fromEncounterId = readNumber(row, 'encounter_id');
  if (fromEncounterId !== null) {
    return fromEncounterId;
  }
  return readNumber(row, 'eid');
}

function matchesOpenEncounterVitalsRow(row: ContextRow, openEncounterId: number | null, openEncounterDate: string): boolean {
  if (openEncounterId !== null) {
    const rowEid = vitalsRowEncounterId(row);
    if (rowEid !== null && rowEid === openEncounterId) {
      return true;
    }
  }

  if (openEncounterDate === '') {
    return false;
  }

  const rowDate = recordedAt(row) || dateKey(readString(row, 'date'));
  return rowDate === openEncounterDate;
}

/**
 * Per-vital display formatters. The OpenEMR vitals table stores most numerics as DECIMAL with
 * trailing zeros (e.g. "58.000000"); raw rendering produced "HR 58.000000" in the rail. Each
 * formatter returns the display string for the value — `null` to omit the part entirely.
 *
 * Units are fixed to US/imperial because OpenEMR's default vitals form captures °F, lb, in.
 * The `oxygen_saturation` column already represents a percentage (0–100), not a fraction.
 */
function formatIntegerVital(label: string, value: string, unit: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${label} ${Math.round(n)}${unit}`;
}

function formatDecimalVital(label: string, value: string, unit: string, decimals: number): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${label} ${n.toFixed(decimals)}${unit}`;
}

/** "70" inches → "5'10\"". Whole feet only when remainder is 0. */
function formatHeightInches(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const totalInches = Math.round(n);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  if (feet <= 0) return `Ht ${inches}"`;
  if (inches === 0) return `Ht ${feet}'`;
  return `Ht ${feet}'${inches}"`;
}

function vitalParts(row: ContextRow): string[] {
  const bps = readString(row, 'bps').trim();
  const bpd = readString(row, 'bpd').trim();
  const parts: string[] = [];
  if (bps !== '' && bpd !== '') {
    const bpsN = Number(bps);
    const bpdN = Number(bpd);
    if (Number.isFinite(bpsN) && Number.isFinite(bpdN) && bpsN > 0 && bpdN > 0) {
      parts.push(`BP ${Math.round(bpsN)}/${Math.round(bpdN)}`);
    }
  }

  const formatters: ReadonlyArray<readonly [string, (value: string) => string | null]> = [
    ['pulse', (v) => formatIntegerVital('HR', v, '')],
    ['respiration', (v) => formatIntegerVital('RR', v, '')],
    ['temperature', (v) => formatDecimalVital('Temp', v, '°F', 1)],
    ['oxygen_saturation', (v) => formatIntegerVital('SpO2', v, '%')],
    ['pain', (v) => formatIntegerVital('Pain', v, '')],
    ['weight', (v) => formatIntegerVital('Wt', v, ' lb')],
    ['height', (v) => formatHeightInches(v)],
    ['BMI', (v) => formatDecimalVital('BMI', v, '', 1)],
  ];

  for (const [key, fmt] of formatters) {
    const value = readString(row, key).trim();
    if (value === '') continue;
    const formatted = fmt(value);
    if (formatted !== null) {
      parts.push(formatted);
    }
  }

  const note = readString(row, 'note').trim();
  if (note !== '') {
    parts.push(`Note: ${note}`);
  }

  return parts;
}

function openEncounterVitalsBlocks(
  vitals: readonly ContextRow[],
  currentEncounter: ContextRow | null,
): ChatBlock[] {
  if (currentEncounter === null) {
    return [];
  }

  const openId = encounterId(currentEncounter);
  const openDate = encounterDate(currentEncounter);
  const scopedRows = vitals.filter((row) => matchesOpenEncounterVitalsRow(row, openId, openDate));
  const blocks: ChatBlock[] = [];

  for (const row of scopedRows) {
    const parts = vitalParts(row);
    if (parts.length === 0) {
      continue;
    }

    blocks.push({
      type: 'claim',
      segments: [
        { type: 'text', text: 'Vitals: ' },
        ...parts.flatMap((part, index) => [
          ...(index > 0 ? [{ type: 'text' as const, text: ', ' }] : []),
          { type: 'cite' as const, text: part, citation_id: sourceUuid(row) },
        ]),
        { type: 'text', text: '.' },
      ],
    });
  }

  return blocks;
}

function summaryByCitationUuid(summaries: readonly PriorVisitSummary[]): ReadonlyMap<string, string> {
  const byUuid = new Map<string, string>();
  for (const summary of summaries) {
    const trimmed = summary.summary.trim();
    if (trimmed !== '') {
      byUuid.set(summary.citationUuid, trimmed);
    }
  }
  return byUuid;
}

function fallbackPriorSummary(encounter: ContextRow): string {
  const reason = readString(encounter, 'reason').trim();
  if (reason !== '') {
    return reason;
  }

  const category = readString(encounter, 'visit_category').trim();
  if (category !== '') {
    return category;
  }

  return 'No visit details recorded.';
}

export function buildPriorVisitSummaryInput(
  fetched: CasePresentationFetched,
  previous: readonly ContextRow[],
): readonly PriorVisitSummaryInput[] {
  return previous.map((encounter) => {
    const id = encounterId(encounter);
    const date = encounterDate(encounter);
    const matchesEncounter = (row: ContextRow): boolean => {
      const rawEncounterId = readNumber(row, 'encounter_id');
      return id !== null && rawEncounterId === id;
    };
    const matchesDate = (row: ContextRow): boolean => {
      const rowDate = recordedAt(row) || dateKey(readString(row, 'date')) || dateKey(readString(row, 'document_date'));
      return date !== '' && rowDate === date;
    };

    return {
      citation_uuid: sourceUuid(encounter),
      encounterId: id,
      date,
      reason: readString(encounter, 'reason'),
      notes: fetched.notes_metadata.filter((row) => matchesEncounter(row)).map((row) => ({ ...row })),
      vitals: fetched.vitals.filter((row) => matchesOpenEncounterVitalsRow(row, id, date)).map((row) => ({ ...row })),
      labs: fetched.labs.filter((row) => matchesDate(row)).map((row) => ({ ...row })),
    };
  });
}

export function buildSimplifiedCasePresentationBlocks(
  fetched: CasePresentationFetched,
  encounterIdClaim: number | null,
  priorSummaries: readonly PriorVisitSummary[],
): ChatBlock[] {
  const today = typeof fetched.bundleForLlm['today'] === 'string' ? fetched.bundleForLlm['today'] : '';
  const current = findCurrentEncounter(fetched.encounters, encounterIdClaim, today);
  const previous = previousEncounters(fetched.encounters, current);
  const summaries = summaryByCitationUuid(priorSummaries);
  const blocks: ChatBlock[] = [{ type: 'text', text: '### Reason for visit' }];

  if (current !== null) {
    const reason = readString(current, 'reason');
    if (reason.trim() !== '') {
      blocks.push({
        type: 'claim',
        segments: [{ type: 'cite', text: reason, citation_id: sourceUuid(current) }],
      });
    } else {
      blocks.push({ type: 'text', text: 'No reason for visit recorded.' });
    }
  } else {
    blocks.push({ type: 'text', text: 'No current encounter found.' });
  }

  blocks.push({ type: 'text', text: '### Recorded most recently' });
  const recentVitals = openEncounterVitalsBlocks(fetched.vitals, current);
  if (recentVitals.length > 0) {
    blocks.push(...recentVitals);
  } else {
    blocks.push({ type: 'text', text: 'None recorded for this visit.' });
  }

  blocks.push({ type: 'text', text: '### Previous visits' });
  if (previous.length === 0) {
    blocks.push({ type: 'text', text: 'No previous visits found.' });
    return blocks;
  }

  for (const encounter of previous) {
    const uuid = sourceUuid(encounter);
    const date = encounterDate(encounter) || 'Date unknown';
    const summary = summaries.get(uuid) ?? fallbackPriorSummary(encounter);
    blocks.push({
      type: 'claim',
      segments: [
        { type: 'cite', text: date, citation_id: uuid },
        { type: 'text', text: ` - ${summary}` },
      ],
    });
  }

  return blocks;
}
