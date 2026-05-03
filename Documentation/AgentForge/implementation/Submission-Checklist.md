---
title: AgentForge — Final Submission Checklist
source: Documentation/AgentForge/references/Week 1 - AgentForge.pdf (Submission Requirements + Stage gates + Agent Requirements + Interview Preparation)
deadline: 2026-05-03 12:00 CT (cohort-confirmed; PDF page-level "10:59 PM" is a known PDF inconsistency)
created: 2026-05-02
status: working — populated against current repo state
related:
  - clinical-copilot-task-list.md (Gate 7)
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
Implementation depth lives in [`clinical-copilot-task-list.md`](./clinical-copilot-task-list.md);
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
- [ ] Confirm the GitLab repo is **publicly viewable** (or graders have access) and `master` is current with the deployed build
- [ ] Add a top-level "AgentForge Clinical Co-Pilot" section to [`README.md`](../../../README.md) with:
  - [ ] **Deployed link** (live URL — currently `https://108-61-145-220.nip.io`)
  - [ ] **Setup guide** link or short block — point at [`docker/development-easy/`](../../../docker/development-easy/) plus [`process/04-stage1-local-dev-runbook.md`](../process/04-stage1-local-dev-runbook.md) and [`process/09-vps-live-deployment.md`](../process/09-vps-live-deployment.md)
  - [ ] **Architecture overview** link to [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)
  - [ ] Pointers to [`AUDIT.md`](../../../AUDIT.md), [`USERS.md`](../../../USERS.md), [`PRD.md`](../../../PRD.md), [`JOURNEY.md`](../../../JOURNEY.md)
- [ ] Verify `Assisted-by: Claude Code` trailers exist where AI helped (per [`CLAUDE.md`](../../../CLAUDE.md) AI Assistance Trailer policy)

### 2. Audit Document — `./AUDIT.md`

> **PDF:** All audit findings with a 1-page (~500 word) summary detailing key findings.
> **PDF Stage 3 (Hard Gate):** must cover Security, Performance, Architecture, Data Quality, Compliance & Regulatory.

**Status:** [`AUDIT.md`](../../../AUDIT.md) exists at repo root (~112 KB, last
touched 2026-04-28).

**To-do:**
- [ ] Verify the document **begins** with a ~500-word summary highlighting the most impactful findings (PDF emphasises *brevity is intentional*)
- [ ] Confirm all five audit lanes are covered: **Security**, **Performance**, **Architecture**, **Data Quality**, **Compliance & Regulatory**
- [ ] Cross-check that the audit findings still reflect post-Gate-6 state (no stale "TODO" findings that have since been closed)

### 3. User Doc — `./USERS.md`

> **PDF (verbatim):** The user you're focusing on with a list of use cases that your agent will address.
> **PDF Stage 4 (Hard Gate):** target user, their workflow, and specific use cases. Each use case must include an explicit answer to *why an agent is the right solution here*. Every agent capability built in Stage 5 must point to a use case here.
>
> **Per C1:** keeping plural `USERS.md`. PDF row 3 says singular but Stage 4 paragraph says plural.

**Status:** [`USERS.md`](../../../USERS.md) exists (~37 KB, last touched
2026-04-28).

**To-do:**
- [ ] Verify the doc names a **single, narrow user** (per PDF Stage 4: "Pick a real, narrow user") even though the filename is plural
- [ ] Verify each use case includes an explicit **"why an agent is the right solution"** paragraph (PDF Stage 4 hard gate)
- [ ] Cross-check that **every UC-A / UC-B / UC-C capability** in [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) traces back to a use case here

### 4. Agent Architecture Doc — `./ARCHITECTURE.md`

> **PDF:** Plan to integrate AI with technical details such as (but not limited to) framework choices, verification strategy, and known tradeoffs. Must begin with a 1-page (~500 word) summary of a high-level overview with key decisions.

**Status:** [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) exists (~24 KB, last
touched 2026-05-01).

**To-do:**
- [ ] Verify the doc **begins** with a ~500-word summary highlighting **key decisions, major considerations, and tradeoffs** (PDF Stage 5 wording)
- [ ] Confirm explicit coverage of: **framework choices** (Vercel AI SDK, Hono, React/Vite), **verification strategy** (citation enforcement §9.1, sanity §9.2, negative-statement guard §9.3), **known tradeoffs**
- [ ] Confirm trust-boundary diagram or paragraph (Interview Prep "Where are the trust boundaries?")
- [ ] Confirm failure-mode coverage (Interview Prep "What does your agent do when a tool fails or a record is missing?")

### 5. Demo Video (~5 min target, ≤7 min cap — per C2)

> **PDF (verbatim):** One demo video with each submission showcasing the work you've done, highlighting key decisions and showcasing the product. (Submission Requirements row 5 specifies "3–5 min".)

**Status:** Not yet recorded. Length budget locked at **~5 min, ≤7 min cap**
(C2). [`PRD.md`](../../../PRD.md) §13.2 script + per-section timings already
compressed; [`clinical-copilot-task-list.md`](./clinical-copilot-task-list.md)
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
- [ ] Capture **latest results** (pass/fail counts, run time) from a clean run on the live build — agent API Vitest, CUI Vitest, PHPUnit isolated AgentForge suite
- [ ] Surface **failure modes** the suite covers explicitly — per PDF Eval section: "missing data, ambiguous queries, inputs that attempt to extract information the requester is not authorized to see"
- [ ] Confirm the eval dataset is referenced from `ARCHITECTURE.md` and `submission.md` so the grader can find it
- [ ] Have a one-paragraph answer ready for Interview Prep: *"What does your eval suite test that a happy-path demo would not reveal?"*

### 7. AI Cost Analysis

> **PDF:** Actual dev spend and projected production costs at 100 / 1K / 10K / 100K users. Also consider architectural changes needed at each level. This is not simply cost-per-token * n users.

**Status:** [`ai-cost-analysis.md`](./ai-cost-analysis.md) exists with
methodology, unit economics, projections at 100 / 1K / 10K / 100K MAU, and
tier-by-tier inflection paragraphs.
[`clinical-copilot-task-list.md`](./clinical-copilot-task-list.md) G7-07 is
marked `[~]` — §3 actual dev-spend table awaits Anthropic + AssemblyAI console
fill-in.

**To-do:**
- [ ] Pull **actual dev spend** numbers from Anthropic console + AssemblyAI dashboard, fill §3 table
- [ ] Append the latest row to [`dev-spend-log.md`](./dev-spend-log.md) so the rolling tally matches
- [ ] Reconcile the in-repo `cost_estimate.ts` Sonnet-rate caveat (~3× over) — either fix the rate table or keep the disclaimer in §2 (currently disclaimed)
- [ ] Confirm the doc explicitly addresses **architectural changes per tier**, not just `tokens × users` (PDF emphasis)
- [ ] Flip G7-07 from `[~]` to `[x]` once §3 lands

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
`clinical-copilot-task-list.md`; planned location
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

- [ ] Demo shows **multi-turn** conversation (not one-shot Q&A)
- [ ] Demo shows **tool invocation** (Context Service reads, propose-write tools)
- [ ] [`USERS.md`](../../../USERS.md) names a use case that **requires** multi-turn — per PDF: "If you cannot point to a use case in your USERS.md that requires multi-turn conversation, you should not have multi-turn conversation"

### Verification System

> **PDF:** Source attribution + domain constraint enforcement. Document approach and known limitations.

- [ ] [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) documents the §9.1 / §9.2 / §9.3 verification pipeline
- [ ] Demo shows at least one **citation** the user can tap (UC-A auto brief)
- [ ] Demo shows a **refusal** that names a typed code + correlation ID
- [ ] Have a defensible answer for Interview Prep: *"Why did you design the verification layer the way you did?"*

### Observability — must answer all four questions from logs

> **PDF:** "At minimum, you should be able to answer these questions from your logs at any time."

- [ ] **What did the agent do on a specific request, and in what order?** → Langfuse trace with tool spans, per turn
- [ ] **How long did each step take?** → span durations in Langfuse
- [ ] **Did any tools fail, and if so, why?** → typed error codes + correlation ID in API logs and Langfuse
- [ ] **How many tokens were consumed, and at what cost?** → `recordLlmCall` metadata + Langfuse cost column + [`ai-cost-analysis.md`](./ai-cost-analysis.md)
- [ ] Confirm a Langfuse screenshot is in the demo video or [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)

### Evaluation

> **PDF:** Build a test suite that surfaces failure modes, regression risks, and edge cases that matter in clinical settings.

- [ ] Confirm Eval Dataset (deliverable 6) covers **missing data, ambiguous queries, and authz-bypass attempts** (PDF wording)

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
- [ ] [`submission.md`](../submission.md) (G7-03) lists: **live URL**, **demo video URL**, **social post URL**, **GitLab repo URL**
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
  at [`clinical-copilot-task-list.md`](./clinical-copilot-task-list.md),
  [`ai-cost-analysis.md`](./ai-cost-analysis.md), and process journals instead.
