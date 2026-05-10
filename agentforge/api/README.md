Agent API per [`PRD.md`](../../PRD.md) §5. Local dev: `npm install` → `npm run dev` (requires valid env; see `docker/agentforge/secrets.env.example`).

## Week 2 deliverables — eval suite

Graders: the W2 eval suite covers 5 categories across 88 cases. Full design and pinned baseline (`w2-consolidated-2026-05-07`) in [`EVALUATION.md`](../../EVALUATION.md) at the repo root; W2 architecture context in [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md).

- **Run the suite:** `npm run eval` from this directory (requires the env vars in [`docker/agentforge/secrets.env.example`](../../docker/agentforge/secrets.env.example)).
- **Latest committed report:** newest file by mtime under [`eval/reports/`](eval/reports/) — each run writes a new `eval-<UTC>_<sha>.json`.
- **Live status:** `GET /agentforge/api/health/eval-status` returns a PHI-safe summary (counts, pass-rate, baseline ref) without exposing the underlying transcripts. Useful for confirming the deployed API matches the committed baseline.
