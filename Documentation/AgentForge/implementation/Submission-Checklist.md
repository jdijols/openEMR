---
title: AgentForge — Final Submission Checklist
source: Documentation/AgentForge/references/Week 1 - AgentForge.pdf (Submission Requirements + Stage gates + Agent Requirements + Interview Preparation)
deadline: 2026-05-03 12:00 CT (cohort-confirmed; PDF page-level "10:59 PM" is a known PDF inconsistency)
created: 2026-05-02
status: working — populated against current repo state
related:
  - TASKS.md (Gate 7)
  - ai-cost-analysis.md
  - dev-spend-log.md
  - post-deploy-bug-log.md
---

# AgentForge — Final Submission Checklist

This file is the **single pre-submit punch list** for the Sunday Gauntlet final
submission. It tracks the explicit deliverables table from
[Week 1 - AgentForge.pdf](../references/Week%201%20-%20AgentForge.pdf) plus the
Stage gates, Agent Requirements, and Interview Preparation that the PDF calls
out elsewhere — every item here is something Gauntlet has explicitly named.
Implementation depth lives in [`TASKS.md`](../../../TASKS.md);
this file is the **scoreboard** the user reads before submitting.

How to use it: every section ends in a `Status` line and a `To-do` list. Tick
items as they close. When every section's `To-do` is empty and the **Final
pre-submit checklist** at the bottom is fully green, we are clear to submit.

---

## Resolutions log (PDF-vs-repo conflicts, all closed before drafting)

These are conflicts identified between the PDF and the current repo. Each was
decided 2026-05-02 and is preserved here as an audit trail for the AI
Interview, where the rationale may need to be defended.

| #   | Conflict                                                            | Decision (2026-05-02)                                                                                                                                                                                                                                  | Status |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| C1  | `./USER.md` (PDF table) vs `./USERS.md` (PDF Stage 4 + repo)        | **Keep `USERS.md` (plural).** PDF is internally inconsistent (table row 3 says singular; Stage 4 paragraph and the "this document is the source of truth your ARCHITECTURE.md must trace back to" wording both say plural). Repo and links unchanged. | ✅ resolved |
| C2  | Demo video length: 3–5 min (PDF) vs ≤12 min (G7-01)                 | **Target ~5 min, ≤7 min cap.** Cohort guidance allows mild leniency past the PDF's 3–5 min wording. Propagated to: G7-01, [`PRD.md`](../../../PRD.md) §0.3 / §13.2.1 / §13.2.2, [`open-questions.md`](./open-questions.md) Issue 2.                    | ✅ resolved |
| C3  | Final deadline 12:00 CT vs 22:59 CT                                 | **12:00 CT (Sunday) is firm.** Reiterated by Gauntlet in cohort meetings; the PDF Submission Requirements page "10:59 PM CT" is a known inconsistency. No backstop framing.                                                                          | ✅ resolved |
| C4  | "GitHub Repository" wording (PDF) vs GitLab (actual submission)     | **GitLab is the submission target.** OpenEMR upstream was *cloned* from GitHub; everything we ship is pushed to GitLab only. PDF wording "GitHub Repository" is treated as "Repository" in deliverable 1 below.                                       | ✅ resolved |
| C5  | Live-URL re-smoke deferred                                           | **Completed 2026-05-01.** Full UC-A / UC-B / UC-C re-smoke ran on the live VPS; P1/P2/P3 fixes from `fb9613edb` confirmed; recorded in [`post-deploy-bug-log.md`](./post-deploy-bug-log.md). No outstanding regressions blocking the demo.            | ✅ resolved |

---

## Feedback response (cohort instructor reviews)

Two prior submissions received written instructor feedback. Each actionable
point is mapped here to the deliverable it touches and given an explicit
status so nothing slips through. Praise items are kept verbatim for AI
Interview context but require no action.

### Submission 2 — Early Submission (Thursday)

> **Strengths called out (verbatim):** "13 LLM-callable tools with real
> dynamic selection via the Vercel AI SDK, a citation-attribution verifier
> with fail-closed behavior, Langfuse-backed token/cost/latency tracing on a
> self-hosted VPS, and a live app with a confirmed end-to-end briefing
> workflow. The audit and architecture documents are excellent: specific
> OpenEMR file-level findings with code citations, direct cross-references
> between audit constraints and architecture decisions, and a well-reasoned
> integration path."
>
> **Main gap (verbatim):** "Three use cases in USERS.md is too thin a
> foundation for this stage, and 13 eval cases needs to grow significantly.
> These two gaps close together — every new use case you add should cascade
> into at least one new tool path and three new eval fixtures."

**Action items (instructor priority order):**

| #    | Feedback point                                                                                                                                                | Maps to                                                                                                                              | Status                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F2-1 | Put the **live URL in the README** — first thing any reviewer checks                                                                                          | Deliverable 1 (Repository) → root [`README.md`](../../../README.md) "AgentForge Clinical Copilot" section                            | ⏳ **open** — README update is already on the deliverable-1 to-do list; ship it first this morning                                                                                       |
| F2-2 | **Expand to 7+ use cases.** Suggested: abnormal lab follow-up, medication reconciliation, pre-procedure anticoagulation check                                 | Deliverable 3 ([`USERS.md`](../../../USERS.md)) — currently 3 use cases (UC-A / UC-B / UC-C); each new use case cascades to ≥1 new tool path + ≥3 new eval fixtures | ⚠️ **at-risk** — full +4 expansion is unrealistic by 12:00 CT today. **Triage decision needed before recording demo** — see triage note below                                            |
| F2-3 | Add **failure-mode eval cases:** all-domains-unavailable, provider timeout, conflicting medication records, constraint-boundary (describes a med change vs. recommends it) | Deliverable 6 (Eval Dataset) — current suite covers happy path + S1 cross-patient binding; missing systemic-failure + constraint-boundary | ⏳ **open** — these are self-contained eval fixtures (no new use-case prerequisite); achievable in remaining time independent of F2-2 outcome                                            |

**Triage note (F2-2 — use-case expansion under deadline pressure).** Adding
4 net-new use cases by 12:00 CT today is not realistic without cutting other
Gate 7 work. Realistic options, in priority order:

- **(a) Add 1 new use case + 3 eval fixtures + document the other two as
  V2 backlog.** *Abnormal lab follow-up* has the lowest tool-cascade cost
  because it reuses the existing labs Context endpoint. Medication
  reconciliation and pre-procedure anticoagulation get a one-paragraph
  entry each in [`USERS.md`](../../../USERS.md) §7 ("V1 does not include")
  with a "deferred to V2 — rationale" note. **Recommended.**
- **(b) Hold at 3 use cases**, document the gap explicitly in
  [`USERS.md`](../../../USERS.md) and acknowledge it in the demo video as a
  known V1 boundary. Lowest risk to schedule, highest risk to grading.
- **(c) Cut other Gate 7 polish** (social post draft, Loom polish, README
  formatting) to free time for 2+ new use cases. Not recommended — the
  remaining Gate 7 work is more visible to graders than borderline-quality
  use cases would be.

Pick before recording the demo so the video script aligns with what's
actually shipping.

### Submission 1 — MVP (Tuesday)

> **Verdict (verbatim):** MVP **passed**. Strengths: scope narrowing,
> "thinking through this like an actual product, not just an AI demo," user
> definition + workflow mapping (before/during/after visit), tied directly
> into architectural decisions. "Choices around keeping OpenEMR as the
> source of truth, handling permissions in PHP, and enforcing confirmation
> on writes show strong awareness of real constraints."
>
> **Critique at the time (verbatim):** "You didn't show proof of the system
> actually running — no deployed app, no walkthrough of OpenEMR, and no
> audit surfaced. For early submission, you need a live deployed
> environment, a full audit with key findings, and a working agent loop
> even if narrow."

**Status of MVP critique points:**

- [x] **Live deployed environment** — VPS at `https://108-61-145-220.nip.io` (closed Gate 6, 2026-05-01)
- [x] **Full audit with key findings** — [`AUDIT.md`](../../../AUDIT.md) at repo root, all five lanes covered (Security / Performance / Architecture / Data Quality / Compliance)
- [x] **Working agent loop** — UC-A auto brief + UC-B propose-confirm-write + UC-C recap, end-to-end on the live VPS, confirmed via 2026-05-01 re-smoke

No outstanding MVP-critique work; all three gaps closed by Gate 5 / Gate 6.

---

## Submission deliverables

Order matches the PDF Submission Requirements table.

### 1. Repository (GitLab)

> **PDF (verbatim):** GitHub Repository — Forked from OpenEMR. Includes setup guide, architecture overview, and deployed link.
>
> **Per C4:** the actual submission target is **GitLab**. Treat "Repository" as the deliverable.

**Status:** Repo present (this working copy) and pushed to GitLab. Root
[`README.md`](../../../README.md) has a brief "Gauntlet AgentForge (this fork)"
pointer to [`Documentation/AgentForge/README.md`](../README.md), but **does not
yet include the deployed link or an explicit AgentForge setup section**.

**To-do:**
- [x] GitLab repo at `https://labs.gauntletai.com/jasondijols/openemr.git` is **publicly viewable** — confirmed by user 2026-05-03.
- [~] `master` is current with the deployed build — local `master` in sync with `gitlab/master`; user confirmed essentially up-to-date. Five working-tree files (Submission-Checklist.md, v2-roadmap.md, README.md, VERIFICATION.md, agentforge/api/src/agent/system_prompt.ts) will land in a staging commit + push **before** final submission.
- [x] **README.md has a top-level Clinical Copilot section** — README was wholesale rewritten as a Clinical Copilot landing page (commit `a0d505905`); supersedes the original "add section" plan.
  - [x] **Deployed link** — README line 6 + line 100, prominently placed under the title
  - [x] **Setup guide** — README lines 101–102 link [`docker/development-easy/`](../../../docker/development-easy/), [`process/04-stage1-local-dev-runbook.md`](../process/04-stage1-local-dev-runbook.md), and [`process/09-vps-live-deployment.md`](../process/09-vps-live-deployment.md)
  - [x] **Architecture overview** — README line 94 + Documentation table line 114 link [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)
  - [x] **Pointers to AUDIT / USERS / PRD / JOURNEY** — Documentation table at README lines 113–121 lists all four plus VERIFICATION, EVALUATION, OBSERVABILITY, and TASKS
- [~] **(USER)** `Assisted-by: Claude Code` trailers — 23 commits already carry the trailer; the recent run (last ~10 commits) is clean. One older commit lacks it: `4a928113d UI updates, agent hardening, Gate 6 complete`. Decide whether to leave that as-is or note in submission that AI assistance applied across the build.

### 2. Audit Document — `./AUDIT.md`

> **PDF:** All audit findings with a 1-page (~500 word) summary detailing key findings.
> **PDF Stage 3 (Hard Gate):** must cover Security, Performance, Architecture, Data Quality, Compliance & Regulatory.

**Status:** [`AUDIT.md`](../../../AUDIT.md) exists at repo root (~112 KB, last
touched 2026-04-28).

**To-do:**
- [x] Document **begins with an Executive summary** ([AUDIT.md:9](../../../AUDIT.md)) — **373 words**, slightly under the ~500-word PDF target but within the spirit of "brevity is intentional"; lists nine OpenEMR constraints with cross-refs into §1–§5 and an explicit "Not authorized without closing the above" line
- [x] **All five PDF audit lanes covered** — §1 Security ([AUDIT.md:27](../../../AUDIT.md)), §2 Performance ([AUDIT.md:178](../../../AUDIT.md)), §3 Architecture ([AUDIT.md:309](../../../AUDIT.md)), §4 Data Quality ([AUDIT.md:382](../../../AUDIT.md)), §5 Compliance & Regulatory ([AUDIT.md:495](../../../AUDIT.md)); bonus §6 Pre-Build Imperatives. **37 findings total** (3 Critical / 23 High / 10 Medium / 1 Info)
- [x] **Audit posture confirmed:** pre-build baseline dated 2026-04-28 ([AUDIT.md:5](../../../AUDIT.md)) — matches PDF Stage 3 wording ("Before considering any additions to the project, you must complete a full audit"). User confirmed 2026-05-03; no reconciliation appendix needed.

### 3. User Doc — `./USERS.md`

> **PDF (verbatim):** The user you're focusing on with a list of use cases that your agent will address.
> **PDF Stage 4 (Hard Gate):** target user, their workflow, and specific use cases. Each use case must include an explicit answer to *why an agent is the right solution here*. Every agent capability built in Stage 5 must point to a use case here.
>
> **Per C1:** keeping plural `USERS.md`. PDF row 3 says singular but Stage 4 paragraph says plural.

**Status:** [`USERS.md`](../../../USERS.md) exists (~37 KB, last touched
2026-04-28).

**To-do:**
- [x] **Single, narrow user** — [USERS.md §2.1](../../../USERS.md): *Dr. Maya Reynolds*, adult primary-care physician, family/internal medicine, 18–24 patient day. Persona, patient scope, and explicit anti-persona (§2.3) all defined. Passes PDF Stage 4 "Pick a real, narrow user."
- [x] **"Why an agent" per use case** — every UC entry (UC-A…UC-J in [USERS.md §4](../../../USERS.md)) includes a **"Why agent (vs dashboard)"** bullet directly under the agent-behavior block. Reinforced by a dedicated [USERS.md §6 "Why a Conversational Agent"](../../../USERS.md) section with per-UC justification.
- [x] **Capability traceability** — [USERS.md §9 "Stage 5 Traceability Requirement"](../../../USERS.md) is a **40-row capability × use-case × tool/endpoint table** covering UC-A through UC-J, including refusal patterns, resilience patterns, and explicit "out of scope for V1" rows. [`ARCHITECTURE.md` "Traceability — capability ↔ use case"](../../../ARCHITECTURE.md) section mirrors it. All 10 UC tags appear in both docs; no orphan capability. **(Note: original to-do said "UC-A/B/C" — build expanded to UC-A through UC-J, addressing instructor feedback F2-2.)**

### 4. Agent Architecture Doc — `./ARCHITECTURE.md`

> **PDF:** Plan to integrate AI with technical details such as (but not limited to) framework choices, verification strategy, and known tradeoffs. Must begin with a 1-page (~500 word) summary of a high-level overview with key decisions.

**Status:** [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) exists (~24 KB, last
touched 2026-05-01).

**To-do:**
- [x] **~500-word summary at top** — [ARCHITECTURE.md `## Executive summary (~1 page)`](../../../ARCHITECTURE.md) at line 30, **538 words** (right on PDF target). Stronger still: a dedicated **`## For instructors — decisions in one place`** decision table sits *before* the executive summary at line 14 — Hosting / CUI / Agent backend / STT / Module / Safety / Observability with the *Why* column for each. The summary itself covers shape, deployment, CUI handshake, host UX, FHIR rationale, verification, writes, compliance posture, and an explicit "Tradeoffs we accept" close.
- [x] **Framework choices, verification, tradeoffs** — all named explicitly:
  - **React + Vite + TypeScript** ([ARCHITECTURE.md:19](../../../ARCHITECTURE.md))
  - **Node 20 + Hono + Vercel AI SDK** ([ARCHITECTURE.md:107](../../../ARCHITECTURE.md))
  - **Verification** — [ARCHITECTURE.md `## Verification (two steps, plain English)`](../../../ARCHITECTURE.md) at line 166: citations + sanity/conflict + negative-statement guard
  - **Tradeoffs** — Executive summary §"Tradeoffs we accept" (line 53) + "For instructors" demo-vs-enterprise-HIPAA caveat
- [x] **Trust boundaries** — covered three ways: (1) [ARCHITECTURE.md `## System diagram`](../../../ARCHITECTURE.md) at line 57 visually segregates **Browser / VPS Docker Compose / Cloud egress** with explicit BAA path; (2) [ARCHITECTURE.md `## Security rules we do not relax`](../../../ARCHITECTURE.md) at line 149 names active-chart binding, admin/super accepted risk, explicit-confirm write gate; (3) explicit "**boundary hygiene**" framing at line 113 in PHP+Node integration seams.
- [x] **Failure-mode coverage** — distributed but adequate: tool-failure debugging row in PHP+Node integration table ([ARCHITECTURE.md:119](../../../ARCHITECTURE.md) — correlation IDs across module/agent logs); verification "block or flag" on conflicts ([ARCHITECTURE.md:166](../../../ARCHITECTURE.md)); traceability row "Refusal / graceful degradation" mapping UC-H/UC-I/UC-J ([ARCHITECTURE.md:250](../../../ARCHITECTURE.md)); deeper failure-mode catalogue lives in [USERS.md UC-H + §7.3](../../../USERS.md). **(Note: ARCHITECTURE.md does not have a single dedicated "Failure modes" section — answer the AI Interview question by combining ARCHITECTURE.md verification + USERS.md UC-H + OBSERVABILITY.md trace path.)**

### 5. Demo Video (~5 min target, ≤7 min cap — per C2)

> **PDF (verbatim):** One demo video with each submission showcasing the work you've done, highlighting key decisions and showcasing the product. (Submission Requirements row 5 specifies "3–5 min".)

**Status:** Not yet recorded. Length budget locked at **~5 min, ≤7 min cap**
(C2). [`PRD.md`](../../../PRD.md) §13.2 script + per-section timings already
compressed; [`TASKS.md`](../../../TASKS.md)
G7-01 row updated.

**To-do:**
- [ ] Re-read the compressed [`PRD.md`](../../../PRD.md) §13.2.1 script and trim *content* further if rehearsal runs long (drop §6 refusal or fold §4 audit walk into §3)
- [ ] Storyboard hits, in order: open chart → **UC-A auto brief** with citation tap → **UC-B** dictation → propose → **confirm** → write lands → at least one **refusal/safety** moment (cross-patient or out-of-scope)
- [ ] Mention by name: **OpenEMR fork**, **Vercel AI SDK orchestrator**, **Langfuse observability**, **GACL gating**, **citation-bound verification**
- [ ] Record + upload (Loom or equivalent) and capture **public URL**
- [ ] Test the URL in an incognito window before pasting into [`submission.md`](../submission.md) (G7-03)

### 6. Eval Dataset

> **PDF:** Your test suite with results. Structure and scope are your design decisions.

**Status:** Eval lives in `agentforge/api` (Vitest) and PHPUnit isolated tests
under `tests/Tests/Isolated/Modules/AgentForge/`. Gate 6 closed with the
eval-runner refactor and Context HTTP-matrix coverage; see
[`process/15-gate6-complete.md`](../process/15-gate6-complete.md).

**To-do:**
- [x] **Latest results captured in the doc** — [EVALUATION.md `## The runner`](../../../EVALUATION.md) at line 33 embeds a sample run from `run_id: 20260503T064556949Z_25f6528b` (today): **39 cases / 0 failures / 6 ms**, broken down by all 10 rules. Suite is offline / no-LLM, runs as `npm run eval` from `agentforge/api/`. Also has `npm test` Vitest + PHPUnit isolated AgentForge suite cross-references at [EVALUATION.md `## Cross-references`](../../../EVALUATION.md).
- [x] **Failure modes cover PDF wording** — [EVALUATION.md `## Why eval at all`](../../../EVALUATION.md) at line 19 **quotes the PDF Eval section verbatim** ("missing data, ambiguous queries, inputs that attempt to extract information the requester is not authorized to see") and maps each: `negative_claim_requires_empty_query` + `all_domains_unavailable_refused` (missing data), `vitals_parser_uncertain_not_guess` (ambiguous), `cross_patient_blocked` + `unsupported_write_target_rejected` + `internal_disclosure_blocked` (authz). Plus 4 instructor-feedback rules: resilience (`provider_timeout_typed_error`), `conflicting_medication_records_warned`, `constraint_boundary_describes_vs_recommends`.
- [x] **ARCHITECTURE.md → EVALUATION.md link** — [ARCHITECTURE.md:192](../../../ARCHITECTURE.md) `## Speech, eval, observability (brief)` `Eval:` row now ends *"Full rule-by-rule breakdown, the 39-case fixture inventory, and the brief-to-rule traceability map are in [`EVALUATION.md`](EVALUATION.md)."* Cross-link complete.
- [x] **Submission front door — `submission.md` skipped (decision 2026-05-03).** Root [`README.md`](../../../README.md) is the front door: it carries the live URL, repo banners, full Documentation table, and the "Try it" block. The submission form / Loom / social-post URLs go directly into the GitLab/Gauntlet submission bundle, not into a separate `submission.md`. References to `submission.md` in the Final pre-submit checklist below are deprecated.
- [~] **(USER)** Interview Prep one-paragraph answer — drafted below; you'd just need to internalize it.

**Drafted answer for Interview Prep — *"What does your eval suite test that a happy-path demo would not reveal?"*** *(use or rewrite verbatim)*

> The 39 deterministic cases test six properties a demo cannot — by construction. First, **negative cases** prove the rules aren't tautologies: `no-write-without-confirm-fail.json` and `neg-claim-labs-unbacked.json` synthesize traces that *should* fail their rule, and the harness passes only if the rule correctly catches the violation. Second, **adversarial write targets** outside the V1 enum (orders, prescriptions, immunizations, allergy delete) are blocked deterministically — a demo doesn't naturally surface what the agent refuses. Third, **prompt-injection internal-disclosure** patterns (system-prompt extraction, tool-output dump) are exercised in two distinct shapes. Fourth, **constraint-boundary describes-vs-recommends** — 12 cases probing the "automation, not advice" line that the demo would only show one of. Fifth, **resilience failures** — all-domains-unavailable and provider-timeout — assert the agent typed-errors instead of fluent-confabulating, which a healthy live system would never produce naturally. Sixth, the eval is the **CI regression gate**: a future change to the verification layer that quietly weakens cross-patient binding or relaxes a confirm requirement would be caught at PR time, not at deployment.

**Embedded EVALUATION.md gaps — resolved 2026-05-03 (post-rewrite re-verification):**
- [x] [EVALUATION.md `## The cases at a glance`](../../../EVALUATION.md) at line 197 — **regenerated for 39 fixtures**, organized by check rule with all 10 rule groups represented, file links, and per-case use-case anchors. Header text says "39 fixtures, organized below by the check they exercise. Three are **negative cases**" (matches current total: was 2 negative, now 3 with the addition of `crud-vitals-delete-no-confirm.json`).
- [x] [EVALUATION.md `## Why this case count`](../../../EVALUATION.md) at line 274 — **reframed as "39 cases, why not more or fewer."** Defends each rule's case count individually (8 for `no_write_without_confirm`, 10 for `unsupported_write_target_rejected`, 12 for `constraint_boundary_describes_vs_recommends`, etc.) with explicit rationale per surface. Structural defense (deterministic rules, surface-area coverage, three-layer stack with verification.ts + Langfuse + eval) preserved.
- The original "NEW GAP" / `update-submission-files` skill markers are no longer present in the file. One residual line ([EVALUATION.md:349](../../../EVALUATION.md)) flags that the **separate** [`agentforge/api/eval/README.md`](../../../agentforge/api/eval/README.md) is still pre-expansion — that's a different file from EVALUATION.md itself; **(USER)** decide whether the eval/README inventory needs updating before submission (low priority — graders read EVALUATION.md, not the runner-side README).

### 7. AI Cost Analysis

> **PDF:** Actual dev spend and projected production costs at 100 / 1K / 10K / 100K users. Also consider architectural changes needed at each level. This is not simply cost-per-token * n users.

**Status:** [`ai-cost-analysis.md`](./ai-cost-analysis.md) exists with
methodology, unit economics, projections at 100 / 1K / 10K / 100K MAU, and
tier-by-tier inflection paragraphs.
[`TASKS.md`](../../../TASKS.md) G7-07 is
marked `[~]` — §3 actual dev-spend table awaits Anthropic + AssemblyAI console
fill-in.

**Status update 2026-05-03:** Cost analysis **promoted to top-level [COSTS.md](../../../COSTS.md)** at the repo root, peer with AUDIT / USERS / ARCHITECTURE. Old `ai-cost-analysis.md` stubbed as a redirect. README Documentation table updated with a COSTS.md row. ARCHITECTURE.md `## Cost snapshot` updated with measured numbers and a link to COSTS.md.

**To-do:**
- [x] **§3 actual-dev-spend** — [COSTS.md §3](../../../COSTS.md) populated from Anthropic console "Cost" view (`openEMR` API key, Apr 27 – May 3): **$3.34 total**, daily breakdown by gate phase, ~550 implied LLM turns at blended $0.006/turn. AssemblyAI $0.00 (free tier), Vultr <$15, Langfuse Cloud Hobby $0.00, dev-side AI assistance ~$240 (Cursor + Claude.ai prorated). **Total build cost ≈ $258, of which $3.34 is variable per-LLM-call.**
- [x] **`dev-spend-log.md` updated** — [Documentation/AgentForge/implementation/dev-spend-log.md](./dev-spend-log.md) now carries the daily Anthropic console totals from Gate 0 through submission day, plus auxiliary streams (AssemblyAI / Vultr / Langfuse / dev-side AI). Final row: **$3.34** at submission window close.
- [x] **`cost_estimate.ts` rate cleanup** — code correct (`anthropic: $1/$5`, `openai_azure / openai: $5/$15`); COSTS.md §2 reflects current state.
- [x] **Architectural changes per tier** — [COSTS.md §6](../../../COSTS.md) covers all four tiers with concrete code/infra changes, not `tokens × users`:
  - **100 clinicians:** rate-limiting per `user_id`, secret rotation, no code changes; VPS class scale-up
  - **1K:** horizontal `agentforge-api` replicas, PgBouncer, self-hosted Langfuse cluster, cost-budget alarm, paid STT tier
  - **10K:** Anthropic prompt caching (~30% hit rate ≈ $200K/yr saved), model-tier routing, regional API deploys, pre-warmed UC-A briefs, Postgres read replicas, enterprise STT contract
  - **100K:** per-tenant Compose/K8s, enterprise LLM contracts + BYO-LLM path, regional Langfuse + aggregate rollup, hospital-STT optionality, enterprise pricing inversion
- [x] **README documentation table** — COSTS.md row added between OBSERVABILITY.md and PRD.md.
- [x] **ARCHITECTURE.md cost snapshot** — annual-figure table updated to match COSTS.md §5 ($72K / $650K / $6.1M / $60M); pointer to COSTS.md added.
- [x] **G7-07 flipped** in [`TASKS.md`](../../../TASKS.md) (2026-05-03). G7-08 (UC-A case-presentation + CUI polish) also flipped to `[x]` — polish folded into demo-prep; tier-1 cut criteria not triggered.

### 8. Deployed Application

> **PDF:** Publicly accessible. For early and final submissions, the agent must work in the live environment.
> **PDF Stage 2 (Hard Gate):** must submit deployed app's URL as part of every submission.

**Status:** Deployed to VPS at `https://108-61-145-220.nip.io`. Latest deploy
of `fb9613edb` per [`post-deploy-bug-log.md`](./post-deploy-bug-log.md).
**Full E2E re-smoke completed 2026-05-01** (C5) — UC-A, UC-B
propose/confirm/write, UC-C, cross-patient refusal all confirmed working.

**To-do:**
- [ ] Verify TLS, headers, CORS allowlist, and Caddy front are still healthy on submission morning (no expired cert)
- [ ] Verify a **non-admin clinical user** (per [`process/16-clinical-copilot-acl-role-gate.md`](../process/16-clinical-copilot-acl-role-gate.md)) can use the rail — ACL gate works against real users, not just admin
- [ ] Add the live URL to [`submission.md`](../submission.md) (G7-03) and to the root `README.md` (deliverable 1)
- [ ] Run the **11:30 CT cellular smoke** check (G7-05) on submission day from a phone or hotspot before clicking submit

### 9. Social Post (Final submission only)

> **PDF:** Share on X or LinkedIn: describe the project, show the agent, tag @GauntletAI.

**Status:** Not yet drafted. Tracked as G7-02 in
`TASKS.md`; planned location
`Documentation/AgentForge/social-post.md`.

**To-do:**
- [ ] Draft the post in [`Documentation/AgentForge/social-post.md`](../social-post.md)
- [ ] Include: 1-line project pitch, the **live URL**, the **demo video URL**, the **GitLab repo URL**, and the **`@GauntletAI`** tag
- [ ] Pick the channel: **X** or **LinkedIn** (or both)
- [ ] Embed a screenshot or short clip from the demo video
- [ ] Publish **before 12:00 CT** Sunday and capture the **post URL** for [`submission.md`](../submission.md)

---

## Cross-cutting agent requirements (PDF "Agent Requirements" section)

These are not separate deliverables but the PDF explicitly calls them out as
required components. Confirm each is demonstrable in the demo video and
defensible in the AI Interview.

### Agentic Chatbot

> **PDF:** A multi-turn AI agent that can receive follow-up questions, maintain context across a conversation, and invoke tools to retrieve and reason over patient data.

- [ ] **(USER — demo recording)** Demo shows **multi-turn** conversation (not one-shot Q&A) — code supports it: propose→confirm flow at [agentforge/api/src/agent/orchestrator.ts:605-650](../../../agentforge/api/src/agent/orchestrator.ts:605); pending-proposal state in [agentforge/api/src/conversations/store.ts:228-255](../../../agentforge/api/src/conversations/store.ts:228); turns persisted via `appendTurn`. Demo just needs to be recorded.
- [ ] **(USER — demo recording)** Demo shows **tool invocation** (Context Service reads, propose-write tools) — code wires 10+ tools at [agentforge/api/src/agent/orchestrator.ts:614-619](../../../agentforge/api/src/agent/orchestrator.ts:614) (chart-context reads + `get_identity` + `get_allergies` + `propose_*` bundle); each tool call surfaces as a Langfuse span. Demo just needs to be recorded.
- [x] [`USERS.md`](../../../USERS.md) names a use case that **requires** multi-turn — UC-D, UC-E, UC-F, UC-G are all **propose-then-confirm** writes (structurally multi-turn — see [USERS.md §3.2](../../../USERS.md) "proposal first, then explicitly confirmed" and the explicit-confirmation-gate row at [USERS.md §9](../../../USERS.md)); UC-C post-room recap continues the same thread; [USERS.md §5 Sample Conversation Patterns](../../../USERS.md) shows multi-turn dialogues for every UC.
- [~] **(USER decision)** **Caveat worth knowing for the AI Interview:** the LLM call itself is single-shot per turn — `runChatTurn` passes only the current user message as `prompt` ([agentforge/api/src/agent/orchestrator.ts:639-651](../../../agentforge/api/src/agent/orchestrator.ts:639)) with no `messages[]` history replay. Multi-turn coherence is achieved via (a) the propose-confirm pattern using stateful `pending_proposals` rows the model reads via tools, and (b) the conversation_id thread visible in the UI. Pure follow-up Q&A like *"and before that?"* without restating the topic would degrade. The user-perceived multi-turn is real; the LLM-context multi-turn is intentionally narrow. Worth a one-line answer ready in case a grader probes this.

### Verification System

> **PDF:** Source attribution + domain constraint enforcement. Document approach and known limitations.

- [x] Verification pipeline documented — [ARCHITECTURE.md `## Verification (two steps, plain English)`](../../../ARCHITECTURE.md) at line 166 covers citations + sanity/conflict + negative statements and cross-references [`VERIFICATION.md`](../../../VERIFICATION.md), which walks all four layers in depth. The doc trio (ARCHITECTURE → VERIFICATION → PRD §9) is the verification deliverable.
- [ ] **(USER — demo recording)** Demo shows at least one **citation** the user can tap (UC-A auto brief) — code emits `source_pack` per row ([agentforge/api/src/agent/case_presentation_fetch.ts:201-204](../../../agentforge/api/src/agent/case_presentation_fetch.ts:201)) and builds a `citation_navigation` index returned to the rail ([agentforge/api/src/agent/orchestrator.ts:698](../../../agentforge/api/src/agent/orchestrator.ts:698)); rail handles `NAV_REQUEST` postMessage to host shell per [ARCHITECTURE.md:173](../../../ARCHITECTURE.md). Demo just needs to capture the click.
- [ ] **(USER — demo recording)** Demo shows a **refusal** that names a typed code + correlation ID — code emits typed refusals: `blocked_cross_patient_tool_args` ([verification.ts:110](../../../agentforge/api/src/agent/verification.ts:110)), `insufficient_evidence_after_verification` ([verification.ts:169](../../../agentforge/api/src/agent/verification.ts:169)), `internal_details_not_available` ([orchestrator.ts:580](../../../agentforge/api/src/agent/orchestrator.ts:580)), `conversation_patient_conflict` ([orchestrator.ts:593](../../../agentforge/api/src/agent/orchestrator.ts:593)); `correlation_id` flows through every refusal. Demo just needs to surface one on screen — cross-patient or out-of-scope is the easiest to trigger.
- [~] **(USER)** Defensible answer for Interview Prep: *"Why did you design the verification layer the way you did?"* — content is fully documented at [VERIFICATION.md](../../../VERIFICATION.md) (four-layer rationale + "What verification does NOT catch" — fidelity drift, paraphrase coverage, domain-rule scope, tool-call sufficiency, adversarial poisoning, no streaming, no external evidence). **You'd just need to internalize it.** One-paragraph version: *"Post-hoc deterministic gate, not in-loop, because the model is fluent and unreliable; verification is slow, narrow, and deterministic. Citations bind every claim to a source pack we actually retrieved this turn; negative claims require empty-query observations; impossible BP values are caught by a defense-in-depth parser; med-status conflicts surface as warnings rather than strips. We don't catch fidelity drift inside a correctly-cited source — that's V2."*

### Observability — must answer all four questions from logs

> **PDF:** "At minimum, you should be able to answer these questions from your logs at any time."

- [x] **What did the agent do on a specific request, and in what order?** → Langfuse trace with tool spans, per turn — confirmed: `traceTurn` opens trace at [observability/index.ts:86-99](../../../agentforge/api/src/observability/index.ts:86); `recordToolCall` spans wired across all tool files (`get_allergies.ts:23`, `chart_context_reads.ts:26`, `get_identity.ts:24`, 9 sites in `propose_writes.ts`); chronological reconstruction via Langfuse start-time ordering; example trace shape documented at [OBSERVABILITY.md:98-130](../../../OBSERVABILITY.md).
- [x] **How long did each step take?** → span durations in Langfuse — confirmed: paired `start` + `end` pattern ([OBSERVABILITY.md:46-60](../../../OBSERVABILITY.md)); `start_time_ms = Date.now()` threaded through to Langfuse `startTime` at [orchestrator.ts:644](../../../agentforge/api/src/agent/orchestrator.ts:644); LLM generation latency captured by Langfuse server-side.
- [x] **Did any tools fail, and if so, why?** → typed error codes + correlation ID in API logs and Langfuse — confirmed: `span.end({ error: e })` marks span as `level: ERROR` with truncated `String(e)` in `statusMessage` ([observability/index.ts:119-122](../../../agentforge/api/src/observability/index.ts:119)); `correlation_id` in `costMeta` ([orchestrator.ts:679](../../../agentforge/api/src/agent/orchestrator.ts:679)); structured outcome metadata (rejection_reason, write_target) on success-level spans for `propose_writes.ts`.
- [x] **How many tokens were consumed, and at what cost?** → `recordLlmCall` metadata + Langfuse cost column + [`COSTS.md`](../../../COSTS.md) — confirmed: `recordLlmCall` defined at [observability/index.ts:67, 193-246](../../../agentforge/api/src/observability/index.ts:67); called from orchestrator (twice — request phase + response phase at [orchestrator.ts:623, 689](../../../agentforge/api/src/agent/orchestrator.ts:623)) and from case_presentation (twice at [case_presentation.ts:205, 247](../../../agentforge/api/src/agent/case_presentation.ts:205)); `cost_usd` computed via `estimateUsdForProviderTokens` at orchestrator.ts:667; passed to Langfuse as `usage` + `totalCost` ([observability/index.ts:197-207](../../../agentforge/api/src/observability/index.ts:197)). [COSTS.md](../../../COSTS.md) is the dedicated top-level cost analysis (the old `ai-cost-analysis.md` is now a redirect stub at [Documentation/AgentForge/implementation/ai-cost-analysis.md](./ai-cost-analysis.md)).
- [x] Langfuse screenshot embedded — Tracing list view of the OpenEMR / AgentForge project on Langfuse Cloud is embedded in [OBSERVABILITY.md `### Live Langfuse view`](../../../OBSERVABILITY.md) right after the trace-shape walkthrough. Asset at [`Documentation/AgentForge/assets/LangFuse.png`](../assets/LangFuse.png).

### Evaluation

> **PDF:** Build a test suite that surfaces failure modes, regression risks, and edge cases that matter in clinical settings.

- [x] Confirm Eval Dataset (deliverable 6) covers **missing data, ambiguous queries, and authz-bypass attempts** (PDF wording) — confirmed: [EVALUATION.md `## Why eval at all`](../../../EVALUATION.md) at line 19 quotes the PDF verbatim and maps each phrase to specific rules: **missing data** → `negative_claim_requires_empty_query` + `all_domains_unavailable_refused`; **ambiguous queries** → `vitals_parser_uncertain_not_guess`; **authz-bypass** → `cross_patient_blocked` + `internal_disclosure_blocked` + `unsupported_write_target_rejected`. Plus 4 instructor-feedback rules (resilience, conflict, constraint-boundary). 39 cases / 0 failures / 6ms in latest run ([EVALUATION.md:33](../../../EVALUATION.md)).

---

## AI Interview prep (24 hours after each submission)

The PDF calls out an AI Interview as a **required** part of admission, not a
deliverable in the table. Block time on the calendar and have rehearsed answers
to the four Interview Preparation lanes.

- [ ] **Your Audit:** most important finding; what would have been missed by skipping; how the audit changed the integration plan
- [ ] **Your Architecture:** verification design rationale; tool/record-missing failure behavior; trust boundaries
- [ ] **Your Evaluation:** what the suite tests beyond the happy path; what was found; what's next
- [ ] **Production Thinking:** scaling to **500-bed hospital + 300 concurrent clinicians**; what you'd change before a real physician relied on this; the failure mode that worries you most

---

## Final pre-submit checklist (run-through at ~11:00 CT Sunday)

When this list is fully green, submit at 12:00 CT.

- [ ] All nine deliverables above show clean `Status` and empty `To-do`
- [ ] **GitLab submission form** lists: **live URL**, **demo video URL**, **social post URL**, **GitLab repo URL** (per the `submission.md` skip decision in Deliverable 6 — URLs go directly into the submission form, not a separate file)
- [ ] Live URL passes 11:30 CT cellular smoke (G7-05)
- [ ] Last commit on `master` includes `Assisted-by:` trailer where AI helped
- [ ] Gate 7 row `G7-06` flipped `[x]` with submission timestamp
- [ ] AI Interview slot booked within 24 h of submission

---

## Conventions used by this file

- **PDF source.** Quotes prefixed with **"PDF:"** are verbatim from
  [Week 1 - AgentForge.pdf](../references/Week%201%20-%20AgentForge.pdf).
- **Status vs To-do.** `Status` is what exists today; `To-do` is what must
  happen before this section ticks green.
- **Cross-references.** Implementation depth is **not** duplicated here — point
  at [`TASKS.md`](../../../TASKS.md),
  [`ai-cost-analysis.md`](./ai-cost-analysis.md), and process journals instead.
