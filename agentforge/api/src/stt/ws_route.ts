/**
 * PRD §5.8 — WebSocket `/stt/stream`. First frame must be JSON `auth`; then `start` / binary chunks / `stop`.
 * No audio is written to disk (buffers RAM-only until forwarded to provider).
 */

import type { Context } from 'hono';
import type { UpgradeWebSocket, WSContext } from 'hono/ws';
import type { Pool } from 'pg';
import type { WebSocket as NodeWs } from 'ws';
import { z } from 'zod';
import { insertConversationRow } from '../conversations/store.js';
import type { Env } from '../env.js';
import { verifySessionToken } from '../handshake/sessionToken.js';
import {
  appendTranscriptSegment,
  finalizeTranscript,
  insertTranscriptRow,
  nextTranscriptSegmentSeq,
} from '../transcripts/store.js';
import { transcribeInMemoryAudio } from './transcribe.js';

const authMsgSchema = z.object({
  type: z.literal('auth'),
  session_token: z.string().min(1),
  patient_uuid: z.string().min(1),
  conversation_id: z.string().uuid(),
});

const startMsgSchema = z.object({
  type: z.literal('start'),
  mime_type: z.string().min(1).optional(),
  mode: z.enum(['tap', 'hold']).optional(),
});

const stopMsgSchema = z.object({
  type: z.literal('stop'),
});

const endSessionSchema = z.object({
  type: z.literal('end_session'),
});

type SttWsBag = {
  phase: 'authed' | 'recording';
  transcriptId: number;
  audioChunks: Uint8Array[];
  mimeType: string;
};

const sttBags = new WeakMap<NodeWs, SttWsBag>();

function sendJson(ws: NodeWs, payload: unknown): void {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* socket already closed; nothing useful to do */
  }
}

function rawSocket(ws: WSContext<NodeWs>): NodeWs {
  const r = ws.raw;
  if (r === undefined) {
    throw new Error('stt_ws_missing_raw_socket');
  }
  return r;
}

function concatAudio(chunks: readonly Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function registerSttStreamRoute(
  app: { get: (path: string, handler: unknown) => unknown },
  upgradeWebSocket: UpgradeWebSocket<NodeWs, { onError: (err: unknown) => void }>,
  env: Env,
  pool: Pool,
): void {
  app.get(
    '/stt/stream',
    upgradeWebSocket((_c: Context) => ({
      onOpen(_evt, ws) {
        sendJson(rawSocket(ws), { type: 'ready', provider: env.STT_PROVIDER });
      },
      async onMessage(evt, ws) {
        const sock = rawSocket(ws);
        try {
          await handleMessage(env, pool, sock, evt.data);
        } catch {
          // Defensive shield: any unhandled async rejection inside onMessage would
          // otherwise crash the Node process. Surface a generic error frame so the
          // CUI can react instead of timing out into a misleading message.
          sendJson(sock, { type: 'error', code: 'internal_error' });
        }
      },
    })),
  );
}

export async function handleMessage(
  env: Env,
  pool: Pool,
  sock: NodeWs,
  data: unknown,
): Promise<void> {
  if (typeof data === 'string') {
    await handleControlFrame(env, pool, sock, data);
    return;
  }

  const bag = sttBags.get(sock);
  if (bag === undefined || bag.phase !== 'recording') {
    return;
  }
  let buf: Uint8Array;
  if (data instanceof ArrayBuffer) {
    buf = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    buf = data;
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    buf = new Uint8Array(data);
  } else {
    return;
  }
  bag.audioChunks.push(buf);
}

async function handleControlFrame(env: Env, pool: Pool, sock: NodeWs, raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    sendJson(sock, { type: 'error', code: 'invalid_json' });
    return;
  }

  const auth = authMsgSchema.safeParse(parsed);
  if (auth.success) {
    await handleAuth(env, pool, sock, auth.data);
    return;
  }

  const start = startMsgSchema.safeParse(parsed);
  if (start.success) {
    handleStart(sock, start.data);
    return;
  }

  const stop = stopMsgSchema.safeParse(parsed);
  if (stop.success) {
    await handleStop(env, pool, sock);
    return;
  }

  const endSess = endSessionSchema.safeParse(parsed);
  if (endSess.success) {
    await handleEndSession(pool, sock);
    return;
  }

  sendJson(sock, { type: 'error', code: 'unknown_control' });
}

async function handleAuth(
  env: Env,
  pool: Pool,
  sock: NodeWs,
  msg: z.infer<typeof authMsgSchema>,
): Promise<void> {
  const sess = verifySessionToken(msg.session_token, env.SESSION_TOKEN_SECRET);
  if (sess === null) {
    sendJson(sock, { type: 'error', code: 'unauthenticated' });
    return;
  }
  if (sess.patient_uuid?.toLowerCase() !== msg.patient_uuid.toLowerCase()) {
    sendJson(sock, { type: 'error', code: 'patient_mismatch' });
    return;
  }

  try {
    // Upsert: the CUI may mint a fresh conversation id at handshake-ready and
    // start dictation before any /chat round-trip. PRD §5.5 patient binding is
    // enforced inside insertConversationRow (throws conversation_patient_mismatch
    // if the row already exists for a different patient).
    const conv = await insertConversationRow(pool, msg.conversation_id, msg.patient_uuid);
    // Insert the transcript row BEFORE telling the client we're authed, so a
    // failure here doesn't leave the client thinking the channel is good.
    const tid = await insertTranscriptRow(pool, {
      conversationInternalId: conv.internalId,
      physicianUserId: sess.user_id,
      patientUuid: msg.patient_uuid,
      encounterId: sess.encounter_id,
    });
    sttBags.set(sock, {
      phase: 'authed',
      transcriptId: tid,
      audioChunks: [],
      mimeType: 'audio/webm',
    });
    sendJson(sock, { type: 'authed' });
  } catch (e) {
    const errCode = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
    const code =
      errCode === 'conversation_patient_mismatch' ? 'conversation_patient_mismatch' : 'auth_failed';
    sendJson(sock, { type: 'error', code });
  }
}

function handleStart(sock: NodeWs, msg: z.infer<typeof startMsgSchema>): void {
  const bag = sttBags.get(sock);
  if (bag === undefined) {
    sendJson(sock, { type: 'error', code: 'not_authenticated' });
    return;
  }
  const next: SttWsBag = {
    phase: 'recording',
    transcriptId: bag.transcriptId,
    audioChunks: [],
    mimeType: msg.mime_type !== undefined && msg.mime_type.trim() !== '' ? msg.mime_type : 'audio/webm',
  };
  sttBags.set(sock, next);
  sendJson(sock, { type: 'recording', mode: msg.mode ?? 'tap' });
}

async function handleStop(env: Env, pool: Pool, sock: NodeWs): Promise<void> {
  const bag = sttBags.get(sock);
  if (bag === undefined || bag.phase !== 'recording') {
    sendJson(sock, { type: 'error', code: 'not_recording' });
    return;
  }
  try {
    const merged = concatAudio(bag.audioChunks);
    const mimeType = bag.mimeType;
    const transcriptId = bag.transcriptId;
    sttBags.set(sock, {
      phase: 'authed',
      transcriptId,
      audioChunks: [],
      mimeType,
    });
    const { text } = await transcribeInMemoryAudio(env, merged, mimeType);
    const seq = await nextTranscriptSegmentSeq(pool, transcriptId);
    await appendTranscriptSegment(pool, {
      transcriptId,
      seq,
      speakerRole: 'physician',
      text,
      isFinal: true,
    });
    sendJson(sock, { type: 'final', text, seq });
  } catch (e) {
    // Preserve upstream code (e.g. `stt_provider_error` from transcribe.ts) so
    // the CUI banner can surface the actual reason instead of a generic blob.
    const upstream = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
    const code = typeof upstream === 'string' && upstream !== '' ? upstream : 'stt_failed';
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ phase: 'stt_finalize_failed', code, message }));
    sendJson(sock, { type: 'error', code });
  }
}

async function handleEndSession(pool: Pool, sock: NodeWs): Promise<void> {
  const bag = sttBags.get(sock);
  if (bag !== undefined) {
    try {
      await finalizeTranscript(pool, bag.transcriptId);
    } catch {
      /* finalize is best-effort; transcript persistence already happened */
    }
    sttBags.delete(sock);
  }
  sendJson(sock, { type: 'session_ended' });
}
