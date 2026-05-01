import { createHash } from 'node:crypto';
import type { ChatBlock } from '../openemr/types.js';
import type { CitationNavigationHint } from './toolEvidence.js';

const TTL_MS = 30 * 60 * 1000;

type CachedPayload = {
  readonly blocks: ChatBlock[];
  readonly citation_navigation: Record<string, CitationNavigationHint>;
  readonly storedAt: number;
};

const store = new Map<string, CachedPayload>();

function cacheKey(sessionToken: string, patientUuid: string): string {
  const tok = createHash('sha256').update(sessionToken, 'utf8').digest('hex');
  return `${patientUuid}\0${tok}`;
}

export function casePresentationCacheGet(
  sessionToken: string,
  patientUuid: string,
): { blocks: ChatBlock[]; citation_navigation: Record<string, CitationNavigationHint> } | null {
  const key = cacheKey(sessionToken, patientUuid);
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
  payload: {
    readonly blocks: ChatBlock[];
    readonly citation_navigation: Record<string, CitationNavigationHint>;
  },
): void {
  const key = cacheKey(sessionToken, patientUuid);
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
