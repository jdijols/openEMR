# AgentForge (non-PHP)

- `api/` — Node 20 + Hono + Zod (`agentforge-api` in Compose)
- `cui/` — Vite + React + TypeScript (CUI bundle)
- `contracts/` — shared module HTTP path manifest (`module-http-paths.json`)

Compose extension: `docker/agentforge/`.

## Week 2 deliverables

Graders: this directory holds the non-PHP half of the Week 2 submission. The submission docs live at the repo root — start there:

- [`W2_ARCHITECTURE.md`](../W2_ARCHITECTURE.md) — hybrid retrieval (FTS5 + dense + Cohere Rerank), citation schema, FHIR persistence, observability, PHI redaction.
- [`PATIENT_DASHBOARD_MIGRATION.md`](../PATIENT_DASHBOARD_MIGRATION.md) — defense doc for the W2 surprise challenge (PHP dashboard ported to React, 11 cards, FHIR R4, embedded in the OpenEMR chart shell).
- [`EVALUATION.md`](../EVALUATION.md) — eval suite over 5 W2 categories across 88 cases. Pinned baseline: `w2-consolidated-2026-05-07`. Latest committed run is the newest file under [`api/eval/reports/`](api/eval/reports/).
- Setup: [`docker/agentforge/`](../docker/agentforge/) extends [`docker/development-easy/`](../docker/development-easy/); env vars in [`docker/agentforge/secrets.env.example`](../docker/agentforge/secrets.env.example).
