/**
 * Auto-brief dedupe persistence — keyed by patient_uuid in sessionStorage so a
 * re-mounted iframe does not auto-fire the brief twice for the same patient.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  briefFiredStorageKey,
  markBriefFired,
  readBriefAlreadyFired,
} from './brief_dedupe.js';

afterEach(() => {
  window.sessionStorage.clear();
});

describe('brief_dedupe', () => {
  it('reports unfired before any mark', () => {
    expect(readBriefAlreadyFired('pat-uuid-A')).toBe(false);
  });

  it('marks and re-reads the same patient as fired', () => {
    markBriefFired('pat-uuid-A');
    expect(readBriefAlreadyFired('pat-uuid-A')).toBe(true);
  });

  it('does not bleed across patients', () => {
    markBriefFired('pat-uuid-A');
    expect(readBriefAlreadyFired('pat-uuid-B')).toBe(false);
  });

  it('writes the expected sessionStorage key', () => {
    markBriefFired('pat-uuid-A');
    expect(window.sessionStorage.getItem(briefFiredStorageKey('pat-uuid-A'))).toBe('1');
  });

  it('returns false when sessionStorage throws (privacy / sandboxed iframe)', () => {
    const original = window.sessionStorage.getItem;
    Object.defineProperty(window.sessionStorage, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('sessionStorage unavailable');
      },
    });
    try {
      expect(readBriefAlreadyFired('pat-uuid-A')).toBe(false);
    } finally {
      Object.defineProperty(window.sessionStorage, 'getItem', {
        configurable: true,
        value: original,
      });
    }
  });

  it('swallows write errors silently (in-memory ref still dedupes within a mount)', () => {
    const original = window.sessionStorage.setItem;
    Object.defineProperty(window.sessionStorage, 'setItem', {
      configurable: true,
      value: () => {
        throw new Error('quota exceeded');
      },
    });
    try {
      expect(() => markBriefFired('pat-uuid-A')).not.toThrow();
    } finally {
      Object.defineProperty(window.sessionStorage, 'setItem', {
        configurable: true,
        value: original,
      });
    }
  });
});
