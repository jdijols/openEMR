import { createHash } from 'node:crypto';
import type { ChatBlock } from '../openemr/types.js';
import type { CitationNavigationHint } from './toolEvidence.js';

/** Case-presentation LRU entry lifetime — aligned with client `brief_cache` / `conversation_cache`. */
const TTL_MS = 2 * 60 * 60 * 1000;

type CachedPayload = {
  readonly blocks: ChatBlock[];
  readonly citation_navigation: Record<string, CitationNavigationHint>;
  readonly storedAt: number;
};

const store = new Map<string, CachedPayload>();

/**
 * `encounterId` is part of the key per the post-deploy P3 fix: a brief is
 * encounter-scoped (today's note vs. last visit's note differ materially), and
 * the same `(sessionToken, patientUuid)` can legitimately reach the cache
 * across two encounters when the rail re-mints the launch code mid-session
 * (P2 fix). Without it, the brief for encounter A is silently served for
 * encounter B and the operator has no escape hatch short of waiting out the
 * 2-hour TTL. `null` is its own bucket (no encounter saved yet).
 */
function cacheKey(sessionToken: string, patientUuid: string, encounterId: number | null): string {
  const tok = createHash('sha256').update(sessionToken, 'utf8').digest('hex');
  const enc = encounterId === null ? 'none' : String(encounterId);
  return `${patientUuid}\0${enc}\0${tok}`;
}

export function casePresentationCacheGet(
  sessionToken: string,
  patientUuid: string,
  encounterId: number | null,
): { blocks: ChatBlock[]; citation_navigation: Record<string, CitationNavigationHint> } | null {
  const key = cacheKey(sessionToken, patientUuid, encounterId);
  const hit = store.get(key);
  if (hit === undefined) {
    return null;
  }

  if (Date.now() - hit.storedAt > TTL_MS) {
    store.delete(key);
    return null;
  }

  return { blocks: hit.blocks, citation_navigation: hit.citation_navigation };
}

export function casePresentationCacheSet(
  sessionToken: string,
  patientUuid: string,
  encounterId: number | null,
  payload: {
    readonly blocks: ChatBlock[];
    readonly citation_navigation: Record<string, CitationNavigationHint>;
  },
): void {
  const key = cacheKey(sessionToken, patientUuid, encounterId);
  store.set(key, {
    blocks: payload.blocks,
    citation_navigation: payload.citation_navigation,
    storedAt: Date.now(),
  });
}

/** Test-only: clear cached entries (Vitest isolation). */
export function __resetCasePresentationCacheForTests(): void {
  store.clear();
}
