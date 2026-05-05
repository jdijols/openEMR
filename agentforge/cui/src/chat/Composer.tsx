import type { ChangeEvent, DragEvent, FormEvent, ReactElement } from 'react';
import { useRef, useState } from 'react';
import { AttachmentPreview } from './AttachmentPreview.js';
import { ErrorBanner } from './ErrorBanner.js';
import { validateFileBasic } from './useFileValidation.js';

/**
 * §9 / G2-MVP-61 — chat composer with file-attachment state machine.
 *
 * States: empty → has-file. Plus icon hidden when has-file. Drag-drop on
 * the composer area highlights with a dashed border. X removes the file.
 * Invalid file → ErrorBanner (auto-fades 4 s) and the file is not attached.
 */

export type ComposerProps = {
  readonly onSubmit: (args: { readonly text: string; readonly file: File | null }) => void;
  readonly disabled?: boolean;
  readonly placeholder?: string;
};

export function Composer(props: ComposerProps): ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const acceptFile = (f: File | null): void => {
    if (f === null) {
      setFile(null);
      return;
    }
    const result = validateFileBasic(f);
    if (!result.ok) {
      setError(result.errorMessage);
      return;
    }
    setError(null);
    setFile(f);
  };

  const onFilePick = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0] ?? null;
    acceptFile(f);
    e.target.value = '';
  };

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    acceptFile(f);
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (props.disabled) {
      return;
    }
    if (text.trim().length === 0 && file === null) {
      return;
    }
    props.onSubmit({ text: text.trim(), file });
    setText('');
    setFile(null);
  };

  return (
    <form data-testid="composer" onSubmit={onSubmit} className="agentforge-cui__composer" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.5rem', border: dragOver ? '2px dashed #2563eb' : '1px solid #ddd', borderRadius: 6, background: '#fff' }}>
      {error !== null && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {file !== null && (
        <div>
          <AttachmentPreview file={file} onRemove={() => setFile(null)} />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {file === null && (
          <button type="button" data-testid="composer-attach" aria-label="Attach file" onClick={() => fileInputRef.current?.click()} style={{ all: 'unset', cursor: 'pointer', width: 32, height: 32, borderRadius: '50%', background: '#f3f4f6', textAlign: 'center', lineHeight: '32px', fontSize: 18, color: '#444' }}>
            +
          </button>
        )}
        <input ref={fileInputRef} type="file" accept="application/pdf,image/png,image/jpeg" style={{ display: 'none' }} onChange={onFilePick} data-testid="composer-file-input" />
        <input type="text" data-testid="composer-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={props.placeholder ?? 'Ask about this patient…'} disabled={props.disabled} style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid #ddd', borderRadius: 4, fontSize: '0.875rem' }} />
        <button type="submit" data-testid="composer-send" disabled={props.disabled || (text.trim().length === 0 && file === null)} style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          Send
        </button>
      </div>
    </form>
  );
}
