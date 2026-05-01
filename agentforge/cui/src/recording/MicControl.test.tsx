/**
 * Gate 5 G5-03 — mic UI (PRD §6.4): permission error, WS auth error.
 * Plus mic-enabled-on-load + auth-error-code surface.
 *
 * The disclaimer / mode-selector tests have been removed alongside the
 * MicControl UX simplification (DIVERGENCE-PRD-6.4 — see MicControl.tsx).
 *
 * The button now responds to pointer events (not click) because the hybrid
 * tap+hold UX needs press-down vs press-up timing. Tests dispatch pointerdown
 * to trigger startRecording.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MicControl from './MicControl.js';

describe('MicControl', () => {
  const onFinal = vi.fn();

  beforeEach(() => {
    onFinal.mockReset();
    const gUM = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: gUM },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces a microphone error via onLocalError when getUserMedia fails', async () => {
    const onLocalError = vi.fn();
    render(
      <MicControl
        apiBase="http://localhost:3000/"
        sessionToken="t"
        patientUuid="p"
        conversationExternalId="00000000-0000-4000-8000-0000000000aa"
        onFinalTranscript={onFinal}
        onLocalError={onLocalError}
      />,
    );

    const btn = screen.getByRole('button', { name: /Start dictation/u });
    await act(async () => {
      fireEvent.pointerDown(btn, { button: 0, pointerId: 1 });
    });

    await vi.waitFor(() => {
      expect(onLocalError).toHaveBeenCalledWith(expect.stringMatching(/Microphone access required/u));
    });
  });

  it('Start dictation is enabled on first render when conversationExternalId is supplied (mic-enabled-on-load)', () => {
    render(
      <MicControl
        apiBase="http://localhost:3000/"
        sessionToken="t"
        patientUuid="p"
        conversationExternalId="00000000-0000-4000-8000-0000000000aa"
        onFinalTranscript={onFinal}
      />,
    );

    const btn = screen.getByRole('button', { name: /Start dictation/u });
    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/visit thread id/u)).not.toBeInTheDocument();
  });

  it('Start dictation is disabled when conversationExternalId is null', () => {
    render(
      <MicControl
        apiBase="http://localhost:3000/"
        sessionToken="t"
        patientUuid="p"
        conversationExternalId={null}
        onFinalTranscript={onFinal}
      />,
    );

    const btn = screen.getByRole('button', { name: /Start dictation/u });
    expect(btn).toBeDisabled();
  });

  it('surfaces the server error code via onLocalError when WS auth returns an `error` frame', async () => {
    // Stub MediaRecorder and a controllable WebSocket so we can drive the auth
    // handshake to an `error` outcome and assert the code reaches the UI.
    type Listener = (ev: MessageEvent | Event) => void;
    class FakeWs {
      static OPEN = 1 as const;
      static CONNECTING = 0 as const;
      static CLOSED = 3 as const;
      readyState: number = 0;
      binaryType = 'arraybuffer';
      sent: string[] = [];
      private listeners = new Map<string, Set<Listener>>();
      constructor(public url: string) {
        setTimeout(() => {
          this.readyState = FakeWs.OPEN;
          this.dispatch('open', new Event('open'));
        }, 0);
        // Push `ready` on a separate tick so the client has time to await
        // waitWsOpen and attach its message listener before the frame arrives.
        // Without this split the predicate-based listener would miss `ready`.
        setTimeout(() => {
          this.dispatch(
            'message',
            new MessageEvent('message', { data: JSON.stringify({ type: 'ready', provider: 'mock' }) }),
          );
        }, 5);
      }
      addEventListener(t: string, l: Listener, _opts?: AddEventListenerOptions): void {
        if (!this.listeners.has(t)) this.listeners.set(t, new Set());
        this.listeners.get(t)?.add(l);
      }
      removeEventListener(t: string, l: Listener): void {
        this.listeners.get(t)?.delete(l);
      }
      dispatch(t: string, ev: MessageEvent | Event): void {
        for (const l of this.listeners.get(t) ?? new Set<Listener>()) l(ev);
      }
      send(payload: string): void {
        this.sent.push(payload);
        if (payload.includes('"type":"auth"')) {
          // Server says: "we couldn't init transcript persistence."
          setTimeout(() => {
            this.dispatch(
              'message',
              new MessageEvent('message', { data: JSON.stringify({ type: 'error', code: 'transcript_init_failed' }) }),
            );
          }, 0);
        }
      }
      close(): void {
        this.readyState = FakeWs.CLOSED;
      }
    }
    const realWs = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: typeof FakeWs }).WebSocket = FakeWs;

    const fakeStream = { getTracks: () => [{ stop: vi.fn() }] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });

    try {
      const onLocalError = vi.fn();
      render(
        <MicControl
          apiBase="http://localhost:3000/"
          sessionToken="t"
          patientUuid="p"
          conversationExternalId="00000000-0000-4000-8000-0000000000aa"
          onFinalTranscript={onFinal}
          onLocalError={onLocalError}
        />,
      );

      await act(async () => {
        fireEvent.pointerDown(screen.getByRole('button', { name: /Start dictation/u }), {
          button: 0,
          pointerId: 1,
        });
      });

      await vi.waitFor(() => {
        expect(onLocalError).toHaveBeenCalledWith(expect.stringMatching(/transcript_init_failed/u));
      });
      const calls = onLocalError.mock.calls.map((c) => String(c[0] ?? ''));
      expect(calls.some((m) => /Dictation init failed/u.test(m))).toBe(true);
    } finally {
      (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = realWs;
    }
  });
});

/** Minimal harness that mirrors how App.tsx feeds the conversation id into MicControl. */
function MicWithToggle(): ReactElement {
  const [convId, setConvId] = useState<string | null>(null);
  return (
    <div>
      <button type="button" onClick={() => setConvId('00000000-0000-4000-8000-0000000000aa')}>
        Mint
      </button>
      <MicControl
        apiBase="http://localhost:3000/"
        sessionToken="t"
        patientUuid="p"
        conversationExternalId={convId}
        onFinalTranscript={vi.fn()}
      />
    </div>
  );
}

describe('MicControl — conversationExternalId lifecycle', () => {
  it('starts disabled and becomes enabled once a conversation id is supplied', async () => {
    render(<MicWithToggle />);

    const startBtn = screen.getByRole('button', { name: /Start dictation/u });
    expect(startBtn).toBeDisabled();

    await act(async () => {
      screen.getByRole('button', { name: 'Mint' }).click();
    });

    expect(startBtn).not.toBeDisabled();
  });
});
