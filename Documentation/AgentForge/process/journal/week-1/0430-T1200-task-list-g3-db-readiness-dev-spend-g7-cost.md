---
date: 2026-04-30
topic: Task list — Gate 3 DB readiness, dev spend logging, Gate 7 cost appendix
related_docs:
  - TASKS.md
  - Documentation/AgentForge/implementation/open-questions.md (audit that motivated DB + cost gaps)
  - PRD.md (§5.9 conversation store, §11 observability / tokens per turn)
---

# Task list adjustments — Postgres readiness, dev spend, cost analysis

## Why this change landed

Cross-review of `TASKS.md` against `open-questions.md` flagged two execution risks before Gate 4+: **no explicit Agent API Postgres migration baseline** (would block **G4-07** / **G5-01** cleanly) and **no tracked dev spend / token rollups** ahead of submission or sponsor cost questions. We intentionally **did not** change Loom length policy (internal PRD vs Gauntlet PDF) in this pass — out of scope for this edit.

## What changed in `TASKS.md`

| Item | Gate | Summary |
| ---- | ---- | -------- |
| **G3-00** | 3 | Lightweight **Agent Postgres readiness**: pick Node DB client + migration runner, initial migration + `db:migrate` smoke against compose `postgres`, document **Langfuse DB vs agent API DB** (shared vs separate / schema isolation). Marked **complete early in Gate 3**; unlocks conversation/transcript tables. |
| **G3-13** | 3 | **Dev spend + token accounting**: extend **G0-08** path so each LLM completion emits **metadata-only** structured records (tokens, model, est. USD, `correlation_id`); maintain rolling [`implementation/dev-spend-log.md`](../../implementation/dev-spend-log.md); failures in cost math must not break turns (`cost_usd: null`). |
| **G7-07** | 7 | Submission artifact **[`implementation/ai-cost-analysis.md`](../../implementation/ai-cost-analysis.md)**: actual spend from log + dashboards, **100 / 1K / 10K / 100K** projections with stated assumptions, **architectural inflection points** per tier. Depends on **G3-13** and **G7-03**. |
| **G4-07** | 4 | **Depends on** now includes **`G3-00`** (in addition to G0-06, G0-07) so conversation store work starts only after migration baseline exists. |

**Exit criteria**

- **Gate 3** now explicitly requires **G3-00** green before Gate 4 Postgres persistence work, and **G3-13** green so spend is measurable from real turns onward.
- **Gate 7** now explicitly requires **G7-07** for sponsor / grading cost narrative.

**Appendix**

- Cross-reference table updated: Gate 3 adds §5.9 / §7.1 (G3-00) and §11.2 (G3-13); Gate 7 adds §11.2 (G7-07). Duplicate Gate 7 row removed; gate ordering normalized.

## Key decisions (prompt → outcome)

- **User:** Add DB readiness **now** (entering Gate 3), not buried in Gate 4 — avoids a hidden blocker at **G4-07**.
- **User:** Start **dev spend logging** in Gate 3; **consolidated cost + scale analysis** ships as Gate 7 documentation, not mixed into every endpoint task row.
- **User:** Prioritize task list coherence over expanding PRD scope; Loom/PDF length treated as trivial / unchanged here.

## Follow-ups (not done in this doc pass)

- Implement **G3-00** / **G3-13** in code and create `dev-spend-log.md` (and later `ai-cost-analysis.md`) when those tasks execute.
- Optional: add a one-line **schedule overlay** note (Fri May 1) calling out G3-00 + G3-13 if the wall-calendar view needs alignment.
