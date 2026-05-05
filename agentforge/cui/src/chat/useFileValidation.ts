/**
 * §9 / G2-MVP-60 — file validation hook for the W2 composer attachment flow.
 *
 * Three gates:
 *   1. MIME type — only PDF + PNG + JPEG are accepted.
 *   2. Size — 10 MB cap (matches the PHP DocumentUploadPayload::MAX_FILE_BYTES).
 *   3. Page count — PDFs only; rejects above 10 pages.
 *
 * Returns `{ ok: true }` on pass, otherwise `{ ok: false, errorMessage }`.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 10;
const SUPPORTED_MIMES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export type FileValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorMessage: string };

export function validateFileBasic(file: File): FileValidationResult {
  if (!(SUPPORTED_MIMES as readonly string[]).includes(file.type)) {
    return { ok: false, errorMessage: 'Only PDF, PNG, and JPEG files are supported.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, errorMessage: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB; max 10 MB).` };
  }
  if (file.size === 0) {
    return { ok: false, errorMessage: 'File is empty.' };
  }
  return { ok: true };
}

export async function validatePdfPageCount(file: File, pdfjsCountPages: (bytes: ArrayBuffer) => Promise<number>): Promise<FileValidationResult> {
  if (file.type !== 'application/pdf') {
    return { ok: true };
  }
  try {
    const buf = await file.arrayBuffer();
    const pages = await pdfjsCountPages(buf);
    if (pages > MAX_PDF_PAGES) {
      return { ok: false, errorMessage: `PDF has ${pages} pages; the limit is ${MAX_PDF_PAGES}.` };
    }
    return { ok: true };
  } catch {
    return { ok: false, errorMessage: 'Could not read PDF — please try a different file.' };
  }
}

export const fileValidationConstants = {
  MAX_FILE_BYTES,
  MAX_PDF_PAGES,
  SUPPORTED_MIMES,
} as const;
