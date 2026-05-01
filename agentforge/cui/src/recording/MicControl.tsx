/**
 * PRD §6.4 — physician dictation. Streams audio over WS to §5.8 relay (no local persistence).
 *
 * DIVERGENCE-PRD-6.4: This control intentionally diverges from PRD §6.4 in two ways
 * (per explicit user UX direction, captured in plans/cui_compose_row_redesign):
 *   1. The "Physician dictation only — no audio retained" disclaimer is not rendered
 *      here. The host UX relies on out-of-band trust copy.
 *   2. There is no Tap-vs-Hold mode setting. A single button serves BOTH PRD acceptance
 *      scenarios (lines 869, 877): a quick tap toggles recording on/off, and a sustained
 *      press records while held and stops on release. The HOLD_THRESHOLD_MS constant
 *      decides which behavior wins on each press.
 *
 * Errors are surfaced to the parent via the `onLocalError(message|null)` callback so the
 * App shell can render them above the compose row alongside chat send failures.
 */

import type { PointerEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const HOLD_THRESHOLD_MS = 250;

export type MicControlProps = Readonly<{
  apiBase: string;
  sessionToken: string;
  patientUuid: string;
  conversationExternalId: string | null;
  disabled?: boolean;
  onFinalTranscript: (text: string) => void;
  onStreamError?: (code: string) => void;
  onLocalError?: (message: string | null) => void;
}>;

function toSttWsUrl(apiBase: string): string {
  const u = new URL(apiBase);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/stt/stream';
  u.search = '';
  u.hash = '';
  return u.toString();
}

function pickRecorderMime(): string {
  const preferred = ['audio/webm;codecs=opus', 'audio/webm'];
  for (const p of preferred) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(p)) {
      return p;
    }
  }
  return '';
}

function waitWsOpen(ws: WebSocket, ms: number): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('ws_open_timeout')), ms);
    ws.addEventListener(
      'open',
      () => {
        window.clearTimeout(t);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      'error',
      () => {
        window.clearTimeout(t);
        reject(new Error('ws_error'));
      },
      { once: true },
    );
  });
}

function waitJsonMessage(ws: WebSocket, predicate: (j: unknown) => boolean, ms: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('msg_timeout')), ms);
    function onMsg(ev: MessageEvent): void {
      let j: unknown;
      try {
        j = JSON.parse(String(ev.data)) as unknown;
      } catch {
        return;
      }
      if (predicate(j)) {
        window.clearTimeout(t);
        ws.removeEventListener('message', onMsg);
        resolve(j);
      }
    }
    ws.addEventListener('message', onMsg);
  });
}

type AuthResult = { ok: true } | { ok: false; code: string };

/**
 * Waits for either `{ type: "authed" }` (success) or `{ type: "error", code }`
 * (server rejected auth). Without this, an `error` frame would be ignored and
 * the client would sit on a generic "authentication failed" timeout, hiding the
 * actual server-side reason (e.g. `auth_failed`, `conversation_patient_mismatch`).
 */
function waitAuthResult(ws: WebSocket, ms: number): Promise<AuthResult> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('auth_timeout')), ms);
    function onMsg(ev: MessageEvent): void {
      let j: unknown;
      try {
        j = JSON.parse(String(ev.data)) as unknown;
      } catch {
        return;
      }
      if (j === null || typeof j !== 'object') {
        return;
      }
      const o = j as { type?: unknown; code?: unknown };
      if (o.type === 'authed') {
        window.clearTimeout(t);
        ws.removeEventListener('message', onMsg);
        resolve({ ok: true });
        return;
      }
      if (o.type === 'error') {
        const code = typeof o.code === 'string' && o.code !== '' ? o.code : 'unknown';
        window.clearTimeout(t);
        ws.removeEventListener('message', onMsg);
        resolve({ ok: false, code });
      }
    }
    ws.addEventListener('message', onMsg);
  });
}

export default function MicControl(props: MicControlProps): ReactElement {
  const [recording, setRecording] = useState(false);

  const onFinalRef = useRef(props.onFinalTranscript);
  const onErrRef = useRef(props.onStreamError);
  const onLocalErrRef = useRef(props.onLocalError);
  useEffect(() => {
    onFinalRef.current = props.onFinalTranscript;
  }, [props.onFinalTranscript]);
  useEffect(() => {
    onErrRef.current = props.onStreamError;
  }, [props.onStreamError]);
  useEffect(() => {
    onLocalErrRef.current = props.onLocalError;
  }, [props.onLocalError]);

  const reportError = useCallback((msg: string | null): void => {
    onLocalErrRef.current?.(msg);
  }, []);

  const sessionRef = useRef<{
    ws: WebSocket;
    rec: MediaRecorder;
    stream: MediaStream;
    mime: string;
  } | null>(null);

  // Tracks the in-flight press: when the pointer went down, and whether the button
  // was already recording at press time. These together drive the hybrid tap/hold
  // decision in onPointerUp (see DIVERGENCE-PRD-6.4 in the file header).
  const pressRef = useRef<{ start: number; startedRecording: boolean; active: boolean } | null>(null);

  const teardown = useCallback((): void => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s === null) {
      return;
    }
    try {
      if (s.rec.state !== 'inactive') {
        s.rec.stop();
      }
    } catch {
      /* ignore */
    }
    try {
      if (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING) {
        s.ws.close();
      }
    } catch {
      /* ignore */
    }
    for (const t of s.stream.getTracks()) {
      t.stop();
    }
    setRecording(false);
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (
      props.disabled === true ||
      props.conversationExternalId === null ||
      props.conversationExternalId.trim() === ''
    ) {
      return;
    }

    if (sessionRef.current !== null) {
      return;
    }

    reportError(null);

    const mimePick = pickRecorderMime();
    const mime = mimePick !== '' ? mimePick : 'audio/webm';

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      reportError('Microphone access required for visit transcript.');
      return;
    }

    const ws = new WebSocket(toSttWsUrl(props.apiBase));
    ws.binaryType = 'arraybuffer';

    try {
      await waitWsOpen(ws, 8000);
    } catch {
      for (const t of stream.getTracks()) {
        t.stop();
      }
      reportError('Could not open dictation channel.');
      return;
    }

    await waitJsonMessage(ws, (j) => j !== null && typeof j === 'object' && (j as { type?: unknown }).type === 'ready', 8000).catch(
      () => undefined,
    );

    ws.send(
      JSON.stringify({
        type: 'auth',
        session_token: props.sessionToken,
        patient_uuid: props.patientUuid,
        conversation_id: props.conversationExternalId,
      }),
    );

    let authResult: AuthResult;
    try {
      authResult = await waitAuthResult(ws, 8000);
    } catch {
      ws.close();
      for (const t of stream.getTracks()) {
        t.stop();
      }
      reportError('Dictation authentication timed out.');
      return;
    }
    if (!authResult.ok) {
      ws.close();
      for (const t of stream.getTracks()) {
        t.stop();
      }
      onErrRef.current?.(authResult.code);
      reportError(`Dictation init failed (${authResult.code}). Check API logs.`);
      return;
    }

    let rec: MediaRecorder;
    try {
      rec = mimePick !== '' ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      ws.close();
      for (const t of stream.getTracks()) {
        t.stop();
      }
      reportError('Recording could not start.');
      return;
    }

    rec.addEventListener('dataavailable', (e: BlobEvent) => {
      if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        void e.data.arrayBuffer().then((buf) => {
          ws.send(buf);
        });
      }
    });

    function onServerMessage(ev: MessageEvent): void {
      let j: unknown;
      try {
        j = JSON.parse(String(ev.data)) as unknown;
      } catch {
        return;
      }
      if (!j || typeof j !== 'object') {
        return;
      }
      const typ = (j as { type?: unknown }).type;
      if (typ === 'final' && typeof (j as { text?: unknown }).text === 'string') {
        const text = String((j as { text: string }).text).trim();
        ws.removeEventListener('message', onServerMessage);
        teardown();
        if (text !== '') {
          onFinalRef.current(text);
        }
        return;
      }
      if (typ === 'error') {
        const code = typeof (j as { code?: unknown }).code === 'string' ? (j as { code: string }).code : 'unknown';
        onErrRef.current?.(code);
        reportError(`Dictation failed (${code}). Try again.`);
        ws.removeEventListener('message', onServerMessage);
        teardown();
      }
    }

    ws.addEventListener('message', onServerMessage);

    rec.start(250);
    // Backward-compat: the relay accepts `mode` as a hint only. Keeping the existing
    // wire shape here lets us drop the radio UI without coordinating an API change.
    ws.send(JSON.stringify({ type: 'start', mime_type: mime, mode: 'tap' }));
    sessionRef.current = { ws, rec, stream, mime };
    setRecording(true);
  }, [
    props.apiBase,
    props.conversationExternalId,
    props.disabled,
    props.patientUuid,
    props.sessionToken,
    teardown,
    reportError,
  ]);

  const stopRecording = useCallback(async (): Promise<void> => {
    const s = sessionRef.current;
    if (s === null) {
      return;
    }

    const { ws, rec } = s;
    await new Promise<void>((resolve) => {
      rec.addEventListener('stop', () => resolve(), { once: true });
      try {
        if (rec.state !== 'inactive') {
          rec.stop();
        } else {
          resolve();
        }
      } catch {
        resolve();
      }
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
    }
  }, []);

  const micDisabled =
    props.disabled === true ||
    props.conversationExternalId === null ||
    props.conversationExternalId.trim() === '';

  function onPointerDown(e: PointerEvent<HTMLButtonElement>): void {
    if (e.button !== 0 || micDisabled) {
      return;
    }
    pressRef.current = {
      start: Date.now(),
      startedRecording: recording,
      active: true,
    };
    if (!recording) {
      void startRecording();
    }
  }

  function onPointerUp(e: PointerEvent<HTMLButtonElement>): void {
    if (e.button !== 0) {
      return;
    }
    const press = pressRef.current;
    if (press === null || !press.active) {
      return;
    }
    pressRef.current = null;
    const duration = Date.now() - press.start;
    if (press.startedRecording) {
      // Tap on an already-recording button: toggle off.
      void stopRecording();
      return;
    }
    if (duration >= HOLD_THRESHOLD_MS) {
      // Long press released: end the hold session.
      void stopRecording();
      return;
    }
    // Short tap from a non-recording state: leave it on; the user will tap again to stop.
  }

  function onPointerCancelOrLeave(e: PointerEvent<HTMLButtonElement>): void {
    const press = pressRef.current;
    if (press === null || !press.active) {
      return;
    }
    // Only treat as a hold-release if the press has crossed the hold threshold and
    // started a fresh recording. Short taps that drag off the button keep the press
    // alive (the user may pointerup elsewhere); the captured pointer keeps fire on us
    // when we use setPointerCapture, so this branch is mostly a safety net.
    if (!press.startedRecording && Date.now() - press.start >= HOLD_THRESHOLD_MS) {
      pressRef.current = null;
      void stopRecording();
      return;
    }
    if (e.type === 'pointercancel') {
      pressRef.current = null;
    }
  }

  function onPointerDownCapture(e: PointerEvent<HTMLButtonElement>): void {
    // Capture the pointer so pointerup fires on the button even if the cursor leaves
    // its bounding box during a long press.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not all browsers expose pointer capture on buttons; safe to ignore */
    }
  }

  return (
    <button
      type="button"
      className={`agentforge-cui__mic-btn${recording ? ' agentforge-cui__mic-btn--recording' : ''}`}
      disabled={micDisabled}
      aria-pressed={recording}
      onPointerDown={(e) => {
        onPointerDownCapture(e);
        onPointerDown(e);
      }}
      onPointerUp={(e) => onPointerUp(e)}
      onPointerCancel={(e) => onPointerCancelOrLeave(e)}
      onPointerLeave={(e) => onPointerCancelOrLeave(e)}
    >
      {recording ?
        <span className="agentforge-cui__mic-dot" aria-hidden />
      : null}
      {recording ? 'Stop dictation' : 'Start dictation'}
    </button>
  );
}
