import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';
import { useDocumentBytes } from './useDocumentBytes.js';

/**
 * §9 / G2-MVP-64 — full-screen modal for displaying the source document at
 * a cited page. PDF rendering uses pdfjs-dist; PNG/JPEG render inline.
 *
 * Bbox highlight overlay deferred to G2-Early-30 per cut-tier 2.
 */

export type DocumentModalProps = {
  readonly isOpen: boolean;
  readonly docrefUuid: string | null;
  readonly bytesEndpoint: string;
  readonly sessionToken: string;
  readonly patientUuid: string;
  readonly initialPage?: number;
  readonly onClose: () => void;
};

export function DocumentModal(props: DocumentModalProps): ReactElement | null {
  const { fetchBytes, state, clear } = useDocumentBytes({
    bytesEndpoint: props.bytesEndpoint,
    sessionToken: props.sessionToken,
    patientUuid: props.patientUuid,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch bytes when opened.
  useEffect(() => {
    if (props.isOpen && props.docrefUuid !== null) {
      void fetchBytes(props.docrefUuid);
    } else if (!props.isOpen) {
      clear();
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
        const pdfjs = await import('pdfjs-dist');
        const pdf = await pdfjs.getDocument({ data: state.bytes }).promise;
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
        await page.render({ canvasContext: ctx, viewport }).promise;
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
          <canvas ref={canvasRef} data-testid="document-modal-canvas" />
        )}
        {state.status === 'ok' && state.mimeType.startsWith('image/') && (
          <img alt="Source document" data-testid="document-modal-image" src={URL.createObjectURL(new Blob([new Uint8Array(state.bytes)], { type: state.mimeType }))} style={{ maxWidth: '85vw', maxHeight: '80vh' }} />
        )}
      </div>
    </div>
  );
}
