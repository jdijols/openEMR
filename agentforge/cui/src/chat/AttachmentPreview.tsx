import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * §9 / G2-MVP-62 — composer attachment preview. PDF first-page renders via
 * pdfjs-dist; PNG/JPEG render natively. Shows an X (`onRemove`) only when
 * the prop is provided.
 */

export type AttachmentPreviewProps = {
  readonly file: File;
  readonly onRemove?: () => void;
  readonly onClick?: () => void;
};

export function AttachmentPreview(props: AttachmentPreviewProps): ReactElement {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderPdfFirstPage = async (): Promise<void> => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const buf = await props.file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
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
          return;
        }
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch {
        // pdfjs failure → keep canvas blank, fall back to filename label.
      }
    };

    if (props.file.type === 'application/pdf') {
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

  return (
    <div data-testid="attachment-preview" className="agentforge-cui__attachment" style={{ position: 'relative', display: 'inline-block', width: 80, height: 96 }}>
      <button type="button" onClick={props.onClick} style={{ all: 'unset', cursor: props.onClick ? 'pointer' : 'default', display: 'block', width: '100%', height: '100%' }} aria-label={`Preview ${props.file.name}`}>
        {isPdf ? (
          <canvas ref={canvasRef} data-testid="attachment-preview-canvas" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' }} />
        ) : isImage && previewUrl !== null ? (
          <img src={previewUrl} alt={props.file.name} data-testid="attachment-preview-image" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, border: '1px solid #ddd' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: '#f3f4f6', borderRadius: 4, fontSize: '0.75rem', textAlign: 'center', padding: 4 }}>{props.file.name}</div>
        )}
      </button>
      {props.onRemove !== undefined && (
        <button type="button" data-testid="attachment-remove" onClick={props.onRemove} aria-label="Remove attachment" style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: '1px solid #999', background: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '18px', textAlign: 'center', padding: 0 }}>
          ×
        </button>
      )}
    </div>
  );
}
