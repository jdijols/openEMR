/**
 * Per-tab payload cache for the rail conversation — the client-side
 * mirror of the brief cache pattern (`brief_cache.ts`), extended to the
 * full `messages` array so a hard reload (Refresh chart, panel remount,
 * pid-poll re-entry) doesn't wipe an in-progress dialog.
 *
 * Why a payload cache and not a full server-side conversation fetch:
 *   The Agent API's `agentforge.conversations` row already exists for
 *   audit / proposal lifecycle, but rendering history server-side would
 *   require a `/conversations/:id/messages` endpoint, replay of tool
 *   blocks, and re-resolution of citation_navigation hints — none of
 *   which exist today. The per-tab cache is a one-night ship that fully
 *   matches the rail's pre-reload visual state because it stores the
 *   rendered payload verbatim.
 *
 * Why sessionStorage and not localStorage:
 *   The conversation is scoped to a single tab's clinical session, not
 *   the user's account. A second tab opening the same patient deserves
 *   a fresh conversation surface (the brief still cache-hits via the
 *   server-side `(user_id, patient_uuid)` cache).
 *
 * Why key on patient_uuid only (NOT encounter_id):
 *   Mirrors the deliberate decision in the brief consistency cache
 *   journal (2026-05-01): the brief itself is keyed on
 *   `(user_id, patient_uuid)` with no encounter component. The
 *   conversation is downstream of the brief — there's no use case where
 *   a brief replays from cache but the conversation that referenced it
 *   should not. Adding `encounter_id` here would defeat the
 *   "physician revisits the same patient → conversation is still here"
 *   property the user explicitly asked for.
 *
 * What is persisted:
 *   - The full `ChatMessage[]` array (role, blocks, citation_navigation,
 *     source). Includes assistant text, claim, warning, refusal, tool
 *     blocks, AND proposal blocks with their `resolved` field — that's
 *     why `ProposalResolution` was lifted into the ChatBlock type.
 *
 * What is NOT persisted:
 *   - `briefStatus`, `sending`, `sendFailure`, `input`, `dictationState`,
 *     `voiceCompletedProposalIds`, mic recorder state. All of those are
 *     ephemeral UI affordances that should reset on remount.
 *   - The `submitting` phase of an in-flight proposal confirm/reject —
 *     not a terminal state, so by construction it never enters the
 *     `resolved` field. A reload mid-submit drops back to `idle`; the
 *     server's `not_pending` check in `confirmPendingProposal` makes a
 *     duplicate click safe.
 *
 * Bounds:
 *   - 2-hour TTL matches the brief cache.
 *   - 8-patient cap (LRU) keeps the per-tab footprint bounded for
 *     physicians sweeping through a panel of patients.
 */

import type { ChatMessage } from '../types/chat.js';

const KEY_PREFIX = 'agentforge:conversation_payload:';
const INDEX_KEY = 'agentforge:conversation_payload:__index';
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_PATIENTS = 8;

export type CachedConversationPayload = {
  readonly messages: readonly ChatMessage[];
};

type StoredPayload = CachedConversationPayload & { readonly storedAt: number };

export function conversationPayloadStorageKey(patientUuid: string): string {
  return `${KEY_PREFIX}${patientUuid}`;
}

function readIndex(): string[] {
  try {
    const raw = window.sessionStorage.getItem(INDEX_KEY);
    if (raw === null || raw === '') {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function writeIndex(index: readonly string[]): void {
  try {
    window.sessionStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* sessionStorage may be unavailable; cache becomes a no-op which
       is acceptable degradation — the conversation simply doesn't
       persist across reloads in that environment. */
  }
}

function touchIndex(patientUuid: string): void {
  const idx = readIndex().filter((p) => p !== patientUuid);
  idx.push(patientUuid);
  while (idx.length > MAX_PATIENTS) {
    const oldest = idx.shift();
    if (oldest === undefined) {
      break;
    }
    try {
      window.sessionStorage.removeItem(conversationPayloadStorageKey(oldest));
    } catch {
      /* tolerate */
    }
  }
  writeIndex(idx);
}

function dropFromIndex(patientUuid: string): void {
  const idx = readIndex().filter((p) => p !== patientUuid);
  writeIndex(idx);
}

export function readCachedConversation(patientUuid: string): CachedConversationPayload | null {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(conversationPayloadStorageKey(patientUuid));
  } catch {
    return null;
  }
  if (raw === null || raw === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const stored = parsed as Partial<StoredPayload>;
  if (typeof stored.storedAt !== 'number' || !Array.isArray(stored.messages)) {
    return null;
  }
  if (Date.now() - stored.storedAt > TTL_MS) {
    try {
      window.sessionStorage.removeItem(conversationPayloadStorageKey(patientUuid));
    } catch {
      /* tolerate */
    }
    dropFromIndex(patientUuid);
    return null;
  }
  return {
    messages: stored.messages as ChatMessage[],
  };
}

export function writeCachedConversation(
  patientUuid: string,
  payload: CachedConversationPayload,
): void {
  const stored: StoredPayload = {
    messages: payload.messages,
    storedAt: Date.now(),
  };
  try {
    window.sessionStorage.setItem(
      conversationPayloadStorageKey(patientUuid),
      JSON.stringify(stored),
    );
  } catch {
    /* sessionStorage may be unavailable or quota exceeded; degrade
       silently — the rail still works, it just won't replay on the
       next remount. */
    return;
  }
  touchIndex(patientUuid);
}
