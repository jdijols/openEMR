/**
 * Black-box HTTP client for the W2 Clinical Co-Pilot target.
 *
 * Mints HMAC session tokens locally (must match SESSION_TOKEN_SECRET in the
 * target's env) and consumes the /chat SSE stream. Treats the target as a
 * network black box — no shared code with the target's runtime.
 */
import { createHmac } from 'node:crypto';

export type TargetConfig = {
  baseUrl: string;
  sessionSecret: string;
  patientUuid: string;
  userId: number;
};

type SessionTokenIdentity = {
  user_id: number;
  patient_uuid: string | null;
  encounter_id: number | null;
  facility_tz: string | null;
};

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function hmacSha256Base64Url(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function mintSessionToken(
  identity: SessionTokenIdentity,
  secret: string,
  ttlSec = 3600,
): string {
  if (secret.length < 32) {
    throw new Error('SESSION_TOKEN_SECRET too short (need ≥32 chars)');
  }
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: identity.user_id,
    patient_uuid: identity.patient_uuid,
    encounter_id: identity.encounter_id,
    facility_tz: identity.facility_tz,
    iat: now,
    exp: now + ttlSec,
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = hmacSha256Base64Url(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export type ChatResponse = {
  rawSse: string;
  finalText: string;
  routingEvents: string[];
  correlationId: string | null;
  errorKind: string | null;
  latencyMs: number;
};

export async function sendChat(
  cfg: TargetConfig,
  message: string,
): Promise<ChatResponse> {
  const sessionToken = mintSessionToken(
    {
      user_id: cfg.userId,
      patient_uuid: cfg.patientUuid,
      encounter_id: null,
      facility_tz: 'America/Chicago',
    },
    cfg.sessionSecret,
  );

  const url = new URL('/chat', cfg.baseUrl).toString();
  const body = JSON.stringify({
    session_token: sessionToken,
    patient_uuid: cfg.patientUuid,
    message,
  });

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': 'text/event-stream',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      rawSse: text,
      finalText: '',
      routingEvents: [],
      correlationId: null,
      errorKind: `http_${res.status}`,
      latencyMs: Date.now() - t0,
    };
  }

  if (!res.body) {
    return {
      rawSse: '',
      finalText: '',
      routingEvents: [],
      correlationId: null,
      errorKind: 'empty_body',
      latencyMs: Date.now() - t0,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const events: Array<{ event: string; data: string }> = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffered.indexOf('\n\n')) !== -1) {
      const chunk = buffered.slice(0, idx);
      buffered = buffered.slice(idx + 2);
      const lines = chunk.split('\n');
      let evt = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) evt = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      events.push({ event: evt, data: dataLines.join('\n') });
    }
  }

  const latencyMs = Date.now() - t0;
  let finalText = '';
  let correlationId: string | null = null;
  let errorKind: string | null = null;
  const routingEvents: string[] = [];

  for (const e of events) {
    if (e.event === 'routing') {
      routingEvents.push(e.data);
    } else if (e.event === 'final') {
      try {
        const parsed = JSON.parse(e.data) as {
          blocks?: unknown;
          correlation_id?: string;
        };
        if (typeof parsed.correlation_id === 'string') {
          correlationId = parsed.correlation_id;
        }
        finalText = extractTextFromBlocks(parsed.blocks);
      } catch {
        // Leave finalText empty; the raw SSE is still preserved.
      }
    } else if (e.event === 'error') {
      try {
        const parsed = JSON.parse(e.data) as { error?: string; correlation_id?: string };
        errorKind = parsed.error ?? 'error';
        if (typeof parsed.correlation_id === 'string') {
          correlationId = parsed.correlation_id;
        }
      } catch {
        errorKind = 'error';
      }
    }
  }

  const rawSse = events.map((e) => `event: ${e.event}\ndata: ${e.data}`).join('\n\n');

  return { rawSse, finalText, routingEvents, correlationId, errorKind, latencyMs };
}

function extractTextFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const parts: string[] = [];
  for (const b of blocks) {
    if (b && typeof b === 'object') {
      const rec = b as Record<string, unknown>;
      // Common shapes: { type: 'text', text: '...' }, { type: 'message', content: '...' },
      // { kind: 'assistant_text', text: '...' }, { content: '...' }
      const text =
        (typeof rec.text === 'string' && rec.text) ||
        (typeof rec.content === 'string' && rec.content) ||
        (typeof rec.body === 'string' && rec.body) ||
        '';
      if (text) parts.push(text);
      // Nested content arrays (Claude-style):
      if (Array.isArray(rec.content)) {
        for (const c of rec.content) {
          if (c && typeof c === 'object') {
            const inner = c as Record<string, unknown>;
            if (typeof inner.text === 'string') parts.push(inner.text);
          }
        }
      }
    }
  }
  return parts.join('\n');
}
