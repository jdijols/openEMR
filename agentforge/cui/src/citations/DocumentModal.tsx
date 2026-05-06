import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { bboxToPixels, type BboxNormalized } from './bbox.js';
import { loadPdfDocument } from './pdfjs.js';
import { useDocumentBytes } from './useDocumentBytes.js';

export type { BboxNormalized } from './bbox.js';

/**
 * §9 / G2-MVP-64 + G2-Early-30 — full-screen modal for displaying the
 * source document at a cited page, with optional yellow bbox overlay
 * highlighting the cited region.
 *
 * Bbox is in normalized 0-1 PDF page coordinates per the §6 SourceCitation
 * schema (`citation.bbox = [x0, y0, x1, y1]`). Position is computed against
 * the rendered canvas dimensions; the highlight is absolutely positioned
 * over the canvas so the PDF rendering path is unchanged.
 *
 * Production note (G2-Final-31): the in-CUI DocumentModal is the test
 * + fallback path. The production overlay uses a host-rendered native
 * iframe (no pdfjs in the host, no buffer-detach bug). The bbox feature
 * exists in this fallback path so the citation contract's "visual PDF
 * bounding-box overlay" requirement is demonstrably met.
 */

export type DocumentModalProps = {
  readonly isOpen: boolean;
  readonly docrefUuid: string | null;
  readonly bytesEndpoint: string;
  readonly sessionToken: string;
  readonly patientUuid: string;
  readonly initialPage?: number;
  /** Normalized 0-1 bbox `[x0, y0, x1, y1]` from `SourceCitation.bbox`. */
  readonly bbox?: BboxNormalized;
  readonly onClose: () => void;
};

export function DocumentModal(props: DocumentModalProps): ReactElement | null {
  const { fetchBytes, state, clear } = useDocumentBytes({
    bytesEndpoint: props.bytesEndpoint,
    sessionToken: props.sessionToken,
    patientUuid: props.patientUuid,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Track the rendered canvas dimensions so the absolutely-positioned bbox
  // overlay (G2-Early-30) can be re-pixelized after each PDF page render.
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  // Fetch bytes when opened.
  useEffect(() => {
    if (props.isOpen && props.docrefUuid !== null) {
      void fetchBytes(props.docrefUuid);
    } else if (!props.isOpen) {
      clear();
      setCanvasSize(null);
    }
  }, [props.isOpen, props.docrefUuid, fetchBytes, clear]);

  // Render PDF page when bytes arrive.
  useEffect(() => {
    let cancelled = false;
    if (state.status !== 'ok' || state.mimeType !== 'application/pdf') {
      return;
    }
    void (async (): Promise<void> => {
      try {
        const pdf = await loadPdfDocument(state.bytes);
        const targetPage = Math.min(Math.max(1, props.initialPage ?? 1), pdf.numPages);
        const page = await pdf.getPage(targetPage);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return;
        }
        // pdfjs-dist 5.x render API requires both `canvas` and `canvasContext`.
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!cancelled) {
          setCanvasSize({ width: viewport.width, height: viewport.height });
        }
      } catch {
        // Render failure — surfaced via the empty canvas; user can close + retry.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state, props.initialPage]);

  // Esc key dismiss.
  useEffect(() => {
    if (!props.isOpen) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.isOpen, props.onClose]);

  // G2-Final-31 — the in-CUI DocumentModal is no longer the production
  // overlay path. App.tsx posts AGENTFORGE_OPEN_DOCUMENT_OVERLAY to the
  // parent shell, which renders a top-level overlay that sits over both
  // the OpenEMR app and the CUI rail without disturbing either layout.
  // This component is preserved for the standalone test path (Vitest)
  // and as a defensive in-CUI fallback if the host listener is ever
  // unavailable.

  if (!props.isOpen) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="document-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
    >
      <div style={{ background: '#fff', maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: '1rem', borderRadius: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button type="button" onClick={props.onClose} aria-label="Close" data-testid="document-modal-close" style={{ all: 'unset', cursor: 'pointer', fontSize: 18, padding: '0 8px' }}>×</button>
        </div>
        {state.status === 'loading' && <div data-testid="document-modal-loading">Loading…</div>}
        {state.status === 'error' && <div data-testid="document-modal-error" style={{ color: '#b00' }}>{state.errorMessage}</div>}
        {state.status === 'ok' && state.mimeType === 'application/pdf' && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <canvas ref={canvasRef} data-testid="document-modal-canvas" />
            {/* G2-Early-30 — yellow bbox highlight overlay. Renders only
                when bbox + canvas size are known and bbox is well-formed. */}
            {(() => {
              if (props.bbox === undefined || canvasSize === null) return null;
              const px = bboxToPixels(props.bbox, canvasSize);
              if (px === null) return null;
              return (
                <div
                  data-testid="document-modal-bbox-overlay"
                  aria-label="Cited region highlight"
                  style={{
                    position: 'absolute',
                    left: `${px.left}px`,
                    top: `${px.top}px`,
                    width: `${px.width}px`,
                    height: `${px.height}px`,
                    background: 'rgba(255, 235, 59, 0.35)',
                    border: '2px solid #f9a825',
                    pointerEvents: 'none',
                  }}
                />
              );
            })()}
          </div>
        )}
        {state.status === 'ok' && state.mimeType.startsWith('image/') && (
          <img alt="Source document" data-testid="document-modal-image" src={URL.createObjectURL(new Blob([new Uint8Array(state.bytes)], { type: state.mimeType }))} style={{ maxWidth: '85vw', maxHeight: '80vh' }} />
        )}
      </div>
    </div>
  );
}
