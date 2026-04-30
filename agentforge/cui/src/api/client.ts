import type { ChatBlock, ChatResponse, RedeemResponse } from '../types/chat.js';

function stripBase(base: string): string {
  return base.replace(/\/$/, '');
}

function randomCorrelationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const redeemInflight = new Map<string, Promise<RedeemResponse>>();

function redeemKey(apiBase: string, launchCode: string): string {
  return `${stripBase(apiBase)}\0${launchCode}`;
}

async function redeemHandshakeRequest(apiBase: string, launchCode: string): Promise<RedeemResponse> {
  const base = stripBase(apiBase);
  const res = await fetch(`${base}/handshake/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': randomCorrelationId(),
    },
    body: JSON.stringify({ launch_code: launchCode }),
  });

  if (!res.ok) {
    throw new Error('handshake_failed');
  }

  const json: unknown = await res.json();
  if (
    !json ||
    typeof json !== 'object' ||
    typeof (json as { session_token?: unknown }).session_token !== 'string'
  ) {
    throw new Error('handshake_invalid_response');
  }

  return json as RedeemResponse;
}

/**
 * Redeem once per (apiBase, launchCode) in flight — React StrictMode mounts twice in dev;
 * launch codes are single-use server-side.
 */
export function redeemHandshake(apiBase: string, launchCode: string): Promise<RedeemResponse> {
  const key = redeemKey(apiBase, launchCode);
  const hit = redeemInflight.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const p = redeemHandshakeRequest(apiBase, launchCode);
  redeemInflight.set(key, p);
  // Cleanup chain swallows rejection so the dedupe map is cleared without
  // surfacing a duplicate "unhandled rejection" — callers still receive the
  // original rejection from `p`.
  p.catch(() => undefined).finally(() => {
    redeemInflight.delete(key);
  });
  return p;
}

export async function postChat(
  apiBase: string,
  sessionToken: string,
  patientUuid: string,
  message: string,
): Promise<{ blocks: ChatBlock[]; correlationId: string }> {
  const base = stripBase(apiBase);
  const correlationId = randomCorrelationId();
  const res = await fetch(`${base}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': correlationId,
    },
    body: JSON.stringify({
      session_token: sessionToken,
      patient_uuid: patientUuid,
      message,
    }),
  });

  const json: unknown = await res.json().catch(() => null);

  if (res.status === 501) {
    throw new Error('api_misconfigured_llm');
  }

  if (!res.ok) {
    throw new Error('chat_failed');
  }

  if (
    !json ||
    typeof json !== 'object' ||
    (json as { ok?: unknown }).ok !== true ||
    !Array.isArray((json as ChatResponse).blocks)
  ) {
    throw new Error('chat_invalid_response');
  }

  const body = json as ChatResponse;
  return { blocks: body.blocks, correlationId: body.correlation_id ?? correlationId };
}
