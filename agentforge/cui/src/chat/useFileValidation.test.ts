import { describe, expect, it } from 'vitest';
import { validateFileBasic, validatePdfPageCount } from './useFileValidation.js';

function makeFile(bytes: number, type: string): File {
  const data = new Uint8Array(bytes);
  return new File([data], 'test', { type });
}

describe('§9 G2-MVP-60 — useFileValidation', () => {
  it('accepts PDF under cap', () => {
    const r = validateFileBasic(makeFile(1024, 'application/pdf'));
    expect(r.ok).toBe(true);
  });

  it('rejects unsupported MIME', () => {
    const r = validateFileBasic(makeFile(1024, 'application/x-shockwave-flash'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorMessage).toContain('PDF, PNG, and JPEG');
    }
  });

  it('rejects file over 10 MB', () => {
    const r = validateFileBasic(makeFile(11 * 1024 * 1024, 'application/pdf'));
    expect(r.ok).toBe(false);
  });

  it('rejects empty file', () => {
    const r = validateFileBasic(makeFile(0, 'application/pdf'));
    expect(r.ok).toBe(false);
  });

  it('PDF page count over 10 pages → reject', async () => {
    const r = await validatePdfPageCount(makeFile(1024, 'application/pdf'), async () => 12);
    expect(r.ok).toBe(false);
  });

  it('PNG skips page-count check', async () => {
    const r = await validatePdfPageCount(makeFile(1024, 'image/png'), async () => 999);
    expect(r.ok).toBe(true);
  });
});
