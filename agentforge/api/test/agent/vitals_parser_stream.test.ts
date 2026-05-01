/**
 * Gate 5 G5-05 — vitals parser ingests text built from finalized transcript segments (§9.4).
 */

import { describe, expect, it } from 'vitest';
import { extractVitalsFromTranscript } from '../../src/agent/vitals_parser.js';

describe('extractVitalsFromTranscript (stream simulation)', () => {
  it('parses BP from text accumulated across segment boundaries', () => {
    const segments = ['Vitals.', ' Blood pressure ', '132 over ', '84'];
    const composed = segments.join('');
    const r = extractVitalsFromTranscript(composed);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.values.bp).toBe('132/84');
    }
  });
});
