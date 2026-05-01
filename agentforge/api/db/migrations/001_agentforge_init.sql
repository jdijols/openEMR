-- Gate 3 (G3-00) — Agent API namespace inside shared Postgres (Langfuse uses public schema on same instance).
-- Idempotent: safe to re-run.

CREATE SCHEMA IF NOT EXISTS agentforge;

CREATE TABLE IF NOT EXISTS agentforge.schema_migrations (
    migration_name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agentforge.heartbeat (
    id SERIAL PRIMARY KEY,
    pinged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO agentforge.schema_migrations (migration_name)
VALUES ('001_agentforge_init')
ON CONFLICT DO NOTHING;

INSERT INTO agentforge.heartbeat DEFAULT VALUES;
