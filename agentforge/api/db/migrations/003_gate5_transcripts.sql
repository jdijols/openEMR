-- Gate 5 (G5-01) — transcript persistence (PRD §5.8). Audio is never written here; only text segments.
CREATE TABLE IF NOT EXISTS agentforge.transcripts (
    id BIGSERIAL PRIMARY KEY,
    conversation_internal_id BIGINT NOT NULL REFERENCES agentforge.conversations (id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    physician_user_id BIGINT NOT NULL,
    patient_uuid TEXT NOT NULL,
    encounter_id BIGINT
);

CREATE INDEX IF NOT EXISTS transcripts_conversation_idx ON agentforge.transcripts (conversation_internal_id);

CREATE TABLE IF NOT EXISTS agentforge.transcript_segments (
    id BIGSERIAL PRIMARY KEY,
    transcript_id BIGINT NOT NULL REFERENCES agentforge.transcripts (id) ON DELETE CASCADE,
    seq INT NOT NULL,
    speaker_role TEXT NOT NULL,
    text TEXT NOT NULL,
    is_final BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT transcript_segments_speaker_ck CHECK (speaker_role = 'physician'),
    CONSTRAINT transcript_segments_transcript_seq_uniq UNIQUE (transcript_id, seq)
);

CREATE INDEX IF NOT EXISTS transcript_segments_transcript_idx ON agentforge.transcript_segments (transcript_id);

INSERT INTO agentforge.schema_migrations (migration_name)
VALUES ('003_gate5_transcripts')
ON CONFLICT (migration_name) DO NOTHING;
