/**
 * Per-tab payload cache for the auto-brief — replaces the old boolean
 * dedupe marker. Tests cover read/write round-trip, TTL expiry, the
 * 8-patient LRU cap, sessionStorage failure tolerance, and isolation
 * across patients.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  briefPayloadStorageKey,
  readCachedBrief,
  writeCachedBrief,
  type CachedBriefPayload,
} from './brief_cache.js';
import type { ChatBlock, CitationNavigationHint } from '../types/chat.js';

function samplePayload(text = 'Hello'): CachedBriefPayload {
  const blocks: ChatBlock[] = [{ type: 'text', text }];
  const citation_navigation: Record<string, CitationNavigationHint> = {
    'sp-1': { kind: 'chart_section', params: { section: 'demographics' } },
  };
  return { blocks, citation_navigation };
}

afterEach(() => {
  window.sessionStorage.clear();
  vi.useRealTimers();
});

describe('brief_cache', () => {
  it('returns null before any write', () => {
    expect(readCachedBrief('pat-A')).toBeNull();
  });

  it('round-trips a payload through sessionStorage', () => {
    const payload = samplePayload('round-trip');
    writeCachedBrief('pat-A', payload);
    const out = readCachedBrief('pat-A');
    expect(out).not.toBeNull();
    expect(out?.blocks).toEqual(payload.blocks);
    expect(out?.citation_navigation).toEqual(payload.citation_navigation);
  });

  it('does not bleed across patients', () => {
    writeCachedBrief('pat-A', samplePayload('A'));
    expect(readCachedBrief('pat-B')).toBeNull();
  });

  it('expires past the 2-hour TTL', () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    writeCachedBrief('pat-A', samplePayload('expires'));

    vi.setSystemTime(start + 2 * 60 * 60 * 1000 + 1);
    expect(readCachedBrief('pat-A')).toBeNull();
    expect(window.sessionStorage.getItem(briefPayloadStorageKey('pat-A'))).toBeNull();
  });

  it('still returns a fresh entry just inside the TTL', () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);
    writeCachedBrief('pat-A', samplePayload('fresh'));

    vi.setSystemTime(start + 2 * 60 * 60 * 1000 - 1);
    expect(readCachedBrief('pat-A')).not.toBeNull();
  });

  it('evicts the least-recently-written patient past the 8-patient cap', () => {
    for (let i = 0; i < 9; i++) {
      writeCachedBrief(`pat-${i}`, samplePayload(`b-${i}`));
    }
    // First inserted entry is evicted; later entries survive.
    expect(readCachedBrief('pat-0')).toBeNull();
    for (let i = 1; i < 9; i++) {
      expect(readCachedBrief(`pat-${i}`)).not.toBeNull();
    }
  });

  it('promotes a patient on rewrite so it is no longer the LRU eviction candidate', () => {
    for (let i = 0; i < 8; i++) {
      writeCachedBrief(`pat-${i}`, samplePayload(`b-${i}`));
    }
    // Touch pat-0 by rewriting; it should NOT be evicted by the next insert.
    writeCachedBrief('pat-0', samplePayload('refreshed'));
    writeCachedBrief('pat-new', samplePayload('new'));
    expect(readCachedBrief('pat-0')).not.toBeNull();
    expect(readCachedBrief('pat-1')).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    window.sessionStorage.setItem(briefPayloadStorageKey('pat-A'), 'not-json');
    expect(readCachedBrief('pat-A')).toBeNull();
  });

  it('returns null when sessionStorage.getItem throws', () => {
    const original = window.sessionStorage.getItem;
    Object.defineProperty(window.sessionStorage, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('sessionStorage unavailable');
      },
    });
    try {
      expect(readCachedBrief('pat-A')).toBeNull();
    } finally {
      Object.defineProperty(window.sessionStorage, 'getItem', {
        configurable: true,
        value: original,
      });
    }
  });

  it('swallows write errors silently when sessionStorage is unavailable', () => {
    const original = window.sessionStorage.setItem;
    Object.defineProperty(window.sessionStorage, 'setItem', {
      configurable: true,
      value: () => {
        throw new Error('quota exceeded');
      },
    });
    try {
      expect(() => writeCachedBrief('pat-A', samplePayload())).not.toThrow();
    } finally {
      Object.defineProperty(window.sessionStorage, 'setItem', {
        configurable: true,
        value: original,
      });
    }
  });
});
