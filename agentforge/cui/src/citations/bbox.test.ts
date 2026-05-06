/**
 * §6 / G2-Early-30 — bbox→pixel mapping (pure helper, jsdom-safe).
 *
 * Asserts the deterministic positioning math used by DocumentModal's
 * yellow bbox highlight overlay. The actual canvas render path uses
 * pdfjs-dist which doesn't run cleanly under jsdom; this test covers
 * the layout math separately.
 */

import { describe, expect, it } from 'vitest';
import { bboxToPixels } from './bbox.js';

describe('§6 G2-Early-30 — bboxToPixels', () => {
  it('maps a normalized bbox to canvas pixels', () => {
    const px = bboxToPixels([0.1, 0.2, 0.3, 0.4], { width: 800, height: 1000 });
    expect(px).toEqual({ left: 80, top: 200, width: 160, height: 200 });
  });

  it('returns null for an inverted (zero-width) bbox', () => {
    expect(bboxToPixels([0.5, 0.2, 0.5, 0.4], { width: 800, height: 1000 })).toBeNull();
    expect(bboxToPixels([0.5, 0.4, 0.3, 0.4], { width: 800, height: 1000 })).toBeNull();
  });

  it('returns null when any coordinate is non-finite', () => {
    expect(bboxToPixels([NaN, 0, 0.5, 0.5], { width: 800, height: 1000 })).toBeNull();
    expect(bboxToPixels([0, 0, 0.5, Infinity], { width: 800, height: 1000 })).toBeNull();
  });

  it('clamps to full canvas when bbox spans 0..1', () => {
    expect(bboxToPixels([0, 0, 1, 1], { width: 612, height: 792 })).toEqual({
      left: 0,
      top: 0,
      width: 612,
      height: 792,
    });
  });
});
