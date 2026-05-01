/**
 * Gate 5 G5-01 — Postgres CHECK rejects speaker_role != physician.
 * Requires migrated DB on `POSTGRES_URL_MIGRATE` or `POSTGRES_URL` (e.g. 127.0.0.1:15432 from compose).
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';

const url = (process.env.POSTGRES_URL_MIGRATE ?? process.env.POSTGRES_URL ?? '').trim();
const skip = url === '' || (!url.includes('127.0.0.1') && !url.includes('localhost'));

describe.skipIf(skip)('transcript_segments speaker_role CHECK', () => {
  it('rejects patient role at the database', async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await client.query('BEGIN');
      const ext = randomUUID();
      const pu = randomUUID();
      const conv = await client.query<{ id: string }>(
        `INSERT INTO agentforge.conversations (external_id, patient_uuid)
         VALUES ($1, $2) RETURNING id`,
        [ext, pu],
      );
      const cid = conv.rows[0]?.id;
      expect(cid).toBeDefined();

      const tr = await client.query<{ id: string }>(
        `INSERT INTO agentforge.transcripts
          (conversation_internal_id, physician_user_id, patient_uuid, encounter_id)
         VALUES ($1, 1, $2, NULL) RETURNING id`,
        [cid, pu],
      );
      const tid = tr.rows[0]?.id;
      expect(tid).toBeDefined();

      await expect(
        client.query(
          `INSERT INTO agentforge.transcript_segments (transcript_id, seq, speaker_role, text, is_final)
           VALUES ($1, 1, 'patient', 'nope', true)`,
          [tid],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});
