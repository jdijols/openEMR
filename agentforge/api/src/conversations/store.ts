/**
 * Postgres conversation + proposal persistence (Gate 4 G4-07 / G4-08).
 */

import type { Pool, PoolClient } from 'pg';

export type ConversationRecord = Readonly<{
  internalId: number;
  externalId: string;
  patientUuid: string;
}>;

export type PendingProposalRow = Readonly<{
  proposalId: string;
  conversationInternalId: number;
  patientUuid: string;
  encounterId: number | null;
  writeTarget: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'confirmed' | 'rejected';
}>;

export type ConversationLookupRow = Readonly<{
  internalId: number;
  externalId: string;
  patientUuid: string;
  endedAtIso: string | null;
}>;

async function maybeClient(pool: Pool, existing?: PoolClient): Promise<{ client: PoolClient; release: boolean }> {
  if (existing !== undefined) {
    return { client: existing, release: false };
  }

  const c = await pool.connect();
  return { client: c, release: true };
}

export async function fetchConversationByExternalId(
  pool: Pool,
  externalId: string,
  client?: PoolClient,
): Promise<ConversationLookupRow | null> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{ id: string; external_id: string; patient_uuid: string; ended_at: Date | null }>(
      `SELECT id, external_id, patient_uuid, ended_at
       FROM agentforge.conversations WHERE external_id = $1 LIMIT 1`,
      [externalId],
    );
    const row = r.rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      internalId: Number.parseInt(String(row.id), 10),
      externalId: row.external_id,
      patientUuid: typeof row.patient_uuid === 'string' ? row.patient_uuid.toLowerCase() : '',
      endedAtIso: row.ended_at !== null ? row.ended_at.toISOString() : null,
    };
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function listPendingProposalsForConversation(
  pool: Pool,
  conversationInternalId: number,
  client?: PoolClient,
): Promise<readonly PendingProposalRow[]> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{
      proposal_id: string;
      conversation_internal_id: string;
      patient_uuid: string;
      encounter_id: string | null;
      write_target: string;
      payload: unknown;
      status: PendingProposalRow['status'];
    }>(
      `SELECT proposal_id, conversation_internal_id, patient_uuid, encounter_id, write_target, payload, status
       FROM agentforge.pending_proposals
       WHERE conversation_internal_id = $1
       ORDER BY created_at ASC`,
      [conversationInternalId],
    );
    return r.rows.map((row) => {
      const payload =
        row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload) ?
          (row.payload as Record<string, unknown>)
        : {};
      let encounterId: number | null = null;
      const encRaw = row.encounter_id;
      if (encRaw !== null && encRaw !== undefined && `${encRaw}`.trim() !== '') {
        const n = Number.parseInt(`${encRaw}`, 10);
        encounterId = Number.isFinite(n) && n > 0 ? n : null;
      }
      return {
        proposalId: row.proposal_id,
        conversationInternalId: Number.parseInt(String(row.conversation_internal_id), 10),
        patientUuid: typeof row.patient_uuid === 'string' ? row.patient_uuid.toLowerCase() : '',
        encounterId,
        writeTarget: row.write_target,
        payload,
        status: row.status,
      };
    });
  } finally {
    if (release) {
      db.release();
    }
  }
}

/** Assistant turns for UC-C recap — refusal mining (PRD §5.9.1 `refusal` role not yet persisted; body blocks hold refusals). */
export async function listAssistantTurnBodies(
  pool: Pool,
  conversationInternalId: number,
  client?: PoolClient,
): Promise<readonly Record<string, unknown>[]> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{ body: unknown }>(
      `SELECT body FROM agentforge.turns
       WHERE conversation_internal_id = $1 AND role = 'assistant'
       ORDER BY id ASC`,
      [conversationInternalId],
    );
    return r.rows.map((row) =>
      row.body !== null && typeof row.body === 'object' && !Array.isArray(row.body) ?
        (row.body as Record<string, unknown>)
        : {},
    );
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function insertConversationRow(
  pool: Pool,
  externalId: string,
  patientUuid: string,
  client?: PoolClient,
): Promise<ConversationRecord> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    await db.query(
      `INSERT INTO agentforge.conversations (external_id, patient_uuid)
       VALUES ($1, $2)
       ON CONFLICT (external_id) DO NOTHING`,
      [externalId, patientUuid.toLowerCase()],
    );
    const sel = await db.query<{ id: string; external_id: string; patient_uuid: string }>(
      `SELECT id, external_id, patient_uuid FROM agentforge.conversations WHERE external_id = $1 LIMIT 1`,
      [externalId],
    );
    const row = sel.rows[0];
    if (row === undefined) {
      throw new Error('conversation_row_missing_after_insert');
    }

    const patientDb = typeof row.patient_uuid === 'string' ? row.patient_uuid.toLowerCase() : '';
    if (patientDb !== patientUuid.toLowerCase()) {
      throw Object.assign(new Error('conversation_patient_mismatch'), { code: 'conversation_patient_mismatch' });
    }

    return {
      internalId: Number.parseInt(String(row.id), 10),
      externalId: row.external_id,
      patientUuid: patientDb,
    };
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function endConversationForPatient(
  pool: Pool,
  externalId: string,
  patientUuid: string,
  client?: PoolClient,
): Promise<void> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    await db.query(
      `UPDATE agentforge.conversations
       SET ended_at = now()
       WHERE external_id = $1 AND patient_uuid = $2 AND ended_at IS NULL`,
      [externalId, patientUuid.toLowerCase()],
    );
  } finally {
    if (release) {
      db.release();
    }
  }
}

/** Append a persisted turn slice (minimal JSON body). */
export async function appendTurn(
  pool: Pool,
  conversationInternalId: number,
  role: 'user' | 'assistant' | 'system',
  correlationId: string,
  body: Record<string, unknown>,
  client?: PoolClient,
): Promise<void> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    await db.query(
      `INSERT INTO agentforge.turns (conversation_internal_id, role, correlation_id, body)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [conversationInternalId, role, correlationId, JSON.stringify(body)],
    );
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function insertPendingProposal(
  pool: Pool,
  row: Omit<PendingProposalRow, 'status'> & { status?: PendingProposalRow['status'] },
  client?: PoolClient,
): Promise<void> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    await db.query(
      `INSERT INTO agentforge.pending_proposals
       (proposal_id, conversation_internal_id, patient_uuid, encounter_id, write_target, payload, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (proposal_id) DO NOTHING`,
      [
        row.proposalId,
        row.conversationInternalId,
        row.patientUuid.toLowerCase(),
        row.encounterId,
        row.writeTarget,
        JSON.stringify(row.payload),
        row.status ?? 'pending',
      ],
    );
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function fetchPendingProposal(
  pool: Pool,
  proposalId: string,
  client?: PoolClient,
): Promise<PendingProposalRow | null> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{
      proposal_id: string;
      conversation_internal_id: string;
      patient_uuid: string;
      encounter_id: string | null;
      write_target: string;
      payload: unknown;
      status: PendingProposalRow['status'];
    }>(
      `SELECT proposal_id, conversation_internal_id, patient_uuid, encounter_id, write_target, payload, status
       FROM agentforge.pending_proposals WHERE proposal_id = $1 LIMIT 1`,
      [proposalId],
    );

    const row = r.rows[0];
    if (row === undefined) {
      return null;
    }

    const payload = row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};

    const encRaw = row.encounter_id;

    let encounterId: number | null = null;
    if (encRaw !== null && encRaw !== undefined && `${encRaw}`.trim() !== '') {
      const n = Number.parseInt(`${encRaw}`, 10);
      encounterId = Number.isFinite(n) && n > 0 ? n : null;
    }

    return {
      proposalId: row.proposal_id,
      conversationInternalId: Number.parseInt(String(row.conversation_internal_id), 10),
      patientUuid: typeof row.patient_uuid === 'string' ? row.patient_uuid.toLowerCase() : '',
      encounterId,
      writeTarget: row.write_target,
      payload,
      status: row.status,
    };
  } finally {
    if (release) {
      db.release();
    }
  }
}

/**
 * Shallow-merge `payloadPatch` onto the existing `pending_proposals.payload`
 * JSON via Postgres `||` concatenation (last-write-wins per top-level key).
 * Only applies when the row is still `pending`; returns the merged row, or
 * `null` if the proposal does not exist or is already finalized.
 */
export async function updatePendingProposalPayload(
  pool: Pool,
  proposalId: string,
  payloadPatch: Record<string, unknown>,
  client?: PoolClient,
): Promise<PendingProposalRow | null> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{
      proposal_id: string;
      conversation_internal_id: string;
      patient_uuid: string;
      encounter_id: string | null;
      write_target: string;
      payload: unknown;
      status: PendingProposalRow['status'];
    }>(
      `UPDATE agentforge.pending_proposals
       SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb
       WHERE proposal_id = $1 AND status = 'pending'
       RETURNING proposal_id, conversation_internal_id, patient_uuid, encounter_id, write_target, payload, status`,
      [proposalId, JSON.stringify(payloadPatch)],
    );

    const row = r.rows[0];
    if (row === undefined) {
      return null;
    }

    const payload =
      row.payload !== null && typeof row.payload === 'object' && !Array.isArray(row.payload) ?
        (row.payload as Record<string, unknown>)
      : {};

    let encounterId: number | null = null;
    const encRaw = row.encounter_id;
    if (encRaw !== null && encRaw !== undefined && `${encRaw}`.trim() !== '') {
      const n = Number.parseInt(`${encRaw}`, 10);
      encounterId = Number.isFinite(n) && n > 0 ? n : null;
    }

    return {
      proposalId: row.proposal_id,
      conversationInternalId: Number.parseInt(String(row.conversation_internal_id), 10),
      patientUuid: typeof row.patient_uuid === 'string' ? row.patient_uuid.toLowerCase() : '',
      encounterId,
      writeTarget: row.write_target,
      payload,
      status: row.status,
    };
  } finally {
    if (release) {
      db.release();
    }
  }
}

export async function markProposalFinal(
  pool: Pool,
  proposalId: string,
  status: 'confirmed' | 'rejected',
  client?: PoolClient,
): Promise<boolean> {
  const { client: db, release } = await maybeClient(pool, client);
  try {
    const r = await db.query<{ proposal_id?: string }>(
      `UPDATE agentforge.pending_proposals
       SET status = $2, finalized_at = now()
       WHERE proposal_id = $1 AND status = 'pending'
       RETURNING proposal_id`,
      [proposalId, status],
    );
    const row = r.rows[0];

    return row !== undefined && row.proposal_id !== undefined && row.proposal_id !== '';
  } finally {
    if (release) {
      db.release();
    }
  }
}
