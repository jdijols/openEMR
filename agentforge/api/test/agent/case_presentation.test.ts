/**
 * Gate 3 G3-11 — outpatient case presentation pipeline (prefetch + one-shot LLM + verification).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText: generateTextMock };
});

vi.mock('../../src/openemr/client.js', () => ({
  OpenEmrCallError: class OpenEmrCallError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
      this.name = 'OpenEmrCallError';
    }
  },
  getIdentity: vi.fn(),
  getAllergies: vi.fn(),
  getChartContextRows: vi.fn(),
}));

import {
  runCasePresentation,
  __resetCasePresentationInflightForTests,
} from '../../src/agent/case_presentation.js';
import { __resetCasePresentationCacheForTests } from '../../src/agent/case_presentation_cache.js';
import * as openemr from '../../src/openemr/client.js';
import { mintSessionToken } from '../../src/handshake/sessionToken.js';
import type { Observability } from '../../src/observability/index.js';
import type { ContextRow } from '../../src/openemr/types.js';
import { testEnv } from '../helpers/env-fixture.js';

const SAMPLE_SOURCE_PACK = {
  resource_family: 'identity',
  table: 'patient_data',
  row_id: 1,
  uuid: 'sp-ident',
  as_of: '2026-04-01T00:00:00Z',
  retrieval_path: 'PatientService',
  navigation_hint: { kind: 'chart_section', params: { section: 'demographics' } },
};

function sourcePack(
  resourceFamily: string,
  rowId: number,
  uuid: string,
  asOf: string,
  navigationHint: { kind: string; params: Record<string, unknown> },
) {
  return {
    resource_family: resourceFamily,
    table: resourceFamily === 'encounter' ? 'form_encounter' : `form_${resourceFamily}`,
    row_id: rowId,
    uuid,
    as_of: asOf,
    retrieval_path: 'test',
    navigation_hint: navigationHint,
  };
}

function encounterRow(eid: number, date: string, reason: string) {
  return {
    eid,
    euuid: `enc-${eid}`,
    date,
    reason,
    visit_category: 'Office Visit',
    visit_class_title: '',
    source_pack: sourcePack('encounter', eid, `sp-enc-${eid}`, `${date.slice(0, 10)}T00:00:00Z`, {
      kind: 'encounter',
      params: { encounter_id: eid },
    }),
  };
}

function vitalRow(id: number, recordedAt: string, encounterId?: number) {
  return {
    ...(encounterId !== undefined ? { encounter_id: encounterId } : {}),
    recorded_at: recordedAt,
    bps: '128',
    bpd: '82',
    pulse: '74',
    respiration: '16',
    temperature: '98.6',
    oxygen_saturation: '98',
    pain: '',
    weight: '180',
    height: '70',
    BMI: '25.8',
    note: '',
    source_pack: sourcePack('vital', id, `sp-vital-${id}`, `${recordedAt.slice(0, 10)}T00:00:00Z`, {
      kind: 'chart_section',
      params: { section: 'vitals' },
    }),
  };
}

function mockContextRows(rows: Record<string, ContextRow[]>) {
  vi.mocked(openemr.getChartContextRows).mockImplementation(async (_env, _ctx, _patient, path) => {
    return rows[path] ?? [];
  });
}

function priorSummaryResponse(summaries: Array<{ citation_uuid: string; summary: string }> = []) {
  return JSON.stringify({ previous_visits: summaries });
}

function recordingObs(): {
  obs: Observability;
  events: { name: string; correlationId: string; meta?: Record<string, unknown> }[];
} {
  const events: { name: string; correlationId: string; meta?: Record<string, unknown> }[] = [];
  return {
    events,
    obs: {
      async traceTurn({ correlationId }) {
        events.push({ name: 'traceTurn', correlationId });
        return { id: 'trace-cp', correlationId };
      },
      async recordToolCall({ correlationId, toolName, meta }) {
        events.push(
          meta === undefined
            ? { name: `tool:${toolName}`, correlationId }
            : { name: `tool:${toolName}`, correlationId, meta },
        );
        return { end: async () => {} };
      },
      async recordEvent({ correlationId, name, meta }) {
        events.push(
          meta === undefined
            ? { name: `event:${name}`, correlationId }
            : { name: `event:${name}`, correlationId, meta },
        );
      },
      async recordLlmCall({ correlationId, providerModel, meta }) {
        events.push(
          meta === undefined
            ? { name: `llm:${providerModel}`, correlationId }
            : { name: `llm:${providerModel}`, correlationId, meta },
        );
      },
      async shutdown() {},
    },
  };
}

function sessionForPatient(env: ReturnType<typeof testEnv>, patient: string): string {
  return mintSessionToken(
    { user_id: 1, patient_uuid: patient, encounter_id: null },
    env.SESSION_TOKEN_SECRET,
    Math.floor(Date.now() / 1000),
    600,
  );
}

function sessionForPatientWithEncounter(
  env: ReturnType<typeof testEnv>,
  patient: string,
  encounterId: number,
): string {
  return mintSessionToken(
    { user_id: 1, patient_uuid: patient, encounter_id: encounterId },
    env.SESSION_TOKEN_SECRET,
    Math.floor(Date.now() / 1000),
    600,
  );
}

beforeEach(() => {
  generateTextMock.mockReset();
  __resetCasePresentationCacheForTests();
  __resetCasePresentationInflightForTests();
  vi.mocked(openemr.getIdentity).mockResolvedValue({
    fname: 'Alex',
    lname: 'Rivera',
    dob: '1975-01-01',
    sex: 'Female',
    source_pack: SAMPLE_SOURCE_PACK,
  });
  vi.mocked(openemr.getAllergies).mockResolvedValue([]);
  vi.mocked(openemr.getChartContextRows).mockResolvedValue([]);
});

describe('runCasePresentation', () => {
  it('returns refusal on active_chart_mismatch', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-a');

    const out = await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-b' }, 'c1');
    expect(out.blocks[0]).toEqual({ type: 'refusal', reason: 'active_chart_mismatch' });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('runs one-shot generateText and returns the simplified three-section brief', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const today = new Date().toISOString().slice(0, 10);
    const tok = sessionForPatientWithEncounter(env, 'pat-1', 100);
    mockContextRows({
      'context/encounters.php': [
        encounterRow(100, `${today} 09:00:00`, 'Sore throat x2 days'),
        encounterRow(90, '2026-04-15 09:00:00', 'Cough follow-up'),
      ],
      'context/vitals.php': [vitalRow(10, `${today} 09:05:00`, 100)],
    });
    generateTextMock.mockResolvedValue({
      text: priorSummaryResponse([{ citation_uuid: 'sp-enc-90', summary: 'Cough had improved; no acute findings documented.' }]),
      totalUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    });

    const out = await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-1' }, 'c2');

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(out.blocks[0]).toEqual({ type: 'text', text: '### Reason for visit' });
    expect(out.blocks[1]).toMatchObject({
      type: 'claim',
      segments: [{ type: 'cite', text: 'Sore throat x2 days', citation_id: 'sp-enc-100' }],
    });
    expect(out.blocks[2]).toEqual({ type: 'text', text: '### Recorded most recently' });
    expect(out.blocks[3]).toMatchObject({
      type: 'claim',
      segments: expect.arrayContaining([
        { type: 'cite', text: 'BP 128/82', citation_id: 'sp-vital-10' },
        { type: 'cite', text: 'HR 74', citation_id: 'sp-vital-10' },
      ]),
    });
    expect(out.blocks[4]).toEqual({ type: 'text', text: '### Previous visits' });
    expect(out.blocks[5]).toMatchObject({
      type: 'claim',
      segments: [
        { type: 'cite', text: '2026-04-15', citation_id: 'sp-enc-90' },
        { type: 'text', text: ' - Cough had improved; no acute findings documented.' },
      ],
    });
    expect(out.citation_navigation['sp-enc-100']).toEqual({
      kind: 'encounter',
      params: { encounter_id: 100 },
    });
  });

  it('includes vitals for the open encounter when the visit date is not calendar today', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const visitDate = '2026-05-01';
    const tok = sessionForPatientWithEncounter(env, 'pat-past-visit', 540);
    mockContextRows({
      'context/encounters.php': [encounterRow(540, `${visitDate} 10:00:00`, 'Annual preventive visit')],
      'context/vitals.php': [vitalRow(77, `${visitDate} 11:05:00`, 540)],
    });
    generateTextMock.mockResolvedValue({
      text: priorSummaryResponse(),
      totalUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    });

    const out = await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-past-visit' }, 'c2b');

    expect(out.blocks).toContainEqual({ type: 'text', text: '### Recorded most recently' });
    expect(out.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'claim',
          segments: expect.arrayContaining([
            { type: 'cite', text: 'BP 128/82', citation_id: 'sp-vital-77' },
          ]),
        }),
      ]),
    );
  });

  it('serves cache on second call without invoking LLM', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-1');
    generateTextMock.mockResolvedValue({
      text: priorSummaryResponse(),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-1' }, 'c3');
    generateTextMock.mockClear();
    const out2 = await runCasePresentation(
      env,
      obs,
      { sessionToken: tok, patientUuid: 'pat-1', forceRefresh: false },
      'c4',
    );

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(out2.blocks[0]).toEqual({ type: 'text', text: '### Reason for visit' });
  });

  it('bypasses cache when forceRefresh is true', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-1');
    generateTextMock.mockResolvedValue({
      text: priorSummaryResponse(),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-1' }, 'c5');
    await runCasePresentation(
      env,
      obs,
      { sessionToken: tok, patientUuid: 'pat-1', forceRefresh: true },
      'c6',
    );
    expect(generateTextMock).toHaveBeenCalledTimes(2);
  });

  it('returns refusal when identity fetch fails with OpenEmrCallError', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-1');
    vi.mocked(openemr.getIdentity).mockRejectedValueOnce(new openemr.OpenEmrCallError('openemr_error', 500));

    const out = await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-1' }, 'c7');
    expect(out.blocks[0]).toEqual({ type: 'refusal', reason: 'chart_read_failed' });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('sends only previous-visit context and today into the summary prompt', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const today = new Date().toISOString().slice(0, 10);
    const tok = sessionForPatientWithEncounter(env, 'pat-age', 101);

    // The prior-summary prompt should not expose identity demographics or the
    // stale patient_data 'date' column that previously confused the case brief.
    vi.mocked(openemr.getIdentity).mockResolvedValue({
      fname: 'Raymond',
      lname: 'Cooper',
      DOB: '1965-06-15',
      sex: 'Male',
      date: '2020-01-02 00:00:00',
      source_pack: SAMPLE_SOURCE_PACK,
    });
    mockContextRows({
      'context/encounters.php': [
        encounterRow(101, `${today} 10:00:00`, 'Annual wellness'),
        encounterRow(99, '2026-04-01 09:00:00', 'Blood pressure follow-up'),
      ],
    });

    generateTextMock.mockResolvedValue({
      text: priorSummaryResponse(),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-age' }, 'c-age');

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const call = generateTextMock.mock.calls[0]?.[0] as { prompt: string };
    const jsonStart = call.prompt.indexOf('{');
    const bundle = JSON.parse(call.prompt.slice(jsonStart)) as {
      today: string;
      identity?: Record<string, unknown>;
      previous_visits: Array<{ citation_uuid: string; reason: string }>;
    };

    expect(bundle.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bundle.identity).toBeUndefined();
    expect(bundle.previous_visits).toMatchObject([
      { citation_uuid: 'sp-enc-99', reason: 'Blood pressure follow-up' },
    ]);
  });

  it('coalesces concurrent calls for the same chart into a single LLM call', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-race');

    type LlmResolver = (v: {
      text: string;
      totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
    }) => void;
    let resolveLlm: LlmResolver = () => {};
    generateTextMock.mockImplementation(
      () =>
        new Promise<{
          text: string;
          totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
        }>((resolve) => {
          resolveLlm = resolve;
        }),
    );

    const p1 = runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-race' }, 'c-race-1');
    const p2 = runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-race' }, 'c-race-2');

    // Drain the microtask queue past the awaited tracing/fetch/observability hops
    // so the first caller reaches generateText before we assert.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
    }

    expect(generateTextMock).toHaveBeenCalledTimes(1);

    resolveLlm({
      text: priorSummaryResponse(),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  /**
   * P3 fix — encounter_id participates in the cache key. Reproducer:
   * brief generated against encounter A on patient X must NOT be served
   * back to encounter B on the same patient X. Pre-fix the second call
   * silently returned the cached "encounter A" brief; post-fix it forces
   * a fresh LLM call.
   */
  it('does not serve a cached brief across two encounters on the same patient (P3)', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const today = new Date().toISOString().slice(0, 10);
    const tokA = sessionForPatientWithEncounter(env, 'pat-shared', 100);
    const tokB = sessionForPatientWithEncounter(env, 'pat-shared', 200);
    mockContextRows({
      'context/encounters.php': [
        encounterRow(200, `${today} 11:00:00`, 'Encounter B reason'),
        encounterRow(100, `${today} 09:00:00`, 'Encounter A reason'),
      ],
    });

    generateTextMock.mockResolvedValueOnce({
      text: priorSummaryResponse(),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    generateTextMock.mockResolvedValueOnce({
      text: priorSummaryResponse(),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const briefA = await runCasePresentation(env, obs, { sessionToken: tokA, patientUuid: 'pat-shared' }, 'p3-a');
    const briefB = await runCasePresentation(env, obs, { sessionToken: tokB, patientUuid: 'pat-shared' }, 'p3-b');

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(briefA.blocks[1]).toMatchObject({
      type: 'claim',
      segments: [{ type: 'cite', text: 'Encounter A reason', citation_id: 'sp-enc-100' }],
    });
    expect(briefB.blocks[1]).toMatchObject({
      type: 'claim',
      segments: [{ type: 'cite', text: 'Encounter B reason', citation_id: 'sp-enc-200' }],
    });
  });

  it('falls back to deterministic previous-visit text when the summary JSON is invalid', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const today = new Date().toISOString().slice(0, 10);
    const tok = sessionForPatientWithEncounter(env, 'pat-empty', 100);
    mockContextRows({
      'context/encounters.php': [
        encounterRow(100, `${today} 09:00:00`, 'Follow-up today'),
        encounterRow(90, '2026-04-01 09:00:00', 'Prior cough visit'),
      ],
    });

    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ blocks: [] }),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const out = await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-empty' }, 'p3-empty');
    expect(out.blocks).toContainEqual({ type: 'text', text: '### Previous visits' });
    expect(out.blocks.at(-1)).toMatchObject({
      type: 'claim',
      segments: [
        { type: 'cite', text: '2026-04-01', citation_id: 'sp-enc-90' },
        { type: 'text', text: ' - Prior cough visit' },
      ],
    });
  });

  it('shows placeholders and caps previous visits at three', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const today = new Date().toISOString().slice(0, 10);
    const tok = sessionForPatientWithEncounter(env, 'pat-prior', 500);
    mockContextRows({
      'context/encounters.php': [
        encounterRow(500, `${today} 09:00:00`, ''),
        encounterRow(400, '2026-04-04 09:00:00', 'Fourth prior'),
        encounterRow(300, '2026-04-03 09:00:00', 'Third prior'),
        encounterRow(200, '2026-04-02 09:00:00', 'Second prior'),
        encounterRow(100, '2026-04-01 09:00:00', 'Oldest prior'),
      ],
    });

    generateTextMock.mockResolvedValue({
      text: priorSummaryResponse([
        { citation_uuid: 'sp-enc-400', summary: 'Fourth prior summary.' },
        { citation_uuid: 'sp-enc-300', summary: 'Third prior summary.' },
        { citation_uuid: 'sp-enc-200', summary: 'Second prior summary.' },
        { citation_uuid: 'sp-enc-100', summary: 'Should be ignored.' },
      ]),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const out = await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-prior' }, 'p3-r1');
    expect(out.blocks).toContainEqual({ type: 'text', text: 'No reason for visit recorded.' });
    expect(out.blocks).toContainEqual({ type: 'text', text: 'None recorded for this visit.' });
    const previousClaims = out.blocks.filter(
      (block) =>
        block.type === 'claim' &&
        block.segments?.some((segment) => segment.type === 'cite' && segment.citation_id.startsWith('sp-enc-')) === true,
    );
    expect(previousClaims).toHaveLength(3);
    expect(previousClaims[0]).toMatchObject({
      segments: [
        { type: 'cite', text: '2026-04-04', citation_id: 'sp-enc-400' },
        { type: 'text', text: ' - Fourth prior summary.' },
      ],
    });
    expect(previousClaims[2]).toMatchObject({
      segments: [
        { type: 'cite', text: '2026-04-02', citation_id: 'sp-enc-200' },
        { type: 'text', text: ' - Second prior summary.' },
      ],
    });
  });
});
