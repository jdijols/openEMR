/**
 * Gate 5 — transcript text persistence (PRD §5.8). `speaker_role` is V1-fixed to `physician`.
 */

import type { Pool, PoolClient } from 'pg';

export type TranscriptSpeakerRole = 'physician';

async function maybeClient(pool: Pool, existing?: PoolClient): Promise<{ client: PoolClient; release: boolean }> {
  if (existing !== undefined) {
    return { client: existing, release: false };
  }
  const c = await pool.connect();
  return { client: c, release: true };
}

export async function insertTranscriptRow(
  pool: Pool,
  args: Readonly<{
    conversationInternalId: number;
    physicianUserId: number;
    patientUuid: string;
    encounterId: number | null;
  }>,
  client?: PoolClient,
): Promise<number> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO agentforge.transcripts
        (conversation_internal_id, physician_user_id, patient_uuid, encounter_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        args.conversationInternalId,
        args.physicianUserId,
        args.patientUuid.toLowerCase(),
        args.encounterId,
      ],
    );
    const row = r.rows[0];
    if (row === undefined) {
      throw new Error('transcript_insert_failed');
    }
    return Number.parseInt(String(row.id), 10);
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function appendTranscriptSegment(
  pool: Pool,
  args: Readonly<{
    transcriptId: number;
    seq: number;
    speakerRole: string;
    text: string;
    isFinal: boolean;
  }>,
  client?: PoolClient,
): Promise<void> {
  if (args.speakerRole !== 'physician') {
    throw Object.assign(new Error('speaker_role_not_allowed'), { code: 'speaker_role_violation' });
  }

  const { client: db, release } = await maybeClient(pool, client);
  try {
    await db.query(
      `INSERT INTO agentforge.transcript_segments
        (transcript_id, seq, speaker_role, text, is_final)
       VALUES ($1, $2, $3, $4, $5)`,
      [args.transcriptId, args.seq, 'physician', args.text, args.isFinal],
    );
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function finalizeTranscript(
  pool: Pool,
  transcriptId: number,
  client?: PoolClient,
): Promise<void> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    await db.query(`UPDATE agentforge.transcripts SET ended_at = now() WHERE id = $1 AND ended_at IS NULL`, [
      transcriptId,
    ]);
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function nextTranscriptSegmentSeq(
  pool: Pool,
  transcriptId: number,
  client?: PoolClient,
): Promise<number> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{ m: string | null }>(
      `SELECT max(seq)::text AS m FROM agentforge.transcript_segments WHERE transcript_id = $1`,
      [transcriptId],
    );
    const raw = r.rows[0]?.m;
    if (raw === null || raw === undefined || raw === '') {
      return 1;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n + 1 : 1;
  } finally {
    if (release) {
      db.release();
    }
  }
}
