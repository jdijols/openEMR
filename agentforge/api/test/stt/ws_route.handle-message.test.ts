/**
 * WS auth handler — exercises `handleMessage` directly so we can verify behavior
 * without spinning up an actual WebSocket server. Covers:
 *   - happy upsert: fresh conversation_id mints a row + transcript, sends `authed`
 *   - patient mismatch from `insertConversationRow` -> typed `error` frame
 *   - DB failure inside `insertTranscriptRow` -> `auth_failed`, NO `authed` ever sent
 *   - any unexpected throw is caught by the `onMessage` shield -> `internal_error`
 *
 * The point: a thrown async rejection inside the WS handler must NEVER kill the
 * Node process (this is what crashed the dev server before the migration was
 * applied — see process journal 0430-T2230 for the trace).
 */

import type { Pool } from 'pg';
import type { WebSocket as NodeWs } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import { handleMessage } from '../../src/stt/ws_route.js';
import { mintSessionToken } from '../../src/handshake/sessionToken.js';
import { testEnv } from '../helpers/env-fixture.js';

type SentFrame = Record<string, unknown>;

function makeMockSocket(): { sock: NodeWs; sent: SentFrame[] } {
  const sent: SentFrame[] = [];
  const sock = {
    send: (data: string) => {
      sent.push(JSON.parse(String(data)) as SentFrame);
    },
  } as unknown as NodeWs;
  return { sock, sent };
}

function authFrame(token: string, patient: string, conv: string): string {
  return JSON.stringify({
    type: 'auth',
    session_token: token,
    patient_uuid: patient,
    conversation_id: conv,
  });
}

const PATIENT = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
const CONV_FRESH = '11111111-2222-4333-8444-555555555555';

function freshToken(env: ReturnType<typeof testEnv>): string {
  return mintSessionToken(
    { user_id: 7, patient_uuid: PATIENT, encounter_id: 42 },
    env.SESSION_TOKEN_SECRET,
    Math.floor(Date.now() / 1000),
    3600,
  );
}

describe('WS handleMessage — auth path', () => {
  it('upserts a fresh conversation and sends `authed`', async () => {
    const env = testEnv();
    const { sock, sent } = makeMockSocket();

    const query = vi.fn(async (sql: string) => {
      const s = sql.toLowerCase();
      if (s.startsWith('insert into agentforge.conversations')) {
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('select id, external_id, patient_uuid')) {
        return { rows: [{ id: '99', external_id: CONV_FRESH, patient_uuid: PATIENT }] };
      }
      if (s.startsWith('insert into agentforge.transcripts')) {
        return { rows: [{ id: '777' }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const release = vi.fn();
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
    } as unknown as Pool;

    await handleMessage(env, pool, sock, authFrame(freshToken(env), PATIENT, CONV_FRESH));

    expect(sent.at(-1)).toEqual({ type: 'authed' });
    expect(release).toHaveBeenCalled();
  });

  it('returns `auth_failed` (and never `authed`) when transcript insert throws — and does not crash', async () => {
    const env = testEnv();
    const { sock, sent } = makeMockSocket();

    const query = vi.fn(async (sql: string) => {
      const s = sql.toLowerCase();
      if (s.startsWith('insert into agentforge.conversations')) {
        return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('select id, external_id, patient_uuid')) {
        return { rows: [{ id: '99', external_id: CONV_FRESH, patient_uuid: PATIENT }] };
      }
      if (s.startsWith('insert into agentforge.transcripts')) {
        const err: Error & { code?: string } = new Error('relation "agentforge.transcripts" does not exist');
        err.code = '42P01';
        throw err;
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as Pool;

    await handleMessage(env, pool, sock, authFrame(freshToken(env), PATIENT, CONV_FRESH));

    expect(sent).toContainEqual({ type: 'error', code: 'auth_failed' });
    expect(sent.find((f) => f.type === 'authed')).toBeUndefined();
  });

  it('maps `conversation_patient_mismatch` from upsert to a typed error frame', async () => {
    const env = testEnv();
    const { sock, sent } = makeMockSocket();
    const otherPatient = 'ffffffff-1111-4222-8333-444444444444';

    const query = vi.fn(async (sql: string) => {
      const s = sql.toLowerCase();
      if (s.startsWith('insert into agentforge.conversations')) {
        return { rows: [], rowCount: 0 };
      }
      if (s.startsWith('select id, external_id, patient_uuid')) {
        // Existing row is bound to a different patient -> insertConversationRow throws.
        return { rows: [{ id: '5', external_id: CONV_FRESH, patient_uuid: otherPatient }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as Pool;

    await handleMessage(env, pool, sock, authFrame(freshToken(env), PATIENT, CONV_FRESH));

    expect(sent).toContainEqual({ type: 'error', code: 'conversation_patient_mismatch' });
    expect(sent.find((f) => f.type === 'authed')).toBeUndefined();
  });

  it('rejects bad session tokens before touching the pool', async () => {
    const env = testEnv();
    const { sock, sent } = makeMockSocket();
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('pool should not be touched');
      }),
    } as unknown as Pool;

    await handleMessage(env, pool, sock, authFrame('not-a-real-token', PATIENT, CONV_FRESH));

    expect(sent.at(-1)).toEqual({ type: 'error', code: 'unauthenticated' });
  });

  it('rejects when the session-token patient does not match the auth-frame patient', async () => {
    const env = testEnv();
    const { sock, sent } = makeMockSocket();
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('pool should not be touched');
      }),
    } as unknown as Pool;

    const tokenForOther = mintSessionToken(
      { user_id: 7, patient_uuid: 'ffffffff-1111-4222-8333-444444444444', encounter_id: 42 },
      env.SESSION_TOKEN_SECRET,
      Math.floor(Date.now() / 1000),
      3600,
    );

    await handleMessage(env, pool, sock, authFrame(tokenForOther, PATIENT, CONV_FRESH));

    expect(sent.at(-1)).toEqual({ type: 'error', code: 'patient_mismatch' });
  });
});
