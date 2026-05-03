---
date: 2026-05-02
topic: Submission checklist file + cross-file resolution of PDF-vs-repo conflicts
related_milestone: ../../../../../TASKS.md (Gate 7)
---

# Submission checklist + PDF-vs-repo resolutions — session journal

## Goal

User asked for a new `Submission-Checklist.md` under
`Documentation/AgentForge/implementation/`, primarily based on the PDF
Submission Requirements table plus anything else explicitly called out in
[Week 1 - AgentForge.pdf](../../../references/Week%201%20-%20AgentForge.pdf).
After review, the user gave decisions on the five PDF-vs-repo conflicts I
surfaced and asked me to propagate the demo-video length change across every
affected file.

## Context

The submission bundle is due Sunday 2026-05-03 12:00 CT. Gate 6 (eval +
observability + deploy) closed 2026-05-01 with Langfuse wired live; remaining
work concentrates in Gate 7 (Loom, social post, AI cost analysis fill-in,
final submission packaging). The user wanted a single scoreboard to read on
submission morning rather than re-deriving the requirement set from the PDF.

## Key decisions

### Decision: Submission-Checklist scope, structure, and filename casing

- **Prompt:** "Let's create a new markdown file called 'Submission-Checklist' that we will place inside of the Documentation/implementation directory, primarily based on the information pasted below, and secondarily based on anything else that is explicitly called out inside the Week 1 - AgentForge PDF."
- **Recommendation:** Create
  [`Documentation/AgentForge/implementation/Submission-Checklist.md`](../../../implementation/Submission-Checklist.md)
  with five blocks: (1) Resolutions log for PDF-vs-repo conflicts, (2)
  per-deliverable Status + To-do sections in PDF order, (3) cross-cutting
  Agent Requirements (Agentic Chatbot / Verification / Observability /
  Evaluation), (4) AI Interview prep, (5) Final pre-submit checklist.
  Filename uses **capitalized kebab-case** (`Submission-Checklist.md`)
  per user — diverges from this directory's lowercase convention but the user
  confirmed.
- **Outcome:** File created and renamed via two-step `mv` (case-insensitive
  APFS); on-disk filename verified `Submission-Checklist.md`.

### Decision: Demo video length compressed to ~5 min across the repo (C2)

- **Prompt:** "We can shoot for 5 to 6 or 7 minutes, but the demo video length needs to be updated across all the files to the 5-minute mark roughly."
- **Recommendation:** Lock budget at **~5 min target, ≤7 min cap** (cohort
  leniency past the PDF's "3–5 min" wording). Replace every occurrence of
  the prior 8–12 min budget; compress per-section timings in PRD §13.2.1
  Loom script (45 s / 1 min / 2 min / 30 s / 30 s / 30 s ≈ 5 min); leave
  *script content* for record-time trim with a note in the section header.
- **Outcome:** Updated in
  [`PRD.md`](../../../../PRD.md) §0.3 line 35, §13.2.1 header + per-section
  timings, §13.2.2 done-means line; in
  [`TASKS.md`](../../../../../TASKS.md)
  G7-01 row; in
  [`open-questions.md`](../../../implementation/open-questions.md) Issue 2
  (priority row, detail section, resolution-tracking table); and in the new
  [`Submission-Checklist.md`](../../../implementation/Submission-Checklist.md)
  resolutions log + deliverable 5.

### Decision: Repository deliverable reframed from GitHub to GitLab (C4)

- **Prompt:** "The submission is definitely GitLab. We forked the repo or cloned the repo from GitHub, but everything that we're doing is pushed to GitLab only."
- **Recommendation:** Treat the PDF wording "GitHub Repository" as
  "Repository"; mark GitLab as the actual submission target. Note that
  upstream OpenEMR was *cloned* from GitHub but is not the deliverable.
- **Outcome:** Deliverable 1 in
  [`Submission-Checklist.md`](../../../implementation/Submission-Checklist.md)
  retitled "Repository (GitLab)" with a verbatim PDF quote and a per-C4 note.
  No code/path changes elsewhere.

### Decision: Remaining PDF-vs-repo conflicts closed without code changes (C1, C3, C5)

- **Prompt:** "For the inconsistency between user and users, the answer is how I currently have users.md. … The deadline is definitely Sunday at noon. … On the re-smoke for the live URL, we completed it yesterday, so all of that can be marked off as done."
- **Recommendation:** Keep `USERS.md` (plural) — the PDF is internally
  inconsistent (table row 3 says singular but Stage 4 paragraph says
  plural); cohort hasn't flagged the plural form. Lock deadline at
  **12:00 CT Sunday** — Gauntlet has reiterated noon in meetings; drop the
  10:59 PM "backstop" framing from the file. Mark the live-URL E2E
  re-smoke as **completed 2026-05-01** per
  [`post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md);
  no submission-day re-smoke is required beyond the planned 11:30 CT
  cellular check.
- **Outcome:** All three folded into the
  [`Submission-Checklist.md`](../../../implementation/Submission-Checklist.md)
  resolutions log with rationale preserved for AI Interview defence.

## Trade-offs and alternatives

- **Drop the resolutions section after closing all 5** — chose to keep it as
  an audit trail; cheap to keep, valuable if asked at the AI Interview why
  we kept plural `USERS.md` despite the PDF table.
- **Rewrite PRD §13.2.1 script content fully to fit 5 min** — chose to
  compress only the per-section timings and add a record-time trim note;
  full content compression belongs at the moment of recording, not now.
- **Flatten checklist to a single to-do list** — chose Status/To-do
  structure per deliverable to mirror sibling files
  ([`post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md),
  [`TASKS.md`](../../../../../TASKS.md))
  and to keep the "what exists vs what's left" split visible.

## Tools, dependencies, commands

_None this session._ (No skills installed/upgraded; no new dev deps.)

## Files touched

- **Created:** `Documentation/AgentForge/implementation/Submission-Checklist.md`
- **Modified:** `TASKS.md` (G7-01 row)
- **Modified:** `Documentation/AgentForge/implementation/open-questions.md` (Issue 2 priority summary, detail section, resolution-tracking table)
- **Modified:** `PRD.md` (§0.3 line 35 Loom checklist; §13.2.1 header + 6 section timings + record-time trim note; §13.2.2 length line)

## Outcomes

A single Sunday-morning scoreboard now exists at
[`Submission-Checklist.md`](../../../implementation/Submission-Checklist.md),
covering all nine PDF deliverables plus cross-cutting Agent Requirements and
AI Interview prep. The demo-video length is consistent at ~5 min target /
≤7 min cap across the PRD, the Gate 7 task-list row, the open-questions log,
and the new checklist. Deliverable-1 wording matches the actual submission
target (GitLab, not GitHub). The four remaining open-questions still tagged
unresolved are unchanged (Issue 2 closed; Issues 1 / 3 / 4 / 5 / 6 / 7 / 8
remain — most either superseded by shipped work or low-priority for V1
submission).

## Next steps

- [ ] Update root [`README.md`](../../../../README.md) with an "AgentForge Clinical Copilot" section: deployed link, setup pointer, ARCHITECTURE/AUDIT/USERS/PRD/JOURNEY links (deliverable 1 of the checklist)
- [ ] Pull actual dev-spend numbers from Anthropic console + AssemblyAI dashboard into [`ai-cost-analysis.md`](../../../implementation/ai-cost-analysis.md) §3; flip G7-07 from `[~]` to `[x]`
- [ ] Record the ~5 min demo video per the compressed [`PRD.md`](../../../../PRD.md) §13.2.1 script; trim content further at record time if it overruns
- [ ] Draft the social post in `Documentation/AgentForge/social-post.md` and publish before 12:00 CT Sunday
- [ ] Run the 11:30 CT cellular smoke check (G7-05) on submission day
- [ ] Book AI Interview slot within 24 h of submission

## Links

- Numbered milestone (Gate 7 home): [`process/15-gate6-complete.md`](../../15-gate6-complete.md) (most recent gate close; Gate 7 wraps the submission bundle)
- Submission scoreboard: [`implementation/Submission-Checklist.md`](../../../implementation/Submission-Checklist.md)
- Closed conflict log: [`implementation/open-questions.md`](../../../implementation/open-questions.md) Issue 2
