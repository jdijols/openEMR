/**
 * In-memory STT finalize — PRD §5.8 (no disk). Buffers stay in RAM until this returns.
 */

import type { Env } from '../env.js';

export type TranscribeOutcome = Readonly<{ text: string }>;

/** Query params hinting provider-side retention minimization where documented (Deepgram prerecorded). */
export function sttProviderRetentionQuery(provider: Env['STT_PROVIDER']): string {
  if (provider === 'deepgram') {
    return ''; // Prerecorded path: no separate retention flag in v1; BAA + no storage on our side.
  }
  if (provider === 'assemblyai') {
    return '';
  }
  return '';
}

export async function transcribeInMemoryAudio(
  env: Env,
  audio: Uint8Array,
  contentType: string,
): Promise<TranscribeOutcome> {
  if (env.STT_PROVIDER === 'mock') {
    const hint =
      audio.length === 0 ?
        ''
      : `(mock-${audio.length}-bytes)`;
    return { text: `Mock dictation ${hint}`.trim() };
  }

  if (env.STT_PROVIDER === 'assemblyai') {
    return await transcribeAssemblyAi(env.STT_API_KEY, audio);
  }

  const url = `https://api.deepgram.com/v1/listen?model=nova-2`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Token ${env.STT_API_KEY}`,
        'Content-Type': contentType !== '' ? contentType : 'application/octet-stream',
      },
      body: Buffer.from(audio),
    });
  } catch {
    throw Object.assign(new Error('stt_network_error'), { code: 'stt_provider_error' });
  }

  if (!res.ok) {
    throw Object.assign(new Error('stt_upstream_error'), { code: 'stt_provider_error' });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw Object.assign(new Error('stt_bad_response'), { code: 'stt_provider_error' });
  }

  const text = extractDeepgramTranscript(json);
  return { text };
}

/**
 * AssemblyAI prerecorded flow (PRD §5.8 — no audio retained on our side):
 *   1) POST /v2/upload — returns a private `upload_url` we never persist.
 *   2) POST /v2/transcript with `{ audio_url }` — returns a transcript id.
 *   3) Poll GET /v2/transcript/{id} until status is `completed` or `error`.
 *   4) Best-effort DELETE so the transcript text isn't retained on the vendor side.
 *
 * The whole flow runs in-process; the audio bytes never touch disk.
 */
async function transcribeAssemblyAi(apiKey: string, audio: Uint8Array): Promise<TranscribeOutcome> {
  const auth = { authorization: apiKey };

  let uploadRes: Response;
  try {
    uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/octet-stream' },
      body: Buffer.from(audio),
    });
  } catch {
    throw Object.assign(new Error('stt_network_error'), { code: 'stt_provider_error' });
  }
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '<no-body>');
    throw Object.assign(new Error(`stt_upload_${uploadRes.status}: ${body.slice(0, 200)}`), {
      code: 'stt_provider_error',
    });
  }

  let uploadJson: unknown;
  try {
    uploadJson = await uploadRes.json();
  } catch {
    throw Object.assign(new Error('stt_upload_bad_response'), { code: 'stt_provider_error' });
  }
  const audioUrl =
    uploadJson !== null && typeof uploadJson === 'object' ?
      (uploadJson as Record<string, unknown>)['upload_url']
    : undefined;
  if (typeof audioUrl !== 'string' || audioUrl === '') {
    throw Object.assign(new Error('stt_upload_no_url'), { code: 'stt_provider_error' });
  }

  let submitRes: Response;
  try {
    submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      // AssemblyAI now requires an explicit `speech_models` list (per their API as
      // of 2026-Q2 — see error: `"speech_models" must be a non-empty list containing
      // one or more of: "universal-3-pro", "universal-2"`). `universal-2` is the
      // broadly-available baseline tier; `universal-3-pro` is premium.
      body: JSON.stringify({ audio_url: audioUrl, speech_models: ['universal-2'] }),
    });
  } catch {
    throw Object.assign(new Error('stt_network_error'), { code: 'stt_provider_error' });
  }
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '<no-body>');
    throw Object.assign(new Error(`stt_submit_${submitRes.status}: ${body.slice(0, 200)}`), {
      code: 'stt_provider_error',
    });
  }

  let submitJson: unknown;
  try {
    submitJson = await submitRes.json();
  } catch {
    throw Object.assign(new Error('stt_submit_bad_response'), { code: 'stt_provider_error' });
  }
  const id =
    submitJson !== null && typeof submitJson === 'object' ?
      (submitJson as Record<string, unknown>)['id']
    : undefined;
  if (typeof id !== 'string' || id === '') {
    throw Object.assign(new Error('stt_submit_no_id'), { code: 'stt_provider_error' });
  }

  // Poll: AssemblyAI prerecorded turnaround for short audio is typically 2-5s.
  // Cap at 30s so a stuck job doesn't hang a WS message handler indefinitely.
  const deadline = Date.now() + 30_000;
  let text = '';
  while (Date.now() < deadline) {
    await sleep(700);
    let pollRes: Response;
    try {
      pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { ...auth },
      });
    } catch {
      continue;
    }
    if (!pollRes.ok) {
      throw Object.assign(new Error(`stt_poll_${pollRes.status}`), { code: 'stt_provider_error' });
    }
    const pj = (await pollRes.json().catch(() => null)) as Record<string, unknown> | null;
    if (pj === null) {
      continue;
    }
    const status = pj['status'];
    if (status === 'completed') {
      const t = pj['text'];
      text = typeof t === 'string' ? t.trim() : '';
      break;
    }
    if (status === 'error') {
      const errMsg = typeof pj['error'] === 'string' ? (pj['error'] as string) : 'transcription_error';
      throw Object.assign(new Error(errMsg), { code: 'stt_provider_error' });
    }
    // status === 'queued' | 'processing' — keep polling.
  }

  if (text === '' && Date.now() >= deadline) {
    throw Object.assign(new Error('stt_poll_timeout'), { code: 'stt_provider_error' });
  }

  // Best-effort retention minimization (PRD §5.8). Don't await — failures here
  // shouldn't block returning the transcript text the physician already saw.
  void fetch(`https://api.assemblyai.com/v2/transcript/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { ...auth },
  }).catch(() => undefined);

  return { text };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractDeepgramTranscript(json: unknown): string {
  if (!json || typeof json !== 'object') {
    return '';
  }
  const ch = (json as Record<string, unknown>)['results'];
  if (!ch || typeof ch !== 'object') {
    return '';
  }
  const channels = (ch as Record<string, unknown>)['channels'];
  if (!Array.isArray(channels) || channels.length === 0) {
    return '';
  }
  const first = channels[0];
  if (!first || typeof first !== 'object') {
    return '';
  }
  const alts = (first as Record<string, unknown>)['alternatives'];
  if (!Array.isArray(alts) || alts.length === 0) {
    return '';
  }
  const a0 = alts[0];
  if (!a0 || typeof a0 !== 'object') {
    return '';
  }
  const t = (a0 as Record<string, unknown>)['transcript'];
  return typeof t === 'string' ? t.trim() : '';
}
