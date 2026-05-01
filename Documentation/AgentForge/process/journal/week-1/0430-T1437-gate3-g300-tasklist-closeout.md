---
date: 2026-04-30
topic: Gate 3 — G3-00 migrate proof, task-list refresh, G3-11 operator blocker
related_milestone: clinical-copilot-task-list.md (Gate 3), 0430-T1334-gate3-nav-sync-no-chart-closeout.md
---

# Gate 3 closeout — DB baseline + checklist

## G3-00 done proof (Agent Postgres / migrations)

Host migration against Compose Postgres (`127.0.0.1:15432` per `docker/agentforge/README.md` § Agent Postgres baseline):

```text
cd agentforge/api
POSTGRES_URL_MIGRATE='postgresql://agentforge:agentforge@127.0.0.1:15432/agentforge' npm run db:migrate
```

Output (2026-04-30):

```text
Applying migration 001_agentforge_init.sql
Migrations OK: 001_agentforge_init.sql
```

Exit code: **0**. Schema strategy: **`agentforge`** schema on shared Postgres instance; Langfuse may share the same DB with separate tables/schemas (documented in README).

## Automated verification snapshot (same session)

- `composer phpunit-isolated -- --filter 'ContextEndpointsStaticStructureTest|RailContainerStaticStructureTest'` → OK (3 tests).
- `cd agentforge/api && npm test -- --run` → 13 files, **43** tests passed (incl. verification, orchestrator cost metadata).
- `cd agentforge/cui && npm test -- --run` → 4 files, **21** tests passed.

**G3-13 sample structured log** (from Vitest orchestrator run, metadata only):

```json
{"phase":"response_completed","traceId":"trace-1","correlation_id":"corr-xyz","provider":"anthropic","input_tokens":10,"output_tokens":20,"cost_usd":0.00033}
```

## G3-10 / G3-12 UX + host behavior

See [0430-T1334-gate3-nav-sync-no-chart-closeout.md](./0430-T1334-gate3-nav-sync-no-chart-closeout.md) — citation chrome navigation, `chart_section` routing, empty-pid / chart-close clearing, unified no-chart copy.

## G3-11 blocker (MUST — task list over ad-hoc PRD interpretation)

**UC-A “Brief me” / “what changed since last visit”** requires **three** manual transcript captures (≥3 storyboard patients), each with at least one cited “what changed” claim — per `clinical-copilot-task-list.md` **G3-11**.

This journal does **not** substitute for those captures (no fabricated PHI). **Operator:** when you run the storyboard, append a follow-up journal entry or extend this file with:

1. Patient/storyboard id (or demo label),
2. Exact user prompt (e.g. “Brief me — what changed since last visit?”),
3. One bullet of model output showing a **Claim** + citation UUID/trace,
4. OpenEMR chart context (encounter date or “return visit” sanity check).

Until three rows exist, Gate 3 stays **not formally closed** on PRD §1.4 bullet 3 / task list exit criteria.

## G3-01 note (tier-6 backlog)

Full **four-scenario HTTP PHPUnit pack** per context endpoint (401 / 403 / 200+source_pack / audit) remains optional tier-6 scope; current automated slice: `ContextEndpointsStaticStructureTest` + existing Gate 2 endpoint tests. Task list row **G3-01** documents this split in the Done proof column.
