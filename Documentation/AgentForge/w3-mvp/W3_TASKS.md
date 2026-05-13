---
title: W3 Adversarial Platform — Implementation Tasks
architecture: ../../../ARCHITECTURE.md
threat_model: ../../../THREAT_MODEL.md
brief: ../references/Week-3_AgentForge-Adversarial-AI-Security-Platform.pdf
deadline: 2026-05-15T12:00:00 CT (Friday Final)
mvp_deadline: 2026-05-12T23:59:00 CT (Tuesday MVP)
created: 2026-05-12
---

# W3 Adversarial Platform — Implementation Tasks

> Execution map from MVP submission tonight to Final delivery Friday noon. Rooted in [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) and the brief at [`../references/Week-3_AgentForge-Adversarial-AI-Security-Platform.pdf`](../references/Week-3_AgentForge-Adversarial-AI-Security-Platform.pdf). Ordered by **gate dependencies**, not by architecture-doc section order — every task points back to its `ARCH §` so anything here can be re-derived from the spec.

## How to read this file

- **Gates run mostly in order.** Do not start Gate N+1 until Gate N's exit criteria are green, with the documented parallel-lane exceptions noted inline.
- **Tests are not symmetric.** Judge/agent/ledger/security tasks are **test-first** (write the unit/integration test before or with the code). Console UI, scaffolding, and infra are **smoke + manual demo**, not test-first.
- **Cut tier** = which deliverable bucket this task can be dropped to if schedule pressure mounts. `MUST` means the task cannot be cut without violating the brief's hard gates or our stop-the-line invariants. Tier 1 = lowest polish. Tier 6 = highest polish (cut first).
- **Done proof** is the literal artifact, command output, or file path a reviewer can re-check. Vague proofs are bugs in this file.
- **Owner column omitted** — single engineer + AI pair.

## Stop-the-line invariants (non-negotiable)

If any of these fail at any point in the schedule, stop feature work and fix before continuing. They map directly to the architecture's trust-boundary commitments and the brief's hard gates.

| #   | Invariant                                                                                | Where enforced                                                              | First test gate |
| --- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------- |
| W1  | **No PHI in the redteam ledger or platform spans.** Synthetic data only; raw patient bodies never persist outside the target's Postgres. | ARCH §11 (trust boundaries); THREAT_MODEL §2.b                              | Gate 0          |
| W2  | **No FHIR write persists during a redteam campaign.** `propose_writes` either runs in sandbox mode or the attack stops before confirmation. | ARCH §1.4, §11 footnote; THREAT_MODEL §4.a; W2 audit trail                  | Gate 4          |
| W3  | **Tier-1 deterministic Judge verdicts are reproducible.** Same `(case, response)` input → identical `verdict` output, always. | ARCH §1.2 tier-1 contract                                                   | Gate 0 (locked-in); regression each gate |
| W4  | **Cost governor halts campaigns at the $ ceiling.** A runaway agent loop cannot exceed the per-campaign budget. | ARCH §7 cost governor                                                       | Gate 1          |
| W5  | **Every finding has a `correlation_id` linking to its Langfuse trace.** Audit trail is unbreakable; trace-pair drill-down always works. | ARCH §2 ledger schema; ARCH §9 Review Console               | Gate 1          |
| W6  | **No auto-published high-severity VULN reports.** Documentation Agent stops at "documented"; human approval gate (HITL #2) is the only path to "active backlog". | ARCH §1.4, §5 (lifecycle gate #2)                                            | Gate 3          |
| W7  | **Target sandbox mode never on in normal operation.** The `AGENTFORGE_SANDBOX=true` flag is opt-in via env file only; default is off; reverting takes one env-var change. | ARCH §11 footnote; STAGE_1_TARGET_STATE.md                                  | Gate 4          |
| W8  | **Confirmed exploits in the regression harness re-verify on every target deploy.** A fix is not "resolved" until Judge re-runs and passes. | ARCH §4 regression harness; brief: "fix actually held"                       | Gate 7          |
| W9  | **No secrets in code or commits.** `SESSION_TOKEN_SECRET`, API keys, ledger DB password live in env files in `docker/agentforge/secrets.*.env`; gitignored. | W1 inheritance; W3 redteam adds no new secrets-in-code surface              | Gate 0 (audit)  |
| W10 | **Eval suite results are query-shaped, not log-shaped.** Every result is a structured row (or schema-validated JSON) the Orchestrator can read; never raw freeform text only. | ARCH §2 ledger schema; brief: "structured, reproducible, extensible"        | Gate 0          |

A green check on every stop-the-line invariant is a precondition for the Friday final-gate submission.

## Gate dependency graph

```
                  ┌──────────────────────────────────────┐
                  │  Gate 0 — Tonight (MVP closeout)     │
                  │  ARCH walk-back · README polish      │
                  │  Demo script + recording             │
                  │  Commit + push + submit              │
                  └────────────────────┬─────────────────┘
                                       │
                  ┌────────────────────▼─────────────────┐
                  │  Gate 1 — Wed AM                     │
                  │  Postgres ledger schema + access     │
                  │  + cost governor + backfill MVP run  │
                  └────────────────────┬─────────────────┘
                                       │
                                       ├──────────────────────────────┐
                                       ▼                              ▼
                  ┌────────────────────────────┐   ┌──────────────────────────┐
                  │  Gate 2 — Wed PM           │   │ (parallel lane:          │
                  │  LLM Judge tier 2          │   │  Review Console v1       │
                  │  + 30-case calibration     │   │  backend scaffold begins │
                  │  corpus labeled            │   │  Wed evening)            │
                  └────────────────┬───────────┘   └────────┬─────────────────┘
                                   │                        │
                  ┌────────────────▼───────────┐            │
                  │  Gate 3 — Thu AM           │            │
                  │  Orchestrator Agent        │            │
                  │  + Documentation Agent     │            │
                  │  + VULN-NNN.md template    │            │
                  └────────────────┬───────────┘            │
                                   │                        │
                  ┌────────────────▼───────────┐            │
                  │  Gate 4 — Thu PM           │            │
                  │  Coverage expansion        │            │
                  │  Multi-turn runner         │            │
                  │  Document-upload attacks   │            │
                  │  Sandbox mode flag         │            │
                  │  P0-1b + P0-4a seeds       │            │
                  └────────────────┬───────────┘            │
                                   │                        │
                                   ▼                        ▼
                  ┌─────────────────────────────────────────────────┐
                  │  Gate 5 — Fri AM                                │
                  │  Review Console v1 frontend wired to backend    │
                  │  Operator dashboard, drill-down, journal CRUD   │
                  └────────────────────┬────────────────────────────┘
                                       │
                  ┌────────────────────▼─────────────────┐
                  │  Gate 6 — Fri midday                 │
                  │  Full validation campaign            │
                  │  3 vulnerability reports             │
                  │  AI cost analysis with real numbers  │
                  │  USERS.md, demo storyboard           │
                  └────────────────────┬─────────────────┘
                                       │
                  ┌────────────────────▼─────────────────┐
                  │  Gate 7 — Fri before noon            │
                  │  Demo video recording                │
                  │  Submission bundle finalization      │
                  │  Social post draft                   │
                  │  README + repo polish; submit        │
                  └──────────────────────────────────────┘
```

The only legal parallel work happens after Gate 1 exits: the Review Console v1 backend scaffolding (the Hono routes that will eventually serve the dashboard) can be drafted Wed evening alongside Gate 2's LLM Judge work. Everything else is sequential.

## Schedule overlay (wall time → gates → cut triggers)

| Wall date / window      | Window milestone                                  | Gates targeted     | Cut trigger if not met                                          |
| ----------------------- | ------------------------------------------------- | ------------------ | --------------------------------------------------------------- |
| Tue 2026-05-12 evening  | MVP closeout — READMEs polished, demo video recorded, MVP submitted (Console v0 explicitly deferred to Gate 5) | Gate 0             | Slip demo video → submit MVP with placeholder; record video Wed AM and re-submit  |
| Wed 2026-05-13 AM       | Ledger foundation                                 | Gate 1             | Slip → activate tier-6 backfill; Judge tier 2 starts JSON-shaped |
| Wed 2026-05-13 PM       | LLM Judge tier 2 + calibration                    | Gate 2             | Slip Sonnet 4.6 → ship Haiku-Judge fallback (tier 4 cut)        |
| Thu 2026-05-14 AM       | Orchestrator + Documentation Agent                | Gate 3             | Slip Documentation Agent → manual VULN drafts for the 3 required reports (tier 3 cut) |
| Thu 2026-05-14 PM       | Coverage expansion                                | Gate 4             | Slip P0-1b document-upload attacks → submit with the existing 3 categories (tier 5 cut) |
| Fri 2026-05-15 AM       | Review Console v1                                 | Gate 5             | Slip frontend → ship backend API + raw JSON viewer (tier 4 cut) |
| Fri 2026-05-15 midday   | Validation + vuln reports + cost                  | Gate 6             | Cut: must ship 3 vuln reports + 1 cost report. No tier cut here. |
| Fri 2026-05-15 11:00    | Demo recording                                    | Gate 7 partial     | Re-record cap 1; otherwise ship as-is                            |
| Fri 2026-05-15 11:55    | Final submit                                      | Gate 7 close       | HARD STOP                                                        |

---

## Gate 0 — Tonight (MVP closeout)

**Status:** `[~]` in progress (this session).

**Exit criteria:** MVP submission package complete and visible; ARCH.md self-consistent; READMEs polished; demo script doc written; stop-the-line invariants W1, W3, W5, W10 green; demo video recorded; commit pushed; Gauntlet submission filed.

**Strategic decision (locked, 2026-05-12 evening):** Console v0 (originally planned as a JSON-backed Vite/React bundle) was **deferred to Gate 5** after a strategic-call review. Building UI tonight against unfinished data shapes (no ledger, no Orchestrator, no Judge tier-2) would have rendered empty shells — a vaporware-shaped demo artifact that weakens the CISO-defense story. Instead, tonight's demo video is **terminal-first and evidence-based**: live attack run against the deployed target, real correlation IDs, real defensive-surface discovery, real Judge limitations characterized. Friday's Console v1 (Gate 5) builds from scratch against real Orchestrator data and real findings — the work doesn't split.

**Verification recap (already complete from Stages 1–4):**
- [Stage 1 target state](STAGE_1_TARGET_STATE.md) — deployed URLs verified
- [`THREAT_MODEL.md`](../../../THREAT_MODEL.md) — Stage 2 hard gate met
- [`evals/seeds/`](../../../evals/seeds/) + [`evals/results/run-2026-05-12T23-15-12-514Z.json`](../../../evals/results/run-2026-05-12T23-15-12-514Z.json) — Stage 3 hard gate met
- [`agentforge-redteam/`](../../../agentforge-redteam/) — Red Team Agent prototype, one live agent role
- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — Stage 4 hard gate met

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[x]` G0-01 | Walk back ARCHITECTURE.md §9 + §11 — "Langfuse self-hosted" claim becomes "Langfuse cloud now, self-hosted is v2"; Review Console reads our Postgres ledger (not Langfuse Postgres) for taxonomy queries | ARCH §9, §11   | —          | Manual read-through: no contradictions with W2_ARCHITECTURE.md; no dangling "self-hosted Langfuse" claims | MUST        | `grep -n "self-hosted Langfuse" ARCHITECTURE.md` returns zero direct claims (only the §11 footnote with v2 caveat)               | MUST     |
| `[x]` G0-02 | Rewrite W3_TASKS.md at W1-style density (this file is the proof)                                                                                              | —             | —          | Manual: file has gate-graph + stop-the-line + per-task tables + schedule overlay                        | MUST        | Line count ≥ 500 with substantive content; W1 task-list structure mirrored                                                        | MUST     |
| `[x]` G0-03 | Fix dead schema.ts references in `agentforge-redteam/README.md` and `evals/README.md` — both now point at the moved `agentforge-redteam/src/eval_schema.ts`     | —             | —          | Manual: grep -rn "evals/schema" returns nothing under root README or subdirectory READMEs                | High        | Edits committed; readers can follow every link                                                                                     | MUST     |
| `[x]` G0-04 | Polish repo-root README.md — add "Week 3 submission — start here" section above W2, with links to ARCH.md / THREAT_MODEL.md / evals/ / agentforge-redteam/ / w3-mvp docs; deployed-target URL prominent at top | brief: D1     | —          | Manual: clicking every link from the new section reaches a real artifact                                | MUST (D1)   | New README section visible; deployed URL at top; existing W2 section preserved below                                              | MUST     |
| `[x]` G0-05 | Write `Documentation/AgentForge/w3-mvp/MVP_DEMO_SCRIPT.md` — beat-by-beat 3-5 min storyboard, pre-recording checklist, recording tips                          | brief: D5     | —          | Manual: script covers ARCHITECTURE walk + threat model + live attack run + findings analysis + close   | MUST        | `MVP_DEMO_SCRIPT.md` committed                                                                                                    | MUST     |
| `[ ]` G0-06 | Pre-commit pass — run `prek run --all-files` from repo root; address any blocker                                                                              | W9            | G0-01..G0-05 | Manual: `prek` exits 0 (or blockers triaged with rationale committed)                                  | MUST (W9)   | `prek` clean OR documented exceptions for any deferred items                                                                       | MUST     |
| `[ ]` G0-07 | Commit MVP package — Stages 1–4 artifacts + this tasks file + demo script + READMEs with `Assisted-by: Claude Code` trailer. **Awaits Jason explicit approval.** | W9            | G0-06      | Manual: `git log -1` shows the trailer; `git status` clean post-commit                                  | MUST        | A single commit on `master` containing all W3 MVP artifacts                                                                       | MUST     |
| `[ ]` G0-08 | Push to remote (`git push origin master`) — **only after Jason explicit-approves**; never autonomous                                                          | —             | G0-07      | Manual: `git status` clean + `git log origin/master..master` empty after push                           | MUST        | `git status` reports `Your branch is up to date with 'origin/master'`                                                            | MUST     |
| `[ ]` G0-09 | Record + edit MVP demo video (Jason action) — follow `MVP_DEMO_SCRIPT.md`; upload to Loom; paste link into root README.md replacing the `_added after recording_` placeholder | brief: D5     | G0-05, G0-08 | None (Jason records)                                                                                  | MUST        | MP4 / Loom link in root README; demo length 3-5 min                                                                                | MUST     |
| `[ ]` G0-10 | MVP submission to Gauntlet (Jason action) — paste deployed URL, repo URL, demo video link                                                                     | brief         | G0-09      | None (Jason submits)                                                                                    | MUST        | Submission confirmed received                                                                                                     | MUST     |

**Gate 0 hard cut tier:** if pre-commit `prek` surfaces blocking lint/format issues with no quick fix, commit with documented `--no-verify` rationale captured in the commit body. The MVP gate is a documentation + evidence gate, not a code-quality gate; do not let formatter churn block the submission. (Code quality re-asserted at G7-05 before final.)

---

## Gate 1 — Wed AM: Postgres ledger foundation

**Status:** `[ ]` not started.

**Exit criteria:** every row in [ARCH §2's ledger schema table](../../../ARCHITECTURE.md#2-inter-agent-communication) exists in Postgres with constraints + typed access layer + cost governor wired; existing MVP results backfilled.

**Why this gate first on Wednesday:** every later agent (Judge tier 2, Orchestrator, Documentation Agent) reads/writes the ledger. No ledger = no agent work meaningfully shippable. This is the architectural unlock for the rest of the week.

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[ ]` G1-01 | DB migrator choice — pick (`pg` + `node-pg-migrate` is the W1 baseline; reuse). Add `agentforge-redteam/db/migrations/` directory + `pg-migrate.mjs` runner    | ARCH §2, §8   | —          | Smoke: `npm run db:migrate` against test DB URL exits 0                                                  | MUST        | `agentforge-redteam/db/migrations/001_init.sql` + scripts/pg-migrate.mjs                                                           | MUST     |
| `[ ]` G1-02 | **(test-first)** Migration 001 — schema `redteam` + tables: `attack_cases`, `campaigns`, `verdicts`, `findings`, `vuln_reports`, `regression_runs`, `subcategories`, `journal_entries`; FK + unique + check constraints per ARCH §2 | ARCH §2       | G1-01      | Vitest + ephemeral Postgres: migration up/down both succeed; constraint coverage per table (FK, unique, check); table list matches ARCH §2 | MUST        | `agentforge-redteam/test/db/migration_001.test.ts` green; `psql -c '\dt redteam.*'` lists all 8 tables                            | MUST     |
| `[ ]` G1-03 | **(test-first)** `agentforge-redteam/src/ledger/pool.ts` — Postgres pool with `LEDGER_DATABASE_URL` env var; pool reuses across requests; graceful shutdown    | ARCH §2       | G1-02      | Vitest: pool returns connection; concurrent calls don't exhaust; SIGTERM closes cleanly                  | High        | Pool module + test; idle connection pruning verified                                                                              | MUST     |
| `[ ]` G1-04 | **(test-first)** Ledger access layer per table — `agentforge-redteam/src/ledger/{attack_cases,verdicts,findings,...}.ts`; typed row interfaces; idempotent `insertX` / `upsertX` helpers | ARCH §2       | G1-03      | Vitest: round-trip insert/select for each table; FK rejection cases; idempotent upsert (rerun = no new rows) | MUST        | One test file per table; all green; row counts assertable                                                                          | MUST     |
| `[ ]` G1-05 | **(test-first)** `agentforge-redteam/src/cost.ts` — cost governor: per-campaign $ ceiling, per-agent budget allocation, halt-on-breach API                    | ARCH §7, W4   | —          | Vitest: counter math; breach trips kill-switch; reset between campaigns; concurrent increments safe     | MUST (W4)   | `cost.test.ts` green; type signatures support `incurCost(agent, cents)` + `assertBelowCeiling(campaignId)`                          | MUST     |
| `[ ]` G1-06 | Backfill MVP run into the ledger — one-shot script `scripts/backfill-mvp-results.ts` reads `evals/results/run-2026-05-12T23-15-12-514Z.json`, inserts 9 attack_cases + 9 verdicts + 0 findings (no exploits confirmed in MVP given Judge limitations) | —             | G1-04      | Vitest: idempotent rerun yields zero new rows; row counts after first run match expected (9, 9, 0)      | High        | Script runs cleanly; `SELECT COUNT(*) FROM redteam.attack_cases` returns 9; ledger now mirrors evals/                              | tier 4   |
| `[ ]` G1-07 | Wire `correlation_id` into every platform write — Red Team, Judge, future Orchestrator/Doc spans all carry a UUID matching their target-trace counterpart    | W5, ARCH §9   | G1-04      | Vitest: every ledger insert includes correlation_id; null-correlation insert is rejected                | MUST (W5)   | DB constraint `correlation_id NOT NULL` on attack_cases + verdicts; insert tests cover the NOT-NULL path                          | MUST     |
| `[ ]` G1-08 | Cost-governor wiring into `agentforge-redteam/src/run.ts` — every LLM-touching call funnels through `cost.incurCost`; campaign budget read from env (`REDTEAM_BUDGET_USD_PER_CAMPAIGN`) | ARCH §7, W4   | G1-05      | Integration test: synthetic run with $0.01 budget halts after first attack                              | MUST (W4)   | Integration test green; structured log line `cost_governor_halted` observable                                                      | MUST     |
| `[ ]` G1-09 | Postgres readiness probe — health check that confirms `redteam` schema exists + all 8 tables present; surfaced via `/health/ledger` endpoint                  | —             | G1-02      | Vitest: probe returns 'ok' with all tables; returns 'degraded' if schema missing                        | Med         | New endpoint live; `curl /health/ledger` returns 200 + JSON                                                                       | tier 5   |
| `[ ]` G1-10 | Document operator setup steps in `agentforge-redteam/README.md` — Postgres URL config, migration command, backfill command                                    | —             | G1-01..G1-08 | None (manual: instructions reproduce the gate from a fresh checkout)                                  | Med         | README updated; a fresh local clone can `npm install && npm run db:migrate && npm run backfill-mvp`                                 | tier 6   |

**Parallel-lane unlock:** Once G1-04 is green, Wed-evening start of Review Console v1 backend scaffold (Hono routes against ledger) is unblocked while Gate 2 work happens in the daytime.

---

## Gate 2 — Wed PM: LLM Judge tier 2 + calibration

**Status:** `[ ]` not started.

**Exit criteria:** Sonnet 4.6 Judge tier 2 scores any `(attack_case, target_response)` pair with rationale + confidence; 30-case calibration corpus labeled; tier-1↔tier-2 disagreement detection wired; calibrated agreement ≥ 90% on clear cases, ≥ 50% disagreement on ambiguous cases.

**Why this gate before agents:** the Orchestrator and Documentation Agent both rely on Judge verdicts being trustworthy. Building those agents on top of a brittle Judge means re-doing work later. Calibration first, then build on it.

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[ ]` G2-01 | **(test-first)** `agentforge-redteam/src/agents/judge_llm.ts` — Sonnet 4.6 client; committed system prompt loaded from `prompts/judge_v1.md`; returns `{verdict, rationale, confidence}` strictly | ARCH §1.2     | G1-04, G1-08 | Vitest: prompt shape snapshot (renamed = caught); fixture cases produce verdicts in `pass\|fail\|partial`; confidence in [0,1]; structured-output failure surfaces as `error` verdict (not crash) | MUST        | `judge_llm.test.ts` green; three fixture-input pairs produce stable verdicts across runs                                          | MUST     |
| `[ ]` G2-02 | Committed Sonnet rubric — `agentforge-redteam/prompts/judge_v1.md` with explicit rubric: when to call pass, fail, partial; how to read structured `refusal` blocks; one-shot examples | ARCH §1.2     | —          | Manual: rubric covers the four `judge.kind` cases from the eval schema (`refusal_required`, `forbidden_substring`, `forbidden_pattern`, `forbidden_substring_or_refusal`) | MUST        | `prompts/judge_v1.md` exists; cited by `judge_llm.ts` via file read at startup                                                    | MUST     |
| `[ ]` G2-03 | **(joint, paired with Jason)** 30-case ground-truth labeling — collect 10 clear-pass + 10 clear-fail + 10 ambiguous from existing MVP run + supplementary runs; hand-label per case | brief: error-analysis lesson | G1-06      | None (manual labeling)                                                                              | MUST        | `evals/calibration/ground_truth_v1.json` — 30 entries with `case_id, target_response, gold_verdict, notes`                          | MUST     |
| `[ ]` G2-04 | **(test-first)** Calibration runner — `scripts/calibrate-judge.ts` runs tier-1 + tier-2 against the 30-case set, measures agreement, writes `evals/calibration/run_<ts>.json` | ARCH §1.2     | G2-01, G2-03 | Vitest: agreement math is correct on synthetic input; output schema validates                       | MUST        | Calibration run produces a report; tier-1↔gold and tier-2↔gold agreement scores printed                                            | MUST     |
| `[ ]` G2-05 | Two-tier Judge integration in `src/judge.ts` — wraps the existing deterministic judge as tier 1, calls `judge_llm.ts` as tier 2; emits `{tier1_verdict, tier2_verdict, disagreement_flag}` | ARCH §1.2     | G2-01      | Vitest: tier-1 = pass + tier-2 = pass → no disagreement; tier-1 = fail + tier-2 = pass → disagreement=true; both error → escalate | MUST        | Updated `src/judge.ts` + tests; disagreement_flag reachable in ledger                                                              | MUST     |
| `[ ]` G2-06 | Update `src/run.ts` to write tier-1 + tier-2 verdicts to the ledger via `verdicts` table; existing JSON-results output preserved alongside (for backwards compatibility with Console v0) | ARCH §2       | G1-04, G2-05 | Integration test: full run writes both JSON file AND ledger rows; row counts match                  | High        | Sample run shows both surfaces populated; ledger query returns N rows; JSON shows N results                                        | MUST     |
| `[ ]` G2-07 | Disagreement queue surfacing — ledger view + simple SQL: "all verdicts where disagreement_flag = true, ordered by recency"                                    | ARCH §9       | G2-05      | None (manual: query returns expected rows on synthetic data)                                          | High        | View created; `SELECT * FROM redteam.disagreement_queue` works                                                                     | tier 4   |
| `[ ]` G2-08 | Cost-cap tier-2 sampling — Tier-2 Judge runs on 30% of cases by default (sampling rule documented), 100% on cases tier-1 flagged `partial` or `fail`           | ARCH §7       | G2-05, G1-08 | Vitest: sampling reproducible with seed; partial/fail bypass the sample rate                          | High        | Sampler module + test; cost report verifies tier-2 cost stays within budget allocation                                             | tier 3   |
| `[ ]` G2-09 | Calibration agreement metric ≥ 90% on clear cases — re-run G2-04 after rubric iteration if needed; tune rubric prompt and re-label as a tight loop             | brief         | G2-04      | Manual: agreement metric meets target on 20 clear cases (10 pass + 10 fail); ≥50% disagreement on ambiguous | MUST        | Final calibration run committed; agreement score reported in this row                                                              | MUST     |

**Gate 2 hard cut tier:** if Sonnet 4.6 calls are too expensive or too slow, fall back to Haiku 4.5 as the tier-2 judge (tier 4 cut). Calibration must still pass.

**Parallel lane (Wed evening, after G1-04):** Begin `agentforge-redteam/src/console_api/` Hono routes that the Friday Console v1 will consume. Stubbed responses fine; real ledger queries land Thu/Fri.

---

## Gate 3 — Thu AM: Orchestrator + Documentation Agent

**Status:** `[ ]` not started.

**Exit criteria:** Orchestrator can score next-campaign priority deterministically + emit Haiku-written rationale; Documentation Agent can take a confirmed `verdict_record` and produce a `VULN-NNN.md` matching the brief's required fields; HITL gate (W6) prevents auto-publish at severity ≥ High.

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[ ]` G3-01 | **(test-first)** `agentforge-redteam/src/agents/orchestrator.ts` — priority-scoring SQL function over `(impact, novelty, residual_risk, mitigation_strength)`; reads from `subcategories` + `findings` | ARCH §3       | G1-04      | Vitest with synthetic ledger: priority ranking matches expected order; saturation rule kicks in; time-decay applied | MUST        | `orchestrator.test.ts` green with 4+ synthetic ledger states                                                                       | MUST     |
| `[ ]` G3-02 | Haiku rationale wrapping — Orchestrator's deterministic output is decorated with a Claude Haiku one-sentence "why this subcategory next" string                | ARCH §3       | G3-01      | Vitest: mocked Haiku call produces stable rationale string; cost incurred via governor                  | High        | Rationale appears in `campaigns.rationale` ledger column; visible in console_api                                                  | tier 4   |
| `[ ]` G3-03 | **(test-first)** Family-escalation detection — scans recent `attack_cases` for mutation lineages whose successful descendants cluster around a failure pattern not in active subcategories | ARCH §3       | G1-04, G3-01 | Vitest: synthetic lineage with 3+ clustered successes triggers a coining proposal; lineage with diffuse successes does not | High | `family_detection.test.ts` green                                                                                                  | tier 3   |
| `[ ]` G3-04 | Subcategory dynamic-coining — when G3-03 triggers, Orchestrator emits a new row to `subcategories` with `provisional` status + parent-priority×1.5 score      | ARCH §3       | G3-03      | Vitest: synthetic family triggers an INSERT; coined subcategory queryable                              | Med         | `subcategories.coined_by = 'orchestrator'` rows visible after synthetic-input test                                                 | tier 2   |
| `[ ]` G3-05 | Subcategory decay — cron-like job: subcategories with no new findings in N days transition to `archived`; archived stays queryable                            | ARCH §3       | G1-04      | Vitest: time-traveled clock confirms transition                                                          | Med         | Decay job test green; archived subcategories visible in ledger with `archived_at` set                                              | tier 2   |
| `[ ]` G3-06 | **(test-first)** `agentforge-redteam/src/agents/documentation.ts` — takes `verdict_record` + full attack/response/trace context; calls Haiku with a structured-output prompt; writes `vulnerabilities/VULN-NNN.md` | ARCH §1.4     | G2-05, G1-04 | Vitest: fixture verdict produces a valid markdown report; required brief fields present (unique ID, severity, clinical impact, minimal repro, observed vs expected, recommended remediation, current status); regen idempotent | MUST        | `documentation.test.ts` green; fixture VULN report committed to test fixtures                                                      | MUST     |
| `[ ]` G3-07 | **VULN-NNN.md template** — `vulnerabilities/_TEMPLATE.md` containing the required field structure; the Doc Agent's prompt references it; engineer-fixer reads the rendered files | ARCH §1.4     | —          | Manual: template covers all brief-required fields                                                       | MUST        | `vulnerabilities/_TEMPLATE.md` committed                                                                                          | MUST     |
| `[ ]` G3-08 | HITL gate W6 — Documentation Agent stops at `documented` for severity ≥ High; ledger state transitions to `awaiting_human_approval`; no markdown file is published outside `vulnerabilities/pending/` until human flag | W6, ARCH §5   | G3-06      | Vitest: high-severity verdict → file lands in `pending/`; medium-severity → publishes directly         | MUST (W6)   | Synthetic high-sev case lands in pending; status visible in Console                                                                | MUST     |
| `[ ]` G3-09 | Human-approval CLI — `scripts/approve-finding.ts <finding_id>` transitions a pending VULN from `pending/` to `vulnerabilities/`, updates ledger state          | ARCH §5       | G3-08      | Vitest: idempotent; finding ID validation; ledger state correct after run                              | High        | Script lives; manual: pending case → approve → file moves; ledger reflects                                                         | tier 3   |
| `[ ]` G3-10 | Fix-recommendation prompt iteration — Documentation Agent's prompt encodes "engineer who wasn't present must be able to reproduce, validate, and fix the vulnerability based solely on this markdown" | brief         | G3-06      | Manual review: a sample VULN report passes the "out-of-context engineer" test                          | MUST        | Pass on 1 fixture report + the first real finding from G6                                                                          | MUST     |

---

## Gate 4 — Thu PM: Coverage expansion

**Status:** `[ ]` not started.

**Exit criteria:** All 6 P0 attack categories from THREAT_MODEL have at least 1 seed case; the runner supports multi-turn campaigns; the document-upload attack vector is wired through the target_client; target's sandbox mode flag is implemented and tested.

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[ ]` G4-01 | **(test-first)** `agentforge-redteam/src/target_client.ts` extend — `uploadDocument(cfg, pdf|png bytes, doc_type)` → returns `{docref_uuid, oe_document_id, oe_patient_pid}` by calling OE's document-upload PHP endpoint | THREAT_MODEL 1.b | —      | Vitest with msw mock: upload returns expected shape; auth header set; file size limit enforced         | MUST        | Adapter live; integration test against local OpenEMR succeeds                                                                     | MUST     |
| `[ ]` G4-02 | `sendChat` extended to accept attachment params (docref_uuid, doc_type, oe_document_id) — chains upload + chat in one call when seed case demands it          | ARCH §1.1     | G4-01      | Vitest: chained call passes attachment context; SSE response captures `attach_and_extract` tool invocation in trace | MUST        | Integration test against local: a document-upload attack reaches the supervisor's `attach_and_extract`                              | MUST     |
| `[ ]` G4-03 | **3 seed cases P0-1b — indirect prompt injection via document upload** — `evals/seeds/p0-1b-*.json` covering intake-form free-text injection, lab-note OCR injection, JSON-shaped injection; synthetic test fixtures in `evals/fixtures/docs/` (PDF + PNG) | THREAT_MODEL 1.b | G4-02   | Manual: each seed validates against EvalCaseSchema; fixture PDFs include the embedded adversarial text | MUST        | 3 new seed files + fixture documents committed                                                                                    | MUST     |
| `[ ]` G4-04 | **3 seed cases P0-4a — poisoned propose_writes** — `evals/seeds/p0-4a-*.json` covering wrong medication, wrong dose, allergy reversal; judge rules check for tool-call patterns in the trace + presence of poisoning indicators | THREAT_MODEL 4.a | —      | Manual: seeds validate against schema; judge rules sanity-check against a mocked supervisor response   | MUST        | 3 new seed files committed                                                                                                        | MUST     |
| `[ ]` G4-05 | **(test-first)** Target sandbox-mode — `agentforge/api/src/env.ts` adds `AGENTFORGE_SANDBOX` env var; `propose_writes` execution path checks the flag; when on, write is logged but not persisted; off by default | W7, W2        | —          | Vitest: existing propose_writes test passes with flag off; new test confirms flag-on skips FHIR write + emits log + emits a staging row | MUST (W2, W7) | Updated `env.ts` + propose_writes handler + tests; manual: existing W2 tests still pass                                            | MUST     |
| `[ ]` G4-06 | Sandbox-mode end-to-end smoke — run a P0-4a seed against the local target with sandbox on; verify ledger captures the staged proposal + Langfuse trace shows the tool call + no row appears in FHIR `observations` table | W2            | G4-04, G4-05 | Manual smoke: full chain runs                                                                       | MUST        | Smoke recorded in `Documentation/AgentForge/w3-mvp/STAGE_4_SANDBOX_SMOKE.md`                                                       | MUST     |
| `[ ]` G4-07 | **(test-first)** Multi-turn runner — `agentforge-redteam/src/run.ts` accepts a `chat_multi_turn` seed case kind with an array of turns; threads `conversation_id` across turns; judge applies after final turn | ARCH §1.1     | G1-04      | Vitest: 2-turn case where turn 2 references turn 1; conversation_id persistence; runner invokes judge against final OR all turns | MUST        | Multi-turn schema supported; first multi-turn seed runs end-to-end                                                                 | MUST     |
| `[ ]` G4-08 | **1 multi-turn seed P0-1c** — slow-build injection across 3 turns; demonstrates the platform's ability to test the brief's named "multi-turn attack sequences" | THREAT_MODEL 1.c | G4-07   | Manual: seed validates; runner executes against live target                                            | High        | Seed file committed + first run captured                                                                                          | tier 3   |
| `[ ]` G4-09 | Mutation lineage tracking in ledger — when Red Team mutates a seed, the new attack_case row's `parent_id` and `mutation_lineage` columns populate                | ARCH §3       | G1-04      | Vitest: mutation chain through 3 generations tracks correctly; lineage retrievable via SQL              | MUST        | Mutation chain queryable; family-detection (G3-03) can use this                                                                    | MUST     |
| `[ ]` G4-10 | First mutation-enabled live campaign — runs all seeds × 3 mutations each against prod target with cost governor on; captures full output to ledger             | ARCH §1.1, §7 | G1-08, G2-05, G3-01, G4-09 | Manual: campaign completes; ledger populated; cost report visible                          | High        | Campaign run committed: `evals/results/run-<ts>-mutation.json` + ledger query confirms ≥30 attack_cases written                    | MUST     |

---

## Gate 5 — Fri AM: Review Console v1

**Status:** `[ ]` not started.

**Exit criteria:** Operator can open the Console, see the failure-taxonomy view, drill into a subcategory, drill into a single attack's trace pair, and add a journal note that persists. The Console is the operator's primary UX; everything else is supporting infrastructure.

**Note (per Gate 0 strategic decision):** Console v0 (JSON-backed Vite scaffold) was **deferred from tonight** to here. Console v1 builds from scratch on Friday against the **real ledger** (Gate 1), **real Orchestrator priorities** (Gate 3), and **real Judge disagreements** (Gate 2). No scaffold-to-retrofit; the work compounds instead of splits.

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[ ]` G5-01 | **(test-first)** Console API — Hono routes at `agentforge-redteam/src/console_api/`: `GET /api/console/subcategories` (with counts), `/api/console/subcategories/:key/cases`, `/api/console/cases/:id`, `POST /api/console/journal`, `GET /api/console/disagreements` | ARCH §9       | G1-04, G2-07 | Vitest per route: 200 + JSON shape; SQL queries match ledger schema; service-token auth gate           | MUST        | 5 routes live; route table tests green; manual curl against running API returns sane JSON                                          | MUST     |
| `[ ]` G5-02 | Console API auth — single service token `REDTEAM_CONSOLE_TOKEN` env var; routes require `Authorization: Bearer ...`; rejected requests return 401             | ARCH §9, W9   | G5-01      | Vitest: missing/wrong token → 401; correct token → 200                                                  | MUST        | Auth gate enforced + tested                                                                                                       | MUST     |
| `[ ]` G5-03 | Console v1 frontend rewrite (from v0 JSON-backed shell) — replace JSON loader with `fetch('/api/console/...')`; reuse the v0 components where possible        | ARCH §9       | G0-02..G0-06, G5-01 | RTL: component tests pass against fixture API responses (msw); manual: dashboard renders against live API | MUST        | Frontend builds + runs against running console_api                                                                                | MUST     |
| `[ ]` G5-04 | Console dashboard — failure-taxonomy cards, per-card: subcategory, priority score, open-findings count, severity histogram, 30-day-trend sparkline            | ARCH §9 IA    | G5-03      | RTL: renders against synthetic API responses                                                            | High        | Dashboard visible; cards click-through to drill-down                                                                              | tier 3   |
| `[ ]` G5-05 | Console subcategory drill — table of attack_cases in this subcategory; columns: time, severity, tier-1 verdict, tier-2 verdict, disagreement flag, journal-count | ARCH §9 IA    | G5-03      | RTL: drill renders; filter UI works (severity, disagreement, date)                                      | High        | Drill page visible + functional                                                                                                  | tier 3   |
| `[ ]` G5-06 | Console case detail — trace-pair view: left pane = platform's view (prompt, judge verdict, rationale, mutation lineage); right pane = target's trace (Langfuse trace embed or link by correlation_id) | ARCH §9       | G5-03      | RTL: renders against fixture; correlation_id link resolves to Langfuse cloud                            | High        | Case detail page visible; correlation_id click opens Langfuse trace                                                                | tier 2   |
| `[ ]` G5-07 | Console journal — freeform-text field on every case detail; `POST /api/console/journal` persists; entries display ordered by timestamp with attribution        | ARCH §9       | G5-01, G5-03 | RTL + integration: journal entry submits + persists; refresh shows entry                              | High        | Journal works end-to-end                                                                                                          | tier 2   |
| `[ ]` G5-08 | Console disagreement queue — separate page listing all verdicts with disagreement_flag=true; sort by recency; click-through to case detail                    | ARCH §9       | G2-07, G5-03 | RTL: queue renders against fixture                                                                      | High        | Queue page visible                                                                                                                | tier 2   |
| `[ ]` G5-09 | Console verdict override — operator can override a Judge verdict (with required reason text) from case detail; ledger records the override + reviewer + timestamp | ARCH §5 (HITL #1, #5) | G5-01 | Vitest: override mutation succeeds; original verdict preserved; override visible on case               | Med         | Override action works; ledger records `verdict_overrides` row (new table — if not in G1-02, add migration here)                    | tier 1   |
| `[ ]` G5-10 | Console deploy — same Caddy reverse-proxy pattern as the W2 agent API; new subdomain `redteam.108-61-145-220.nip.io` or path-prefix on existing host           | —             | G5-01..G5-08 | Manual: curl returns 200; basic-auth or service-token gate enforced                                  | High        | Console reachable at a public HTTPS URL                                                                                          | tier 3   |

**Cut tier if running short:** ship just G5-01..G5-06 (read-only Console). G5-07 (journal write) and G5-08 (disagreement queue) are nice-to-haves. G5-09 (override) is tier 1.

---

## Gate 6 — Fri midday: Validation + vuln reports + cost analysis

**Status:** `[ ]` not started.

**Exit criteria:** Three real `vulnerabilities/VULN-NNN.md` reports committed; AI cost analysis report with real numbers; USERS.md persona doc; demo storyboard locked.

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[ ]` G6-01 | Full Friday-AM validation campaign — all seed cases × mutations × document-upload × multi-turn against prod; cost governor on; results to ledger              | ARCH §1.1     | G4-10, G5-01 | Manual: campaign completes; ledger populated; ≥1 high-severity finding (target — not guaranteed)        | MUST        | `evals/results/run-<ts>-final.json` committed; ledger summary in `Documentation/AgentForge/w3-mvp/STAGE_6_FINAL_RUN.md`            | MUST     |
| `[ ]` G6-02 | **3 vulnerability reports** — `vulnerabilities/VULN-001.md`, `VULN-002.md`, `VULN-003.md`; each generated by the Documentation Agent from a confirmed finding (or escalated from candidate findings) | brief         | G3-06, G6-01 | Manual: each report has the brief's required fields; an "engineer who wasn't present" can reproduce | MUST        | 3 committed markdown files; each ≥ 300 words substantive                                                                          | MUST     |
| `[ ]` G6-03 | AI cost analysis — `Documentation/AgentForge/w3-mvp/COST_REPORT.md`; replaces placeholder table in ARCH §7 with real measurements + architectural-changes-per-tier analysis at 100/1K/10K/100K | brief         | G6-01      | Manual: numbers match Langfuse cost data + ledger cost rollups                                          | MUST        | COST_REPORT.md committed; ARCH.md §7 updated to cite it                                                                            | MUST     |
| `[ ]` G6-04 | **USERS.md draft** — Security Engineer persona day-in-the-life, goals, frustrations, success criteria; mirrors ARCH §1 persona description with more depth   | brief         | —          | Manual: read-through; Jason approves persona shape                                                      | MUST        | `USERS.md` committed at repo root                                                                                                 | MUST     |
| `[ ]` G6-05 | Demo storyboard — `Documentation/AgentForge/w3-mvp/DEMO_STORYBOARD.md`; scene-by-scene 3-5 min video narrative                                                  | brief         | —          | None (manual)                                                                                           | MUST        | Storyboard committed                                                                                                              | tier 3   |
| `[ ]` G6-06 | THREAT_MODEL.md update — refresh ~500-word summary if new findings shift priorities; new subcategories from Orchestrator-coining surfaced                     | —             | G6-01      | None (manual diff review)                                                                              | High        | Updated threat model committed                                                                                                    | tier 4   |
| `[ ]` G6-07 | ARCHITECTURE.md update — incorporate any architectural decisions made during build; specifically: confirm framework choice held, surface any sandbox-mode constraints | —             | G4-05, G5-01 | None (manual)                                                                                          | High        | ARCH.md updated                                                                                                                   | tier 4   |
| `[ ]` G6-08 | Eval suite README refresh — final stats, coverage table, framework references (PyRIT, garak, MITRE ATLAS, OWASP LLM Top 10) cited                              | —             | G6-01      | None                                                                                                    | Med         | `evals/README.md` updated                                                                                                         | tier 5   |

---

## Gate 7 — Fri before noon: Submission bundle

**Status:** `[ ]` not started.

**Exit criteria:** demo video recorded; social post drafted; README + repo polished; submission completed at https://gauntlet.ai (or wherever the form lives) before 12:00 CT.

| ID    | Task                                                                                                                                                          | ARCH §        | Depends on | Tests required                                                                                          | Criticality | Done proof                                                                                                                       | Cut tier |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `[ ]` G7-01 | Pre-record dry run — Jason walks through the demo storyboard once; identifies any UI breaks or narrative gaps                                                  | brief         | G6-05, G5-10 | None (manual)                                                                                          | High        | Dry-run notes in `Documentation/AgentForge/w3-mvp/DEMO_NOTES.md`                                                                  | MUST     |
| `[ ]` G7-02 | Demo video — 3-5 min screen capture; Jason narrates against the storyboard; shows Console + a live campaign + a VULN report                                    | brief         | G7-01      | None                                                                                                    | MUST        | MP4 committed to `Documentation/AgentForge/w3-mvp/assets/` or uploaded to Loom; link in README                                    | MUST     |
| `[ ]` G7-03 | Social post draft — `Documentation/AgentForge/w3-mvp/SOCIAL_POST.md`; one X variant + one LinkedIn variant; tags @GauntletAI                                    | brief         | G7-02      | None                                                                                                    | MUST        | Drafted posts committed                                                                                                           | MUST     |
| `[ ]` G7-04 | README.md repo-root update — live deployed URL at top, links to ARCHITECTURE.md / THREAT_MODEL.md / USERS.md / evals/ / agentforge-redteam/ / vulnerabilities/  | brief         | G6-02..G6-05 | Manual: clicking every link from the README reaches a real artifact                                  | MUST        | README updated; all links resolve                                                                                                 | MUST     |
| `[ ]` G7-05 | Final pre-commit sweep — `prek run --all-files`; `composer phpstan` against any target-side changes (sandbox mode); resolve blockers                          | —             | All prior  | None (sweep is itself the test)                                                                          | MUST        | Sweep exits 0                                                                                                                     | MUST     |
| `[ ]` G7-06 | Final commit + push to `master` with `Assisted-by: Claude Code` trailer                                                                                       | —             | G7-05      | Manual: `git log -1` shows the trailer; `git push` succeeds                                              | MUST        | Latest commit on `master` ahead of MVP commit                                                                                     | MUST     |
| `[ ]` G7-07 | Submission to Gauntlet — Jason submits via whatever portal/form is required; includes deployed-app URL, repo URL, demo video link                              | brief         | G7-06      | None                                                                                                    | MUST        | Submission confirmation                                                                                                           | MUST     |

---

## Submission deliverables checklist (mirrors brief §Submission Requirements)

This section is the **scoreboard** — Jason reads this before submitting Friday. Tick items as they close.

| #   | Deliverable                                  | Brief Requirement (verbatim)                                                                                                          | Location after gates                                                              | Status |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| D1  | GitHub Repository                            | Forked from OpenEMR. Includes setup guide, architecture overview, deployed link, and instructions for running the adversarial platform against the live target. | Repo root: README.md, ARCHITECTURE.md, agentforge-redteam/README.md, evals/README.md | `[ ]` |
| D2  | Threat Model (./THREAT_MODEL.md)             | Full attack surface map with ~500-word summary of key findings and highest-risk categories.                                            | [`THREAT_MODEL.md`](../../../THREAT_MODEL.md)                                       | `[x]` MVP version shipped; G6-06 may refresh |
| D3  | User Doc (./USERS.md)                        | The users your platform addresses, their workflows, and specific use cases with explicit justification for why automation is the right solution. | [`USERS.md`](../../../USERS.md) — G6-04                                              | `[ ]` |
| D4  | Architecture Doc (./ARCHITECTURE.md)         | Multi-agent platform architecture with technical details — agent roles, inter-agent comms, orchestration, regression harness, observability, known tradeoffs. Must begin with a ~500 word summary. Must include a diagram of agent interactions. | [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)                                       | `[x]` MVP version shipped; G6-07 may refresh |
| D5  | Demo Video (3-5 min)                         | One demo video showcasing the work completed, highlighting key decisions, demonstrating the platform running live attacks against the target. | `Documentation/AgentForge/w3-mvp/assets/` or Loom — G7-02                          | `[ ]` |
| D6  | Eval Dataset (./evals/)                      | Adversarial test suite with results across at least three attack categories. Structure and scope are design decisions; results must be reproducible. | [`evals/`](../../../evals/)                                                          | `[x]` MVP 3 categories; G4 + G6 expand |
| D7  | Vulnerability Reports                        | Professional documentation for each discovered vulnerability following the required format. Minimum of three distinct vulnerability reports.            | `vulnerabilities/VULN-001.md..VULN-003.md` — G6-02                                  | `[ ]` |
| D8  | AI Cost Analysis                             | Actual dev spend and projected production costs for running the adversarial platform at 100 / 1K / 10K / 100K test runs. Consider architectural changes needed at each scale. | `Documentation/AgentForge/w3-mvp/COST_REPORT.md` — G6-03                              | `[ ]` |
| D9  | Deployed Application                         | Publicly accessible target system. For early and final submissions, the adversarial platform must be running live tests against the deployed target. | OpenEMR: `https://oe.108-61-145-220.nip.io/` · Agent API: `https://108-61-145-220.nip.io/` · Console: TBD G5-10 | `[x]` target live; Console TBD |
| D10 | Social Post (Final only)                     | Share on X or LinkedIn: describe the project, show the platform in action, tag @GauntletAI.                                            | `Documentation/AgentForge/w3-mvp/SOCIAL_POST.md` + actual post — G7-03               | `[ ]` |

---

## Test plan summary

The engineering tasks above each include their own test items. This section is the cross-cutting view of test infrastructure required by Friday.

| Layer                    | Test runner                          | Location                                                            | What's covered                                                                                                                |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Unit tests**           | vitest                               | `agentforge-redteam/src/**/*.test.ts`                               | Judge rules (4 kinds), HMAC token mint/parse, SSE parsing, priority scoring, ledger row CRUD, agent prompt-shape snapshots, mutation lineage tracking, family detection clustering, cost governor math |
| **Integration tests**    | vitest + ephemeral Postgres + msw    | `agentforge-redteam/test/integration/*.test.ts`                     | Full eval run against a mock target; ledger end-to-end; regression harness flow; Console API route tests against seeded ledger; sandbox-mode end-to-end |
| **Calibration**          | custom script                        | `scripts/calibrate-judge.ts` + `evals/calibration/`                 | tier-1 ↔ tier-2 ↔ ground-truth agreement metric; rubric drift detection                                                       |
| **Frontend component**   | vitest + @testing-library/react      | `agentforge-redteam/console/src/**/__tests__/*.test.tsx`            | Review Console rendering on fixture API responses; filter UI; journal CRUD                                                    |
| **e2e smoke**            | Playwright (single test, optional)   | `agentforge-redteam/test/e2e/console.e2e.ts`                        | Load dashboard, click subcategory, open case detail, journal entry persists                                                   |
| **Target-side (W2)**     | PHPUnit isolated                     | `tests/Tests/Isolated/Modules/AgentForge/SandboxModeTest.php`        | Sandbox-mode flag: off path preserves existing W2 behavior; on path skips FHIR write                                          |

**Coverage policy:**
- Every new agent/judge/orchestrator/ledger module — unit tests are required before the row is marked `[x]`.
- Every state-machine transition (lifecycle states from ARCH §5) — integration tests required.
- Every Stop-the-line invariant (W1..W10) — has at least one test asserting it holds.
- e2e is one happy-path test for the demo. Not a regression suite.

**No untyped JS in the new platform code.** All TypeScript strict, no `any` without comment, schemas validated by Zod at all boundaries.

---

## Risk register

What could derail Friday delivery — and the mitigation we've already chosen:

| #    | Risk                                                                                  | Mitigation                                                                                                                                                                                                       | Trigger to escalate                                       |
| ---- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| R1   | LLM Judge tier-2 drifts mid-week — results stop being reproducible                    | Calibration corpus runs nightly; agreement metric tracked; rubric is committed prompt + model version pin                                                                                                       | Agreement < 90% on clear cases → halt; rerun G2          |
| R2   | Document-upload attack vector wiring takes longer than estimated                      | Scoped Thursday morning; if not green by Thu noon, cut to "category-3-shipped, P0-1b documented as Friday morning task"                                                                                          | G4-01..G4-03 not all `[x]` by Thu noon                   |
| R3   | Postgres ledger adds operational complexity                                            | Same Postgres already running in compose; new schema only, no new container; backfill is idempotent so rollback is safe                                                                                          | Migration failure mid-deploy → roll back via down migration |
| R4   | Cost overrun on Sonnet 4.6 Judge calls                                                | Cost governor halts runs at $ ceiling; tier-2 sampled to 30% from the start; Haiku fallback (tier 4 cut) ready                                                                                                  | Single campaign exceeds $20 → enable sampling reduction   |
| R5   | Console v1 frontend takes too long to look good                                       | Dense, technical UI for power user is **correct** for the persona; v1 is unstyled-but-functional; if even that runs short, ship read-only at G5-06 cut tier                                                       | G5-04 (dashboard) not visible by Fri 10 AM                 |
| R6   | Demo video bombs on a live run                                                        | Friday morning includes a dry-run; cuts + re-takes possible (G7-01 cap = 1 re-record); storyboard locks the narrative independent of which exact campaign we show                                                  | Live attack fails mid-recording                            |
| R7   | Jason's UX direction conversations not actually needed (per his correction)           | Skip the conversation gate; build to my best judgment; iterate after Console v0 ships                                                                                                                            | N/A                                                       |
| R8   | Target sandbox-mode bug regresses W2 propose_writes                                   | Test-first per G4-05; existing W2 propose_writes integration test must still pass with flag off (asserted before merging)                                                                                          | W2 integration test fails after sandbox patch              |
| R9   | Time runs out on Friday — Console v1 OR vuln reports OR cost report must cut          | Cut order (preserve passing-grade): Console v1 visual polish < Console journal CRUD < disagreement queue < case-detail trace-pair < vuln reports < cost report < deployed target. Brief-required deliverables (vuln reports x3, cost report) never cut. | Fri 10 AM status check: any of the three named must-haves at risk |
| R10  | Cumulative novel target-side changes (sandbox mode + new GACL slot) destabilize prod  | All target-side changes pass through the existing W2 eval gate (88 cases) before merging; sandbox-mode flag is env-only, no DB schema change                                                                       | Any W2 eval case regresses                                  |

---

## Decisions log (open items that get resolved as we go)

| #    | Decision                                                                              | Resolution                                                                                                                                  | Resolved at gate |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| DL1  | "Deployment tonight" scope                                                            | RESOLVED 2026-05-12 evening: commit + push to GitHub master; submit MVP via Gauntlet; no prod redeploy (no target-side changes shipped tonight); Console v0 explicitly deferred to Gate 5  | G0 (resolved)    |
| DL2  | Console deployment URL                                                                | Pending: choose subdomain (`redteam.108-61-145-220.nip.io`) vs path-prefix on existing host                                                  | G5-10            |
| DL3  | Langfuse cloud vs self-hosted                                                         | RESOLVED: stay on cloud through Friday; ARCH walk-back at G0-01; v2 commitment                                                              | G0-01            |
| DL4  | OSS Red Team model (Qwen)                                                             | DEFERRED to v2: keep Claude Haiku as MVP mutation engine through Friday                                                                     | (post-W3)        |
| DL5  | Tier-2 Judge sampling rate                                                            | DEFAULT 30%; tier-1 partial/fail bypass to 100%                                                                                              | G2-08            |
| DL6  | VULN report delivery channel                                                          | RESOLVED: markdown files in `vulnerabilities/` directory; pending/ for awaiting-approval; engineer-fixer reads markdown directly             | G3-07            |
| DL7  | Platform repo placement                                                               | RESOLVED for W3: `agentforge-redteam/` at top-level of this fork; standalone-extraction is v2/commercialization                              | (locked)         |
| DL8  | Console v0 vs ledger-first sequencing tonight                                         | RESOLVED: Console v0 ships JSON-backed tonight; Wed Gate 1 lands ledger; Gate 5 rewrites Console to read API                                  | G0               |

---

## How we use this doc going forward

- Flip `[ ]` → `[~]` → `[x]` in real time. Don't batch — flip when genuinely done.
- If a task changes shape mid-build, edit the row rather than abandoning it. This file IS the working log.
- New tasks discovered mid-week get added to the appropriate gate's section.
- The Submission Deliverables Checklist gets re-read end of every gate — that's how we keep eyes on the actual scorecard.
- Risk register is checked at every gate transition.

If anything in this doc reads stale or wrong, edit it before continuing on. The doc costs time to read; pay that cost once, not repeatedly.
