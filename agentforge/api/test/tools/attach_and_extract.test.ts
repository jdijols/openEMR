import { describe, expect, it, vi } from 'vitest';
import { runAttachAndExtract, type AttachAndExtractDeps } from '../../src/tools/attach_and_extract.js';
import type { Env } from '../../src/env.js';
import { mintSessionToken } from '../../src/handshake/sessionToken.js';

/**
 * §5 / G2-MVP-35 — attach_and_extract tool isolated tests.
 *
 * (a) happy path delegates to fetchBytes + extractor.
 * (b) cross-patient binding blocks BEFORE any fetch / extractor call (S1).
 */

const SECRET = 'test-secret-32bytes-long-enough-here';
const PATIENT_UUID = '00000000-0000-0000-0000-000000000001';
const OTHER_PATIENT_UUID = '00000000-0000-0000-0000-00000000beef';
const DOCREF_UUID = 'docref-uuid-test';

function makeEnv(): Env {
  return { SESSION_TOKEN_SECRET: SECRET } as unknown as Env;
}

function makeObs(): AttachAndExtractDeps['observability'] {
  return {
    recordToolCall: vi.fn(async () => ({ end: vi.fn(async () => undefined) })),
  } as unknown as AttachAndExtractDeps['observability'];
}

function makeExtractorDeps(): AttachAndExtractDeps['extractorDeps'] {
  // The extractor itself is unit-tested in test/workers/intake_extractor.test.ts;
  // here we just confirm it's REACHED in the happy path. We mock the Anthropic
  // client so it never makes a network call.
  return {
    client: {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: 'text', text: '{}' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    } as unknown as AttachAndExtractDeps['extractorDeps']['client'],
    pdfParseFn: async () => ({ text: '' }),
  };
}

describe('§5 G2-MVP-35 — attach_and_extract', () => {
  it('happy path: bound session → fetchBytes called → extractor invoked → result returned', async () => {
    const sessionToken = mintSessionToken(
      { user_id: 1, patient_uuid: PATIENT_UUID, encounter_id: null },
      SECRET,
      Math.floor(Date.now() / 1000),
      600,
    );
    const fetchBytes = vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }));

    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken,
      correlationId: 'corr-1',
      observability: makeObs(),
      fetchBytes,
      extractorDeps: makeExtractorDeps(),
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'intake_form' },
      deps,
    );

    expect(out.ok).toBe(true);
    expect(fetchBytes).toHaveBeenCalledOnce();
    expect(fetchBytes).toHaveBeenCalledWith({ docrefUuid: DOCREF_UUID, patientUuidCanonical: PATIENT_UUID });
  });

  it('cross-patient: requested patient_uuid differs from bound → blocks before fetchBytes', async () => {
    const sessionToken = mintSessionToken(
      { user_id: 1, patient_uuid: PATIENT_UUID, encounter_id: null },
      SECRET,
      Math.floor(Date.now() / 1000),
      600,
    );
    const fetchBytes = vi.fn(async () => ({ bytes: new Uint8Array(), mimeType: 'application/pdf' }));

    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken,
      correlationId: 'corr-2',
      observability: makeObs(),
      fetchBytes,
      extractorDeps: makeExtractorDeps(),
    };

    const out = await runAttachAndExtract(
      { patient_uuid: OTHER_PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe('active_chart_mismatch');
    }
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('document_not_found: fetchBytes returns null → tool reports document_not_found', async () => {
    const sessionToken = mintSessionToken(
      { user_id: 1, patient_uuid: PATIENT_UUID, encounter_id: null },
      SECRET,
      Math.floor(Date.now() / 1000),
      600,
    );
    const fetchBytes = vi.fn(async () => null);

    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken,
      correlationId: 'corr-3',
      observability: makeObs(),
      fetchBytes,
      extractorDeps: makeExtractorDeps(),
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe('document_not_found');
    }
  });
});
