/**
 * G2-11 — typed CUI client.
 *
 * Verifies handshake POST shape, chat POST shape, error normalization, and the
 * correlation-id round trip (client-generated → header → server may echo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentForgeDeliveryError,
  postChat,
  postPresentPatient,
  postProposalConfirm,
  postProposalReject,
  redeemHandshake,
} from './client.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
});

describe('redeemHandshake (G2-11 / PRD §6.2)', () => {
  it('POSTs /handshake/redeem with launch_code and X-Correlation-Id header', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session_token: 'tok.value',
          identity: { user_id: 1, patient_uuid_present: true, encounter_id_present: false },
          expires_at: '2026-04-30T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const r = await redeemHandshake('http://api.local/', 'launch-abc');

    expect(r.session_token).toBe('tok.value');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.local/handshake/redeem');
    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('X-Correlation-Id')).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(JSON.parse(init.body as string)).toEqual({ launch_code: 'launch-abc' });
  });

  it('throws handshake_failed on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_launch_code' }), { status: 401 }),
    ) as typeof fetch;
    await expect(redeemHandshake('http://api.local', 'x')).rejects.toThrow('handshake_failed');
  });

  it('dedupes concurrent calls with the same launch code (single-use safety)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session_token: 'tok.dedupe',
          identity: { user_id: 1, patient_uuid_present: true, encounter_id_present: false },
          expires_at: '2026-04-30T00:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const [a, b] = await Promise.all([
      redeemHandshake('http://api.local', 'same-code'),
      redeemHandshake('http://api.local', 'same-code'),
    ]);
    expect(a.session_token).toBe('tok.dedupe');
    expect(b.session_token).toBe('tok.dedupe');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Build a `Response` whose body is a Server-Sent Events stream made up of
 * the given `event:` / `data:` tuples — same shape Hono's `streamSSE`
 * emits server-side. Used by the postChat suite below so each test only
 * has to spell out the SSE events it cares about.
 */
function sseResponse(events: ReadonlyArray<{ readonly event: string; readonly data: string }>): Response {
  const text = events.map((e) => `event: ${e.event}\ndata: ${e.data}\n\n`).join('');
  return new Response(text, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('postChat (G2-11 / PRD §6.2)', () => {
  it('POSTs /chat with session+patient+message and returns blocks + correlation id from the SSE final event', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        {
          event: 'final',
          data: JSON.stringify({
            ok: true,
            blocks: [{ type: 'text', text: 'No allergies on file.' }],
            correlation_id: 'server-echo-id',
          }),
        },
      ]),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const out = await postChat('http://api.local', 'tok', 'pat-1', 'list allergies');

    expect(out.blocks).toEqual([{ type: 'text', text: 'No allergies on file.' }]);
    expect(out.correlationId).toBe('server-echo-id');
    expect(out.citation_navigation).toEqual({});
    expect(out.conversationId).toBeNull();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.local/chat');
    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('X-Correlation-Id')).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(JSON.parse(init.body as string)).toEqual({
      session_token: 'tok',
      patient_uuid: 'pat-1',
      message: 'list allergies',
    });
  });

  it('round-trips conversation_id when provided and echoes back from Agent API', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        {
          event: 'final',
          data: JSON.stringify({
            ok: true,
            blocks: [{ type: 'text', text: 'Echo.' }],
            correlation_id: 'c2',
            conversation_id: '00000000-0000-4000-a000-0000000000cc',
          }),
        },
      ]),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const out = await postChat('http://api.local', 'tok', 'pat-1', 'hello', {
      conversation_id: '00000000-0000-4000-a000-0000000000bb',
    });
    expect(out.conversationId).toBe('00000000-0000-4000-a000-0000000000cc');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      session_token: 'tok',
      patient_uuid: 'pat-1',
      message: 'hello',
      conversation_id: '00000000-0000-4000-a000-0000000000bb',
    });
  });

  it('parses citation_navigation map when returned by Agent API', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        {
          event: 'final',
          data: JSON.stringify({
            ok: true,
            blocks: [{ type: 'text', text: 'See chart.' }],
            correlation_id: 'cmap-id',
            citation_navigation: {
              'eu-u': { kind: 'encounter', params: { encounter_id: 9 } },
            },
          }),
        },
      ]),
    ) as typeof fetch;

    const out = await postChat('http://api.local', 'tok', 'pat-1', 'x');
    expect(out.citation_navigation['eu-u']).toEqual({
      kind: 'encounter',
      params: { encounter_id: 9 },
    });
  });

  it('forwards SSE routing events to the onRouting callback before the final event', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        { event: 'routing', data: JSON.stringify({ worker: 'intake_extractor', label: 'Reading file' }) },
        {
          event: 'final',
          data: JSON.stringify({
            ok: true,
            blocks: [{ type: 'text', text: 'Done.' }],
            correlation_id: 'route-id',
          }),
        },
      ]),
    ) as typeof fetch;

    const seen: Array<{ worker: string; label: string }> = [];
    const out = await postChat('http://api.local', 'tok', 'pat-1', 'extract', {
      docref_uuid: 'doc-uuid-1',
      doc_type: 'lab_pdf',
      onRouting: (e) => {
        seen.push({ worker: e.worker, label: e.label });
      },
    });

    expect(seen).toEqual([{ worker: 'intake_extractor', label: 'Reading file' }]);
    expect(out.correlationId).toBe('route-id');
  });

  it('throws AgentForgeDeliveryError misconfigured_llm on `error` SSE event with kind=misconfigured', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        { event: 'error', data: JSON.stringify({ error: 'misconfigured', correlation_id: 'mc-id' }) },
      ]),
    ) as typeof fetch;

    await expect(postChat('http://api.local', 't', 'p', 'm')).rejects.toMatchObject({
      name: 'AgentForgeDeliveryError',
      kind: 'misconfigured_llm',
      correlationId: 'mc-id',
    });
  });

  it('throws AgentForgeDeliveryError backend_error with correlation id on generic SSE error event', async () => {
    globalThis.fetch = vi.fn(async () =>
      sseResponse([
        { event: 'error', data: JSON.stringify({ error: 'internal_error', correlation_id: 'abc-uuid' }) },
      ]),
    ) as typeof fetch;

    const errUnknown = await postChat('http://api.local', 't', 'p', 'm').catch((e): unknown => e);
    expect(errUnknown).toBeInstanceOf(AgentForgeDeliveryError);
    const err = errUnknown as AgentForgeDeliveryError;
    expect(err.kind).toBe('backend_error');
    expect(err.correlationId).toBe('abc-uuid');
  });

  it('throws bad_request on pre-stream HTTP 400 (request never reached SSE)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'invalid_request' }), { status: 400 }),
    ) as typeof fetch;

    const errUnknown = await postChat('http://api.local', 't', 'p', 'm').catch((e): unknown => e);
    expect(errUnknown).toBeInstanceOf(AgentForgeDeliveryError);
    expect((errUnknown as AgentForgeDeliveryError).kind).toBe('bad_request');
  });

  it('throws network_unreachable when fetch rejects', async () => {
    globalThis.fetch = vi.fn(async (): Promise<Response> =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as typeof fetch;

    const errUnknown = await postChat('http://api.local', 't', 'p', 'm').catch((e): unknown => e);
    expect(errUnknown).toBeInstanceOf(AgentForgeDeliveryError);
    expect((errUnknown as AgentForgeDeliveryError).kind).toBe('network_unreachable');
  });
});

describe('postPresentPatient (G3-11 case presentation)', () => {
  it('POSTs /present-patient with optional force_refresh', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          blocks: [{ type: 'text', text: 'Case overview: demo.' }],
          correlation_id: 'cp-1',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const out = await postPresentPatient('http://api.local', 'tok', 'pat-1', true);

    expect(out.blocks[0]).toEqual({ type: 'text', text: 'Case overview: demo.' });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      session_token: 'tok',
      patient_uuid: 'pat-1',
      force_refresh: true,
    });
  });
});

describe('postProposalConfirm (P1 hardening — typed error frames)', () => {
  it('returns accepted=true on 200 + ok=true + accepted=true', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, accepted: true, correlation_id: 'ok-1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const out = await postProposalConfirm(
      'http://api.local',
      'sess.tok',
      'pat-1',
      '00000000-0000-4000-8000-00000000c0de',
      'prop-1',
    );
    expect(out.accepted).toBe(true);
  });

  it('passes through reason on 200 + ok=true + accepted=false (real OpenEMR rejection)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ ok: true, accepted: false, reason: 'encounter not found', correlation_id: 'r-1' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const out = await postProposalConfirm(
      'http://api.local',
      'sess.tok',
      'pat-1',
      '00000000-0000-4000-8000-00000000c0de',
      'prop-2',
    );
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe('encounter not found');
  });

  it('throws AgentForgeDeliveryError carrying serverError + correlationId on 400 duplicate_proposal', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: 'duplicate_proposal', correlation_id: 'corr-dup-12345678' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const errUnknown = await postProposalConfirm(
      'http://api.local',
      'sess.tok',
      'pat-1',
      '00000000-0000-4000-8000-00000000c0de',
      'prop-3',
    ).catch((e): unknown => e);

    expect(errUnknown).toBeInstanceOf(AgentForgeDeliveryError);
    const err = errUnknown as AgentForgeDeliveryError;
    expect(err.kind).toBe('bad_request');
    expect(err.serverError).toBe('duplicate_proposal');
    expect(err.correlationId).toBe('corr-dup-12345678');
  });

  it('throws AgentForgeDeliveryError with serverError=unauthenticated on 401 from openemr_error path', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'openemr_error',
          correlation_id: 'corr-401',
          detail: { error: 'unauthenticated' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const errUnknown = await postProposalConfirm(
      'http://api.local',
      'sess.tok',
      'pat-1',
      '00000000-0000-4000-8000-00000000c0de',
      'prop-4',
    ).catch((e): unknown => e);

    expect(errUnknown).toBeInstanceOf(AgentForgeDeliveryError);
    const err = errUnknown as AgentForgeDeliveryError;
    expect(err.kind).toBe('backend_error');
    expect(err.serverError).toBe('openemr_error');
    expect(err.correlationId).toBe('corr-401');
  });

  it('throws AgentForgeDeliveryError network_unreachable when fetch rejects', async () => {
    globalThis.fetch = vi.fn(async (): Promise<Response> =>
      Promise.reject(new TypeError('Failed to fetch')),
    ) as typeof fetch;

    const errUnknown = await postProposalConfirm(
      'http://api.local',
      'sess.tok',
      'pat-1',
      '00000000-0000-4000-8000-00000000c0de',
      'prop-5',
    ).catch((e): unknown => e);

    expect(errUnknown).toBeInstanceOf(AgentForgeDeliveryError);
    expect((errUnknown as AgentForgeDeliveryError).kind).toBe('network_unreachable');
  });
});

describe('postProposalReject (P1 hardening — typed error frames)', () => {
  it('throws AgentForgeDeliveryError with serverError on 409 not_pending', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: 'not_pending', correlation_id: 'corr-409' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as typeof fetch;

    const errUnknown = await postProposalReject(
      'http://api.local',
      'sess.tok',
      'pat-1',
      '00000000-0000-4000-8000-00000000c0de',
      'prop-rej-1',
    ).catch((e): unknown => e);

    expect(errUnknown).toBeInstanceOf(AgentForgeDeliveryError);
    const err = errUnknown as AgentForgeDeliveryError;
    expect(err.serverError).toBe('not_pending');
    expect(err.correlationId).toBe('corr-409');
  });
});

