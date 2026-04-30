/**
 * G2-11 — typed CUI client.
 *
 * Verifies handshake POST shape, chat POST shape, error normalization, and the
 * correlation-id round trip (client-generated → header → server may echo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postChat, redeemHandshake } from './client.js';

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

describe('postChat (G2-11 / PRD §6.2)', () => {
  it('POSTs /chat with session+patient+message and returns blocks + correlation id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          blocks: [{ type: 'text', text: 'No allergies on file.' }],
          correlation_id: 'server-echo-id',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const out = await postChat('http://api.local', 'tok', 'pat-1', 'list allergies');

    expect(out.blocks).toEqual([{ type: 'text', text: 'No allergies on file.' }]);
    expect(out.correlationId).toBe('server-echo-id');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.local/chat');
    const headers = new Headers(init.headers as Record<string, string>);
    expect(headers.get('X-Correlation-Id')).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(JSON.parse(init.body as string)).toEqual({
      session_token: 'tok',
      patient_uuid: 'pat-1',
      message: 'list allergies',
    });
  });

  it('throws api_misconfigured_llm on 501 from server', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'misconfigured' }), { status: 501 }),
    ) as typeof fetch;
    await expect(postChat('http://api.local', 't', 'p', 'm')).rejects.toThrow('api_misconfigured_llm');
  });

  it('throws chat_failed on generic 5xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 }),
    ) as typeof fetch;
    await expect(postChat('http://api.local', 't', 'p', 'm')).rejects.toThrow('chat_failed');
  });
});
