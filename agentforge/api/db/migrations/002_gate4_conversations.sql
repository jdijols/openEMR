-- Gate 4 (G4-07) — transcript thread + UC-B proposal ledger (proposal_id dedupe at API + module ledger).
CREATE TABLE IF NOT EXISTS agentforge.conversations (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT NOT NULL UNIQUE,
    patient_uuid TEXT NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agentforge.turns (
    id BIGSERIAL PRIMARY KEY,
    conversation_internal_id BIGINT NOT NULL REFERENCES agentforge.conversations (id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    correlation_id TEXT,
    body JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT turns_role_ck CHECK (
        role IN (
            'user',
            'assistant',
            'system'
        )
    )
);

CREATE TABLE IF NOT EXISTS agentforge.pending_proposals (
    proposal_id TEXT PRIMARY KEY,
    conversation_internal_id BIGINT NOT NULL REFERENCES agentforge.conversations (id) ON DELETE CASCADE,
    patient_uuid TEXT NOT NULL,
    encounter_id BIGINT,
    write_target TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_at TIMESTAMPTZ,
    CONSTRAINT pending_proposals_status_ck CHECK (
        status IN ('pending', 'confirmed', 'rejected')
    )
);

CREATE INDEX IF NOT EXISTS pending_proposals_conversation_idx ON agentforge.pending_proposals (conversation_internal_id);

INSERT INTO agentforge.schema_migrations (migration_name)
VALUES ('002_gate4_conversations')
ON CONFLICT (migration_name) DO NOTHING;
