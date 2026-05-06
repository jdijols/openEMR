import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { loadPdfDocument } from '../citations/pdfjs.js';

/**
 * §9 / G2-MVP-62 — composer attachment preview. PDF first-page renders via
 * pdfjs-dist (with worker preconfigured); PNG/JPEG render natively. PDF
 * render failures fall back to a clean PDF-icon-plus-filename placeholder
 * so the chip never reads as broken/blank.
 *
 * The X (`onRemove`) shows only when the prop is provided — the composer
 * passes it; the sent-message bubble omits it (terminal artifact). The
 * `onClick` makes the whole chip a click target — used by the sent
 * bubble to open DocumentModal at page 1 once the upload has resolved
 * a docref.
 */

export type AttachmentPreviewProps = {
  readonly file: File;
  readonly onRemove?: () => void;
  readonly onClick?: () => void;
  /**
   * When true, render at the small composer-inline size (matches the `+`
   * button footprint) and hide the placeholder filename strip. The PDF
   * thumbnail still renders. Default false (large card variant for the
   * sent-message bubble).
   */
  readonly compact?: boolean;
};

type PdfRenderState = 'idle' | 'rendered' | 'failed';

export function AttachmentPreview(props: AttachmentPreviewProps): ReactElement {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pdfState, setPdfState] = useState<PdfRenderState>('idle');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderPdfFirstPage = async (): Promise<void> => {
      try {
        const buf = await props.file.arrayBuffer();
        const pdf = await loadPdfDocument(new Uint8Array(buf));
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) {
          return;
        }
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          if (!cancelled) setPdfState('failed');
          return;
        }
        // pdfjs-dist 5.x requires both `canvas` and `canvasContext` in
        // RenderParameters (the older shape that omits `canvas` is a
        // type error and a runtime warning).
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (!cancelled) setPdfState('rendered');
      } catch {
        // Surface the failure so the JSX swaps to the placeholder
        // instead of leaving a blank canvas. Rendering may fail for
        // legitimately-corrupt PDFs OR for worker-resolution issues
        // outside our control; either way the operator sees the
        // filename and a PDF glyph, not a void.
        if (!cancelled) setPdfState('failed');
      }
    };

    if (props.file.type === 'application/pdf') {
      setPdfState('idle');
      void renderPdfFirstPage();
    } else if (props.file.type.startsWith('image/')) {
      const url = URL.createObjectURL(props.file);
      setPreviewUrl(url);
      return () => {
        cancelled = true;
        URL.revokeObjectURL(url);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [props.file]);

  const isImage = props.file.type.startsWith('image/');
  const isPdf = props.file.type === 'application/pdf';
  const showPdfPlaceholder = isPdf && pdfState === 'failed';
  const showPdfCanvas = isPdf && !showPdfPlaceholder;

  const compact = props.compact === true;
  const wrapClass = compact ?
    'agentforge-cui__attachment agentforge-cui__attachment--compact'
  : 'agentforge-cui__attachment';

  return (
    <div data-testid="attachment-preview" className={wrapClass}>
      <button
        type="button"
        onClick={props.onClick}
        className="agentforge-cui__attachment-tile"
        aria-label={`Preview ${props.file.name}`}
        disabled={props.onClick === undefined}
      >
        {showPdfCanvas ? (
          <canvas
            ref={canvasRef}
            data-testid="attachment-preview-canvas"
            className="agentforge-cui__attachment-canvas"
          />
        ) : isImage && previewUrl !== null ? (
          <img
            src={previewUrl}
            alt={props.file.name}
            data-testid="attachment-preview-image"
            className="agentforge-cui__attachment-image"
          />
        ) : (
          <span className="agentforge-cui__attachment-placeholder" aria-hidden="true">
            <PdfGlyph />
            {!compact && (
              <span className="agentforge-cui__attachment-filename" title={props.file.name}>
                {props.file.name}
              </span>
            )}
          </span>
        )}
      </button>
      {props.onRemove !== undefined && (
        <button
          type="button"
          data-testid="attachment-remove"
          onClick={props.onRemove}
          aria-label="Remove attachment"
          className="agentforge-cui__attachment-remove"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Plain stroked document-with-fold glyph for the PDF placeholder. Inlined
 * (no icon font) because the panel iframe cannot pull external assets.
 * Uses `currentColor` so it inherits from the surrounding text color.
 */
function PdfGlyph(): ReactElement {
  return (
    <svg
      className="agentforge-cui__attachment-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 14h6M9 17h4" />
    </svg>
  );
}
