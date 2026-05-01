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
      },
      async recordLlmCall({ correlationId, providerModel, meta }) {
        events.push(
          meta === undefined
            ? { name: `llm:${providerModel}`, correlationId }
            : { name: `llm:${providerModel}`, correlationId, meta },
        );
      },
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

  it('runs one-shot generateText and returns verified claims', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-1');
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        blocks: [{ type: 'claim', text: 'Patient is Female.', citation_ids: ['sp-ident'] }],
      }),
      totalUsage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    });

    const out = await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-1' }, 'c2');

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(out.blocks[0]).toMatchObject({ type: 'claim', citation_ids: ['sp-ident'] });
    expect(out.citation_navigation['sp-ident']).toBeDefined();
  });

  it('serves cache on second call without invoking LLM', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-1');
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        blocks: [{ type: 'claim', text: 'Patient is Female.', citation_ids: ['sp-ident'] }],
      }),
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
    expect(out2.blocks[0]).toMatchObject({ type: 'claim' });
  });

  it('bypasses cache when forceRefresh is true', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-1');
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        blocks: [{ type: 'claim', text: 'Patient is Female.', citation_ids: ['sp-ident'] }],
      }),
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

  it('injects deterministic identity.age_years and today into the LLM prompt so the model cannot guess age', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    const tok = sessionForPatient(env, 'pat-age');

    // 'DOB' uppercase mirrors what PatientService::getOne returns from
    // patient_data; the helper accepts either casing. 'date' is the
    // patient_data row's last-update timestamp — must NOT leak through to
    // the prompt or the model will treat it as today.
    vi.mocked(openemr.getIdentity).mockResolvedValue({
      fname: 'Raymond',
      lname: 'Cooper',
      DOB: '1965-06-15',
      sex: 'Male',
      date: '2020-01-02 00:00:00',
      source_pack: SAMPLE_SOURCE_PACK,
    });

    generateTextMock.mockResolvedValue({
      text: JSON.stringify({ blocks: [{ type: 'text', text: 'ok' }] }),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    await runCasePresentation(env, obs, { sessionToken: tok, patientUuid: 'pat-age' }, 'c-age');

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const call = generateTextMock.mock.calls[0]?.[0] as { prompt: string };
    const jsonStart = call.prompt.indexOf('{');
    const bundle = JSON.parse(call.prompt.slice(jsonStart)) as {
      today: string;
      identity: Record<string, unknown>;
    };

    expect(bundle.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parts = bundle.today.split('-').map(Number);
    const yy = parts[0] ?? 0;
    const mm = parts[1] ?? 0;
    const dd = parts[2] ?? 0;
    let expectedAge = yy - 1965;
    if (mm < 6 || (mm === 6 && dd < 15)) expectedAge -= 1;
    expect(bundle.identity.age_years).toBe(expectedAge);
    // Stale 'date' must be stripped — it had been mistaken for "today" upstream.
    expect(bundle.identity.date).toBeUndefined();
    expect(bundle.identity.DOB).toBe('1965-06-15');
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
      text: JSON.stringify({ blocks: [{ type: 'text', text: 'shared' }] }),
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });
});
