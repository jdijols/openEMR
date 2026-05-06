/**
 * §6 / G2-Early-30 — bbox math (pure helpers, jsdom-safe).
 *
 * Lives in its own module so unit tests don't transitively load the
 * pdfjs-dist UMD build (which needs DOMMatrix and other browser globals).
 */

export type BboxNormalized = readonly [number, number, number, number];

/**
 * Map a normalized 0-1 bbox to pixel coordinates given a rendered canvas
 * size. Returns `null` if the bbox is malformed (non-finite or zero-area);
 * the caller should skip rendering the overlay in that case.
 */
export function bboxToPixels(
  bbox: BboxNormalized,
  canvasSize: { width: number; height: number },
): { left: number; top: number; width: number; height: number } | null {
  const [x0, y0, x1, y1] = bbox;
  if (
    !Number.isFinite(x0) || !Number.isFinite(y0) ||
    !Number.isFinite(x1) || !Number.isFinite(y1) ||
    x1 <= x0 || y1 <= y0
  ) {
    return null;
  }
  return {
    left: x0 * canvasSize.width,
    top: y0 * canvasSize.height,
    width: (x1 - x0) * canvasSize.width,
    height: (y1 - y0) * canvasSize.height,
  };
}
