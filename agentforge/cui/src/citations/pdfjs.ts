/**
 * G2-MVP-99 — single pdfjs-dist initialization point.
 *
 * pdfjs-dist 5.x defaults to fetching its worker via `import.meta.url`
 * relative resolution. In a bundled-then-served context (the OpenEMR
 * panel iframe) that resolution silently fails — `getDocument(...).promise`
 * rejects with a vague worker error and the canvas stays blank with no
 * user-visible feedback.
 *
 * Importing the worker file with Vite's `?url` suffix lets the build emit
 * it as a hashed asset and gives us a stable URL string to feed
 * `GlobalWorkerOptions.workerSrc`. Doing it once in this module (and
 * sharing the loaded `pdfjs` re-export) keeps render call sites tidy
 * and prevents drift between AttachmentPreview and DocumentModal.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let initialized = false;

function ensureWorker(): void {
  if (initialized) {
    return;
  }
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  initialized = true;
}

/**
 * Open a PDF from raw bytes. Lazily initializes the worker on first call.
 * Callers should `await` the returned `PDFDocumentProxy.getPage(n)` etc.
 */
export async function loadPdfDocument(data: Uint8Array | ArrayBuffer): Promise<pdfjs.PDFDocumentProxy> {
  ensureWorker();
  const loadingTask = pdfjs.getDocument({ data });
  return loadingTask.promise;
}
