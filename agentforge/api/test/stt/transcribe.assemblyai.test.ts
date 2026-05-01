/**
 * AssemblyAI prerecorded flow — mock fetch to verify upload -> submit -> poll loop
 * resolves to the transcript text. PRD §5.8: audio bytes never persisted on our side.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribeInMemoryAudio } from '../../src/stt/transcribe.js';
import { testEnv } from '../helpers/env-fixture.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('transcribeInMemoryAudio (AssemblyAI)', () => {
  it('uploads, submits, polls until completed, returns text, and best-effort deletes', async () => {
    const env = testEnv({ STT_PROVIDER: 'assemblyai', STT_API_KEY: 'aai-key' });
    const calls: { url: string; method: string }[] = [];
    let pollCount = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      calls.push({ url, method });

      if (url.endsWith('/v2/upload') && method === 'POST') {
        return new Response(JSON.stringify({ upload_url: 'https://cdn.assemblyai.com/upload/abc' }), { status: 200 });
      }
      if (url.endsWith('/v2/transcript') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'tr-123', status: 'queued' }), { status: 200 });
      }
      if (url.endsWith('/v2/transcript/tr-123') && method === 'GET') {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(JSON.stringify({ id: 'tr-123', status: 'processing' }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ id: 'tr-123', status: 'completed', text: 'BP one twenty over sixty five.' }),
          { status: 200 },
        );
      }
      if (url.endsWith('/v2/transcript/tr-123') && method === 'DELETE') {
        return new Response('', { status: 200 });
      }
      return new Response('not-found', { status: 404 });
    }) as typeof fetch;

    const out = await transcribeInMemoryAudio(env, new Uint8Array([1, 2, 3, 4]), 'audio/webm');
    expect(out.text).toBe('BP one twenty over sixty five.');

    const methodsByUrl = calls.map((c) => `${c.method} ${c.url}`);
    expect(methodsByUrl[0]).toContain('POST https://api.assemblyai.com/v2/upload');
    expect(methodsByUrl[1]).toContain('POST https://api.assemblyai.com/v2/transcript');
    expect(methodsByUrl.filter((m) => m.startsWith('GET')).length).toBeGreaterThanOrEqual(2);
    // best-effort delete fires after we return; allow a microtask flush before asserting.
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(true);
  }, 15_000);

  it('throws stt_provider_error when AssemblyAI reports `error` status', async () => {
    const env = testEnv({ STT_PROVIDER: 'assemblyai', STT_API_KEY: 'aai-key' });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url.endsWith('/v2/upload')) return new Response(JSON.stringify({ upload_url: 'https://cdn/x' }), { status: 200 });
      if (url.endsWith('/v2/transcript') && method === 'POST') {
        return new Response(JSON.stringify({ id: 'bad' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'error', error: 'audio_too_short' }), { status: 200 });
    }) as typeof fetch;

    await expect(transcribeInMemoryAudio(env, new Uint8Array([1]), 'audio/webm')).rejects.toMatchObject({
      code: 'stt_provider_error',
    });
  }, 10_000);
});
