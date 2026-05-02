/**
 * Per-tab payload cache for the auto-brief — the client-side counterpart
 * to the server-side `case_presentation_cache.ts` rekey to (user_id,
 * patient_uuid).
 *
 * Why a payload cache and not a boolean marker:
 *   The previous `brief_dedupe.ts` stored only a boolean "already fired"
 *   marker per patient. When the rail re-mounted the iframe (panel reload,
 *   refresh-chart, pid-poll re-entry), the new App mount started with
 *   empty React state — so even though the server cache had the brief, the
 *   client refused to ask for it again because the marker said "fired"
 *   and there was no message to re-render. Result: blank rail with no
 *   recovery short of a full reload.
 *
 *   Storing the rendered payload (`blocks`, `citation_navigation`) in
 *   sessionStorage lets a re-mounted App replay the cached brief
 *   immediately into its message list — no network round-trip, no LLM
 *   call, no flicker.
 *
 * Why sessionStorage and not localStorage:
 *   The brief is scoped to a single tab's clinical session, not the
 *   user's account. A second tab opening the same patient deserves a
 *   fresh brief (the server cache will hit anyway via (user_id,
 *   patient_uuid)).
 *
 * Bounds:
 *   - 2-hour TTL matches the server cache; reads past TTL evict.
 *   - 8-patient cap (LRU) keeps the per-tab footprint bounded for
 *     physicians sweeping through a panel of patients.
 */

import type { ChatBlock, CitationNavigationHint } from '../types/chat.js';

const KEY_PREFIX = 'agentforge:brief_payload:';
const INDEX_KEY = 'agentforge:brief_payload:__index';
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PATIENTS = 8;

export type CachedBriefPayload = {
  readonly blocks: ChatBlock[];
  readonly citation_navigation: Record<string, CitationNavigationHint>;
};

type StoredPayload = CachedBriefPayload & { readonly storedAt: number };

export function briefPayloadStorageKey(patientUuid: string): string {
  return `${KEY_PREFIX}${patientUuid}`;
}

function readIndex(): string[] {
  try {
    const raw = window.sessionStorage.getItem(INDEX_KEY);
    if (raw === null || raw === '') {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function writeIndex(index: readonly string[]): void {
  try {
    window.sessionStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* sessionStorage may be unavailable; cache becomes a no-op which
       is acceptable degradation — the server cache still answers. */
  }
}

function touchIndex(patientUuid: string): void {
  const idx = readIndex().filter((p) => p !== patientUuid);
  idx.push(patientUuid);
  while (idx.length > MAX_PATIENTS) {
    const oldest = idx.shift();
    if (oldest === undefined) {
      break;
    }
    try {
      window.sessionStorage.removeItem(briefPayloadStorageKey(oldest));
    } catch {
      /* tolerate */
    }
  }
  writeIndex(idx);
}

function dropFromIndex(patientUuid: string): void {
  const idx = readIndex().filter((p) => p !== patientUuid);
  writeIndex(idx);
}

export function readCachedBrief(patientUuid: string): CachedBriefPayload | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(briefPayloadStorageKey(patientUuid));
  } catch {
    return null;
  }
  if (raw === null || raw === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const stored = parsed as Partial<StoredPayload>;
  if (
    typeof stored.storedAt !== 'number' ||
    !Array.isArray(stored.blocks) ||
    typeof stored.citation_navigation !== 'object' ||
    stored.citation_navigation === null
  ) {
    return null;
  }
  if (Date.now() - stored.storedAt > TTL_MS) {
    try {
      window.sessionStorage.removeItem(briefPayloadStorageKey(patientUuid));
    } catch {
      /* tolerate */
    }
    dropFromIndex(patientUuid);
    return null;
  }
  return {
    blocks: stored.blocks as ChatBlock[],
    citation_navigation: stored.citation_navigation as Record<string, CitationNavigationHint>,
  };
}

export function writeCachedBrief(patientUuid: string, payload: CachedBriefPayload): void {
  const stored: StoredPayload = {
    blocks: payload.blocks,
    citation_navigation: payload.citation_navigation,
    storedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(briefPayloadStorageKey(patientUuid), JSON.stringify(stored));
  } catch {
    /* sessionStorage may be unavailable; degrade silently — the in-flight
       ref + the server cache still prevent duplicate LLM calls within the
       mount, the rail just won't replay across reloads. */
    return;
  }
  touchIndex(patientUuid);
}
