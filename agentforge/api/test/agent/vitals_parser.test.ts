/**
 * Gate 4 / PRD §9.4.2 — vitals deterministic parser exemplars + ambiguity paths.
 */

import { describe, expect, it } from 'vitest';
import { extractVitalsFromTranscript } from '../../src/agent/vitals_parser.js';

describe('extractVitalsFromTranscript (§9.4.1 exemplars)', () => {
  it('parses digit BP slashes and “over”', () => {
    expect(extractVitalsFromTranscript('BP 132/84')).toEqual({
      status: 'ok',
      values: { bp: '132/84' },
    });
    expect(extractVitalsFromTranscript('blood pressure 132 over 84')).toEqual({
      status: 'ok',
      values: expect.objectContaining({ bp: '132/84' }),
    });
  });

  it('parses dictated English BP halves', () => {
    expect(extractVitalsFromTranscript('BP ninety eight over sixty two')).toEqual({
      status: 'ok',
      values: { bp: '98/62' },
    });

    expect(
      extractVitalsFromTranscript('heard BP one thirty-two over eighty-four in dictation.'),
    ).toEqual({
      status: 'ok',
      values: { bp: '132/84' },
    });
  });

  it('parses pulse / temperature / pain / weight / height patterns', () => {
    expect(extractVitalsFromTranscript('heart rate 78')).toEqual({
      status: 'ok',
      values: { hr: 78 },
    });
    expect(extractVitalsFromTranscript('temp 98.6')).toEqual({
      status: 'ok',
      values: { temp_f: 98.6 },
    });
    expect(extractVitalsFromTranscript('pain 3 out of 10')).toEqual({
      status: 'ok',
      values: { pain: 3 },
    });
    expect(extractVitalsFromTranscript('pain 3 of 10')).toEqual({
      status: 'ok',
      values: { pain: 3 },
    });
    expect(extractVitalsFromTranscript('weight 180 lbs')).toEqual({
      status: 'ok',
      values: { weight_lb: 180 },
    });
    expect(extractVitalsFromTranscript('weight 180 pounds')).toEqual({
      status: 'ok',
      values: { weight_lb: 180 },
    });
    expect(extractVitalsFromTranscript('180 lbs')).toEqual({
      status: 'ok',
      values: { weight_lb: 180 },
    });

    expect(extractVitalsFromTranscript('height five foot ten')).toEqual({
      status: 'ok',
      values: { height_in: 70 },
    });
    expect(extractVitalsFromTranscript("height 5'10\"")).toEqual({
      status: 'ok',
      values: { height_in: 70 },
    });
  });

  it('returns uncertain when temporal ambiguity collides with vitals cues', () => {
    const out = extractVitalsFromTranscript(
      'The blood pressure was 160 over 90 last time and we need today’s repeat.',
    );
    expect(out).toEqual({
      status: 'uncertain',
      reason: 'temporal_ambiguity',
    });
  });
});
