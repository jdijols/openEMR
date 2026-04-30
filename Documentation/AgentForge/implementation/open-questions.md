---
title: AgentForge V1 — Open Questions & Plan Gaps
source: Cross-reference audit of clinical-copilot-task-list.md, PRD.md, ARCHITECTURE.md, and Week 1 - AgentForge.pdf
created: 2026-04-29
status: unresolved
---

# AgentForge V1 — Open Questions & Plan Gaps

This document records gaps, inconsistencies, and risks identified by auditing the task list against the PRD, ARCHITECTURE.md, and the authoritative Gauntlet PDF requirements. Items are ordered by severity — grader-visible failures first, then schedule blockers, then architectural gaps.

---

## Priority Summary

| # | Issue | Severity | Blocks |
|---|-------|----------|--------|
| 1 | AI Cost Analysis missing entirely from task list | Critical | Final submission |
| 2 | Loom/demo video length conflict: task list says ≤12 min, PDF says 3–5 min | Critical | Final submission |
| 3 | Gate 1 + Gate 2 targeting the same calendar day is not credible | High | Thu early submission |
| 4 | No Postgres client or migration framework setup task exists | High | Gate 4 |
| 5 | Vercel AI SDK + Hono streaming integration complexity not called out | High | Gate 2 smoke test |
| 6 | G0-05 contract drift test is over-engineered for Gate 0 | Medium | Gate 0 schedule |
| 7 | No dev spend tracking mechanism (prerequisite for issue #1) | Medium | Cost analysis artifact |
| 8 | Langfuse Postgres ownership (shared vs. separate instance) unresolved | Medium | Gate 6 deploy |

---

## Issue 1 — AI Cost Analysis Is Completely Absent

**Where it lives in the PDF:** Submission Requirements table, row "AI Cost Analysis."

**What the PDF requires:**
> Actual dev spend and projected production costs at 100 / 1K / 10K / 100K users. Also consider architectural changes needed at each level. This is not simply cost-per-token * n users.

**The gap:** This deliverable does not appear anywhere in the task list — not in Gate 7, not as a cut tier, not as a journal note. It has two non-retroactive prerequisites:

1. **Actual dev spend tracking** must begin at Gate 0, when API keys are first used. You cannot reconstruct LLM/STT spend after the fact without a running log.
2. **Architectural scaling analysis** — what changes at 100 vs. 10K users (caching strategy, model tier, connection pooling, rate limiting, multi-tenant isolation) — requires deliberate thought, not a formula.

**Resolution needed:**
- Add a Gate 0 task: set up a cost tracking mechanism (budget alerts on API keys, a log line in G0-08's observability interface that records token counts per turn).
- Add a Gate 7 task: produce `Documentation/AgentForge/ai-cost-analysis.md` covering actual spend, projected costs at 4 scales, and the architectural inflection points at each scale.

---

## Issue 2 — Demo Video Length Conflict

**Task list (G7-01):** `≤12 minutes`, citing PRD §13.2.

**PDF submission table:** "Demo Video (3–5 min)."

**The conflict:** The PRD is your internal document. The PDF is the Gauntlet grader's authoritative requirement. A 12-minute video submitted against a 3–5 minute expectation is at direct risk of grader penalization. The PRD's §13.2 is wrong relative to the source requirement.

**Resolution needed:**
- Decide which is authoritative and update G7-01 accordingly.
- If targeting 3–5 minutes, the Loom script in §13.2 needs significant compression — UC-A, UC-B full loop, UC-C, and a refusal/safety demo cannot all be shown thoroughly in 5 minutes. The script must prioritize ruthlessly.

---

## Issue 3 — Gate 1 + Gate 2 Targeting the Same Calendar Day Is Not Credible

**Schedule overlay:** Both Gate 1 and Gate 2 are targeted for Thu Apr 30.

**What Gate 1 requires (13 tasks, all test-first on security tasks):**
- SQL schema + `LaunchCode` mint/redeem with TTL and single-use enforcement
- `ActiveChartBinding::assert` with three Given/When/Then scenarios
- no co-pilot privilege bypass: admin/super follows normal OpenEMR superuser semantics, while all endpoints retain non-empty ACL specs and active-chart binding
- `AclMap` with empty-spec PHPStan/PHPUnit guard
- `AgentAuditLogger` with metadata-only assertion
- TS handshake redeem endpoint with constant-time HMAC
- `assertBoundPatient` with zero-HTTP-call assertion
- Error normalizer, CORS allowlist
- Manual smoke of the Caddy-less stack

**What Gate 2 then requires (13 tasks):**
- Module event hook, Twig templates, `panel.php`
- Two Context Service endpoints with PHPUnit coverage
- TS typed client with Zod validation
- Two AI tools with cross-patient binding tests
- Orchestrator with mock LLM
- CUI handshake hook, message renderer, API client
- G2-12: full end-to-end smoke test requiring every layer simultaneously functional

**The math:** 26 tasks with mandatory test-first discipline on the security half. Even at 30 minutes per task this is 13 hours of pure execution with no debugging time.

**Resolution needed:**
- Explicitly decide what the Thursday Early Submission actually ships: Gate 1 complete + Gate 2 partial (handshake live, no orchestrator), or Gate 1 complete only.
- Move G2-12 (end-to-end smoke) to a separate "Gate 2 close" entry and accept it may slip to Friday morning.
- The plan's `**Hard gate:** if G2-12 does not pass by Thu EOD, escalate immediately` is correct but the escalation path needs to be pre-decided, not discovered at 11 PM Thursday.

---

## Issue 4 — No Postgres Client or Migration Framework Task Exists

**Where it matters:** G4-07 ("conversations, turns Postgres tables + service") and G5-01 ("transcripts + transcript_segments Postgres tables") both create Postgres tables. G0-06 creates a docker-compose.override.yml skeleton but never wires a healthcheck, persistent volume, or data directory for Postgres.

**The gap:** Neither gate has a preceding task for:
- Choosing and installing a Postgres client library (`pg`, Drizzle, Prisma, or similar)
- Establishing a migrations baseline (how do tables get created on a fresh container?)
- Setting up connection pooling configuration
- Confirming the compose Postgres service is actually healthy before dependent tasks run

Without these, G4-07 is blocked on a decision that has not been made. If you pick Drizzle, the schema definition syntax is different than raw SQL. If you pick Prisma, it has its own migration workflow. If you use raw `pg` with SQL files, you need a migration runner.

**Resolution needed:**
- Add a task after G0-06: select Postgres client, install it, add a `db/migrations/` directory, and wire a `npm run db:migrate` script. This is a Gate 0 or Gate 1 task, not Gate 4.

---

## Issue 5 — Vercel AI SDK + Hono Streaming Integration Is Not Trivial

**Where it matters:** G2-08 (orchestrator) treats Hono + Vercel AI SDK as a single task.

**The technical risk:** The Vercel AI SDK's `streamText` emits a `DataStream` wire format designed for Next.js's `StreamingTextResponse`. Outside of Next.js, you cannot return `streamText(...)` from a Hono route handler directly. You need a custom adapter that:
- Pipes the SDK's `ReadableStream` to Hono's response stream
- Sets the correct `Content-Type: text/event-stream` and `x-vercel-ai-data-stream: v1` headers
- Handles backpressure correctly

This is a known sharp edge documented in the Vercel AI SDK's non-Next.js usage section. If this hits during Gate 2 without prior knowledge of the workaround, it can block the smoke test for hours.

**Resolution needed:**
- Either add a spike task to Gate 0 or early Gate 1: "Prove `streamText` + Hono streaming works with a trivial echo route before any agent logic lands."
- Alternatively, add a note to G2-08 explicitly referencing the adapter pattern needed.

---

## Issue 6 — G0-05 Contract Drift Test Is Over-Engineered for Gate 0

**What G0-05 requires:** A CI/pre-commit test that fails when a PHP class is added without a TS sibling (or vice versa), before any real endpoints exist.

**The problem:** At Gate 0, both the PHP and TS sides have identical endpoint sets by definition: zero. The drift test has nothing meaningful to compare. Building cross-runtime contract enforcement tooling against empty stubs means you are building the test harness around placeholder files. This will:
1. Consume Gate 0 time that the schedule does not have
2. Produce a test that cannot be validated until Gate 2 when the first real endpoint exists
3. Require rework when the actual endpoint shapes are defined in Gate 2

**Resolution needed:**
- Descope G0-05 in Gate 0 to: "Create `agentforge/api/src/openemr/types.ts` with commented endpoint stubs and a matching PHP `Http/` directory with empty classes. Add a `TODO: wire drift test here` comment."
- Move the actual drift enforcement test to Gate 2, when the first real endpoint (identity) can validate that the test catches a real divergence.

---

## Issue 7 — No Dev Spend Tracking (Prerequisite for Issue #1)

**What the PDF requires:** "Actual dev spend" — not estimated, not projected, actual.

**The gap:** Once LLM calls start in Gate 2, costs accumulate with no record unless something is capturing them. Langfuse can capture token counts, but Langfuse isn't fully wired until Gate 6. The observability no-op stub in G0-08 explicitly defers Langfuse instrumentation.

**Consequence:** By Gate 6 when Langfuse is live, you will have burned unknown spend across Gates 2–5 with no record. This cannot be reconstructed.

**Resolution needed:**
- In G0-08, even the no-op stub should log token counts to stdout with a structured format (e.g., `{event:"llm_call", tokens_in:N, tokens_out:N, model:"...", cost_usd:N}`).
- Set API key budget limits/alerts on Anthropic and Deepgram dashboards at Gate 0, and record the starting balance.
- Keep a running tally in `Documentation/AgentForge/dev-spend-log.md` updated after each gate closes.

---

## Issue 8 — Langfuse Postgres Ownership Unresolved

**The architecture diagram shows:** `PG[(Postgres — transcripts, Langfuse)]` — a single Postgres instance serving both the agent API and Langfuse self-hosted.

**The problem:** Langfuse self-hosted has its own migration runner and schema. It requires specific environment variables (`NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `DATABASE_URL`, `SHADOW_DATABASE_URL`, etc.). If it shares the agent API's Postgres instance, Langfuse's migrations must not collide with agent API tables. If they use separate Postgres instances, the compose override needs two services, two sets of env vars, and two healthchecks.

Neither decision is recorded or tasked. This will surface during G6-07 when you attempt to wire Langfuse and discover the compose config does not match.

**Resolution needed:**
- Decide now: shared Postgres or separate Postgres for Langfuse.
- Recommended: separate, because Langfuse's schema is large and opaque. Add a `langfuse-db` service to G0-06's compose skeleton so the decision is locked in before Gate 6.
- Record the decision and its rationale in `docker/agentforge/README.md`.

---

## Additional Watch Items (Not Blocking, But Worth Tracking)

**`SocialHistoryService` existence risk:** PRD §4.4 and task G3-01 reference `SocialHistoryService` as an existing OpenEMR service. This should be confirmed to exist at the expected namespace before G3-01 begins, not during it.

**`speaker_role` DB constraint scope:** G5-01 constrains `speaker_role` to `'physician'` only at the DB level. If UC-C ever needs to acknowledge that a patient spoke (even without capturing content), this constraint will need to be loosened. Confirm the PRD's intent is physician-audio-only transcription, not physician-only speech acknowledgment.

**Parallel deploy lane optimism:** The plan starts the deploy skeleton after Gate 2 exits (Thu EOD). A single engineer then runs Gate 3 + Gate 4 on Friday while also maintaining the deploy lane. In practice this means context-switching between PHP Context Service endpoints and Caddy/compose config. Budget for this explicitly or accept that the deploy lane does not close until Saturday morning.

---

## Resolution Tracking

Mark items below as resolved when a decision is made and the task list is updated.

| # | Resolved | Resolution summary |
|---|----------|--------------------|
| 1 | [ ] | |
| 2 | [ ] | |
| 3 | [ ] | |
| 4 | [ ] | |
| 5 | [ ] | |
| 6 | [ ] | |
| 7 | [ ] | |
| 8 | [ ] | |
