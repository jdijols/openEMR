import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * §9 / G2-MVP-65 — fetch + cache document bytes from the module's
 * `/document/bytes.php` endpoint by docref UUID. Used by DocumentModal
 * for the in-rail PDF/image render.
 */

export type DocumentBytesState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ok'; readonly bytes: Uint8Array; readonly mimeType: string }
  | { readonly status: 'error'; readonly errorMessage: string };

export type UseDocumentBytesArgs = {
  readonly bytesEndpoint: string;        // base URL of /document/bytes.php
  readonly sessionToken: string;
  readonly patientUuid: string;
};

export function useDocumentBytes(args: UseDocumentBytesArgs): {
  readonly fetchBytes: (docrefUuid: string) => Promise<void>;
  readonly state: DocumentBytesState;
  readonly clear: () => void;
} {
  const cache = useRef(new Map<string, { bytes: Uint8Array; mimeType: string }>());
  const [state, setState] = useState<DocumentBytesState>({ status: 'idle' });

  const fetchBytes = useCallback(
    async (docrefUuid: string): Promise<void> => {
      const cached = cache.current.get(docrefUuid);
      if (cached) {
        setState({ status: 'ok', bytes: cached.bytes, mimeType: cached.mimeType });
        return;
      }
      setState({ status: 'loading' });
      try {
        const url = new URL(args.bytesEndpoint);
        url.searchParams.set('docref_uuid', docrefUuid);
        url.searchParams.set('session_token', args.sessionToken);
        url.searchParams.set('patient_uuid', args.patientUuid);
        const resp = await fetch(url, { method: 'GET', credentials: 'omit' });
        if (resp.status === 403) {
          setState({ status: 'error', errorMessage: 'Access denied for this document.' });
          return;
        }
        if (!resp.ok) {
          setState({ status: 'error', errorMessage: `Could not load document (HTTP ${resp.status}).` });
          return;
        }
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const mimeType = resp.headers.get('content-type') ?? 'application/octet-stream';
        cache.current.set(docrefUuid, { bytes, mimeType });
        setState({ status: 'ok', bytes, mimeType });
      } catch {
        setState({ status: 'error', errorMessage: 'Network error loading document.' });
      }
    },
    [args.bytesEndpoint, args.sessionToken, args.patientUuid],
  );

  const clear = useCallback(() => setState({ status: 'idle' }), []);

  useEffect(() => () => cache.current.clear(), []);

  return { fetchBytes, state, clear };
}
