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
    // §7 / G2-Early-10 — handoff event surface; the worker emits this
    // BEFORE its own tool span. Stub returns void.
    recordEvent: vi.fn(async () => undefined),
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

/**
 * G2-Final-FB-B-01 + FB-B-02 — persistence gating coverage.
 *
 * The worker MUST persist when (lab_pdf, schemaValid, crossCheckStatus
 * === 'verified'). It MUST NOT persist on cross-check fail (S14). It
 * MUST NOT touch the persister for intake_form (those flow through W1
 * propose_writes per FB-B-03 / FB-B-06).
 */

function makeExtractorDepsReturning(
  schemaValid: boolean,
  crossCheckStatus: 'verified' | 'partial' | 'unverified' | 'not_applicable',
  resultsCount: number,
): AttachAndExtractDeps['extractorDeps'] {
  // We intercept by replacing the worker's pdf-parse so the extractor
  // produces a deterministic shape. But the worker also calls Anthropic;
  // simpler is to hand-craft the extractor result by stubbing the path
  // through. Easiest: have anthropic return JSON that parses, OR override
  // the runIntakeExtractor path. We do the simpler thing: stub anthropic
  // to return a §6-shaped JSON envelope based on the parameters.
  const content =
    schemaValid
      ? JSON.stringify({
          ordering_provider: null,
          performing_lab: 'Quest',
          panel_name: null,
          date_collected: null,
          date_reported: null,
          results: Array.from({ length: resultsCount }).map((_, i) => ({
            test_name: `Test ${i}`,
            loinc: null,
            value: 100 + i,
            unit: 'mg/dL',
            reference_range_low: 0,
            reference_range_high: 200,
            reference_range_text: null,
            collection_date: '2026-01-15',
            abnormal_flag: 'normal',
            result_comments: null,
            citation: {
              source_type: 'lab_pdf',
              source_id: 'will-be-overwritten',
              page_or_section: 'page:1',
              field_or_chunk_id: `results[${i}]`,
              quote_or_value: `Test ${i} 100 mg/dL`,
            },
          })),
          interpretive_comments: null,
          interpretive_comments_citation: null,
          extraction_metadata: { pages_processed: 1, overall_confidence: 'high', fields_uncertain: [] },
        })
      : '{"not_a_real_lab": true}';

  // The cross-check is driven by what pdf-parse returns vs the
  // citations' quote_or_value. Map each requested status to the right
  // text-layer shape:
  //   - verified       → text layer contains every citation quote
  //   - unverified     → text layer is non-empty (above the
  //                      image-only threshold) but contains none of
  //                      the quotes — the real hallucination case
  //   - not_applicable → text layer is effectively empty (image-only
  //                      PDF or vision input) — the worker treats this
  //                      as no signal and trusts vision OCR
  //   - partial        → mix: some quotes present, some absent
  // Above the image-only threshold (~100 stripped chars) so the
  // worker actually runs the substring check rather than falling into
  // the not_applicable branch.
  const PADDING =
    'PACIFIC DIAGNOSTICS LAB ' +
    'PATIENT MARGARET CHEN DOB 1967-08-14 ' +
    'COLLECTED 2026-04-22 ORDERING PROVIDER RAO ANJALI MD ' +
    'LIPID PANEL WITH DIRECT LDL REFERENCE RANGE OPTIMAL';
  let parsedText: string;
  if (crossCheckStatus === 'verified') {
    parsedText = Array.from({ length: resultsCount })
      .map((_, i) => `Test ${i} 100 mg/dL`)
      .join(' ');
  } else if (crossCheckStatus === 'unverified') {
    parsedText = PADDING + ' totally unrelated content with no Test or 100 anywhere';
  } else if (crossCheckStatus === 'partial') {
    // Half the citations match; the rest do not.
    const half = Math.max(1, Math.floor(resultsCount / 2));
    parsedText =
      PADDING + ' ' +
      Array.from({ length: half })
        .map((_, i) => `Test ${i} 100 mg/dL`)
        .join(' ');
  } else {
    // not_applicable — empty text layer; worker routes through the
    // image-only branch.
    parsedText = '';
  }

  return {
    client: {
      messages: {
        create: vi.fn(async () => ({
          content: [{ type: 'text', text: content }],
          usage: { input_tokens: 1, output_tokens: 1 },
        })),
      },
    } as unknown as AttachAndExtractDeps['extractorDeps']['client'],
    pdfParseFn: async () => ({ text: parsedText }),
  };
}

describe('FB-B-01 + FB-B-02 — observation persistence gating', () => {
  function bound(): string {
    return mintSessionToken(
      { user_id: 1, patient_uuid: PATIENT_UUID, encounter_id: null },
      SECRET,
      Math.floor(Date.now() / 1000),
      600,
    );
  }

  it('persists when lab_pdf + schemaValid + cross_check verified', async () => {
    const persistObservations = vi.fn(async () => ({ inserted: 3, updated: 0, failed: 0 }));
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-01a',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      extractorDeps: makeExtractorDepsReturning(true, 'verified', 3),
      persistObservations,
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(true);
    expect(out.persistence.inserted).toBe(3);
    expect(persistObservations).toHaveBeenCalledOnce();
    const call = persistObservations.mock.calls[0]![0];
    expect(call.docrefUuid).toBe(DOCREF_UUID);
    expect(call.patientUuidCanonical).toBe(PATIENT_UUID);
    expect(call.results).toHaveLength(3);
    // Citations stripped — only the FHIR-shaped fields survive.
    expect((call.results[0] as Record<string, unknown>)['citation']).toBeUndefined();
  });

  it('skips persistence + records cross_check_failed when text layer is present but quotes do not match (S14, FB-B-02 hallucination guard)', async () => {
    const persistObservations = vi.fn(async () => ({ inserted: 0, updated: 0, failed: 0 }));
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-02',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      extractorDeps: makeExtractorDepsReturning(true, 'unverified', 2),
      persistObservations,
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(false);
    expect(out.persistence.skipped_reason).toBe('cross_check_failed');
    expect(persistObservations).not.toHaveBeenCalled();
  });

  it('persists when crossCheckStatus is not_applicable (image-only PDF — vision is the OCR source)', async () => {
    // The Margaret Chen scenario: scanned-image lab PDF whose text
    // layer is effectively empty. Vision extracts values, schema
    // validates, but there is no text layer to substring-match
    // against. Persistence proceeds because the proposed-change card
    // still gives the clinician a Confirm/Reject gate.
    const persistObservations = vi.fn(async () => ({ inserted: 6, updated: 0, failed: 0 }));
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-02-image-pdf',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      extractorDeps: makeExtractorDepsReturning(true, 'not_applicable', 6),
      persistObservations,
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(true);
    expect(out.persistence.inserted).toBe(6);
    expect(out.persistence.skipped_reason).toBeUndefined();
    expect(persistObservations).toHaveBeenCalledOnce();
  });

  it('persists only verified rows on partial cross-check; refusal does not fire', async () => {
    // S14 / FB-B-03 (per-row gating) — when some citation quotes match
    // and others don't, the gate persists the verified subset and
    // drops the rest. The chat surfaces "wrote N of M" via
    // `rows_dropped_unverified`; no `cross_check_failed` is emitted.
    const persistObservations = vi.fn(async (args: { results: ReadonlyArray<unknown> }) => ({
      inserted: args.results.length,
      updated: 0,
      failed: 0,
    }));
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-02-partial',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      // The fixture's partial branch arranges rawText so rows 0 and 1
      // (of 4) match their citations; rows 2 and 3 do not.
      extractorDeps: makeExtractorDepsReturning(true, 'partial', 4),
      persistObservations,
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(true);
    expect(out.persistence.inserted).toBe(2);
    expect(out.persistence.rows_dropped_unverified).toBe(2);
    expect(out.persistence.skipped_reason).toBeUndefined();
    expect(persistObservations).toHaveBeenCalledOnce();
    // Per-row filter: only the verified rows reach the persister.
    const call = persistObservations.mock.calls[0]![0];
    expect(call.results).toHaveLength(2);
  });

  it('still refuses when partial but zero result rows verified (only non-row citations matched — treat as hallucination)', async () => {
    // Edge case: factsVerified > 0 because (e.g.) the
    // `interpretive_comments_citation` matched, but no result rows
    // verified. The chart still gets nothing; refusal fires so the
    // clinician sees the failure mode.
    const partialNoRowsExtractorDeps: AttachAndExtractDeps['extractorDeps'] = {
      client: {
        messages: {
          create: vi.fn(async () => ({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ordering_provider: null,
                  performing_lab: 'Quest',
                  panel_name: null,
                  date_collected: null,
                  date_reported: null,
                  results: [
                    {
                      test_name: 'Test 0',
                      loinc: null,
                      value: 100,
                      unit: 'mg/dL',
                      reference_range_low: 0,
                      reference_range_high: 200,
                      reference_range_text: null,
                      collection_date: '2026-01-15',
                      abnormal_flag: 'normal',
                      result_comments: null,
                      citation: {
                        source_type: 'lab_pdf',
                        source_id: 'will-be-overwritten',
                        page_or_section: 'page:1',
                        field_or_chunk_id: 'results[0]',
                        quote_or_value: 'this exact phrase is not in the text layer',
                      },
                    },
                  ],
                  interpretive_comments: 'Lipid panel summary',
                  interpretive_comments_citation: {
                    source_type: 'lab_pdf',
                    source_id: 'will-be-overwritten',
                    page_or_section: 'Interpretive Comments',
                    field_or_chunk_id: 'interpretive_comments',
                    quote_or_value: 'lipid panel summary appears verbatim',
                  },
                  extraction_metadata: { pages_processed: 1, overall_confidence: 'high', fields_uncertain: [] },
                }),
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          })),
        },
      } as unknown as AttachAndExtractDeps['extractorDeps']['client'],
      // Text layer is rich (above the image-only threshold) and
      // contains the interpretive comments quote but NOT the result
      // row's quote.
      pdfParseFn: async () =>
        ({
          text:
            'PACIFIC DIAGNOSTICS LAB header line patient block ' +
            'collected date ordering provider section ' +
            'lipid panel summary appears verbatim somewhere in the body',
        }),
    };

    const persistObservations = vi.fn(async () => ({ inserted: 0, updated: 0, failed: 0 }));
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-02-partial-no-rows',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      extractorDeps: partialNoRowsExtractorDeps,
      persistObservations,
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(false);
    expect(out.persistence.skipped_reason).toBe('cross_check_failed');
    expect(persistObservations).not.toHaveBeenCalled();
  });

  it('skips persistence with not_lab_pdf when doc_type is intake_form', async () => {
    const persistObservations = vi.fn(async () => ({ inserted: 99, updated: 0, failed: 0 }));
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-01b',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      // intake_form doesn't go through this codepath for persistence
      extractorDeps: makeExtractorDepsReturning(false, 'not_applicable', 0),
      persistObservations,
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'intake_form' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(false);
    expect(out.persistence.skipped_reason).toBe('not_lab_pdf');
    expect(persistObservations).not.toHaveBeenCalled();
  });

  it('skips persistence with no_persister when persistObservations is omitted', async () => {
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-01c',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      extractorDeps: makeExtractorDepsReturning(true, 'verified', 1),
      // persistObservations: undefined
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(false);
    expect(out.persistence.skipped_reason).toBe('no_persister');
  });

  it('records persistence failure count when persister throws', async () => {
    const persistObservations = vi.fn(async () => {
      throw new Error('boom');
    });
    const deps: AttachAndExtractDeps = {
      env: makeEnv(),
      sessionToken: bound(),
      correlationId: 'corr-fb-b-01d',
      observability: makeObs(),
      fetchBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/pdf' })),
      extractorDeps: makeExtractorDepsReturning(true, 'verified', 4),
      persistObservations,
    };

    const out = await runAttachAndExtract(
      { patient_uuid: PATIENT_UUID, docref_uuid: DOCREF_UUID, doc_type: 'lab_pdf' },
      deps,
    );

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.persistence.attempted).toBe(true);
    expect(out.persistence.failed).toBe(4);
    expect(out.persistence.inserted).toBe(0);
  });
});
