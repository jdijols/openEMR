---
name: update-submission-files
description: Sync the five AgentForge submission docs (USERS.md, ARCHITECTURE.md, VERIFICATION.md, EVALUATION.md, OBSERVABILITY.md) and the README index against the current state of the codebase. Use when the user says "update submission files", "sync submission docs", "refresh submission", "submission docs are stale", or asks to verify the submission package still reflects the current code. Runs in auto-apply mode over a clean working tree (refuses to run if any in-scope file has uncommitted changes), then prints a one-line-per-edit summary marking prose-changing edits with a ⚠ marker so the user can scan for review-worthy changes. Recovery is `git diff HEAD` and `git checkout`. AUDIT.md and PRD.md are intentionally NOT in scope — AUDIT.md is Stage-3 locked content, PRD.md is the spec (upstream of code).
---

# Update submission files

This skill keeps the **AgentForge Week 1 submission package** in sync with the codebase as the application evolves through submission. It audits the five content docs and the README index against the live code, then **auto-applies** mechanical fixes — with `git` as the safety net.

> Canonical home: **repo root**. Files: `USERS.md`, `ARCHITECTURE.md`, `VERIFICATION.md`, `EVALUATION.md`, `OBSERVABILITY.md`, `README.md`. AUDIT.md and PRD.md are **not** managed by this skill — AUDIT.md is Stage-3 locked content (pre-code constraints, doesn't drift with code); PRD.md is the spec, upstream of code.

## 1. Files in scope

The submission package as managed by this skill is exactly six files. Five are content; the sixth is the index.

| File | Purpose | Drift-risk surface |
|------|---------|--------------------|
| [`USERS.md`](../../../USERS.md) | User roles, GACL groups, V1 use cases, refusal behavior | GACL config in `interface/modules/custom_modules/oe-module-agentforge/`; the V1 confirmed-write enum |
| [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) | System architecture, components, data flow | Module paths; tech-stack versions in `package.json` / `composer.json`; deploy posture (Caddy, Compose, Langfuse) |
| [`VERIFICATION.md`](../../../VERIFICATION.md) | The verification layer (citation, neg-claim, BP range, med-inactive) | `agentforge/api/src/agent/verification.ts`; `orchestrator.ts` flow position; "Open gaps" section |
| [`EVALUATION.md`](../../../EVALUATION.md) | Eval suite — N cases × 6 deterministic checks | `agentforge/api/eval/runner.ts`; `eval/cases/curated/*.json` count; "Open gaps" section |
| [`OBSERVABILITY.md`](../../../OBSERVABILITY.md) | Langfuse trace shape, PHI redactor, cost wiring | `agentforge/api/src/observability/`; `agent/cost_estimate.ts` rates; "Open gaps" section |
| [`README.md`](../../../README.md) | Repo-root README — TOC + repo-state narrative | TOC links to all seven submission/spec docs; AgentForge-specific narrative; preserved upstream OpenEMR content |

**Note on the README's TOC.** The README links to all *seven* submission/spec docs at repo root: AUDIT, USERS, ARCHITECTURE, VERIFICATION, EVALUATION, OBSERVABILITY, PRD. The skill keeps that TOC complete (a missing link is a `README MISSING LINK` finding) even though it doesn't audit AUDIT.md or PRD.md content.

**Note on the README's narrative.** The README is not just a TOC. It must carry its own AgentForge-specific narrative — what the application is, what's deployed, where instructors should start — and must preserve upstream OpenEMR content (badges, GPL, contributing). Audit checklist in §4 covers all three layers (TOC, narrative, preservation).

## 2. Sync mode: auto-apply with clean-tree precondition

This skill runs in **auto-apply** mode. There is no confirmation step. Two safety nets sit in front:

### 2.1 Clean-tree precondition

Before doing anything, the skill checks that all six in-scope files are committed. The check is per-file:

```bash
git status --porcelain -- USERS.md ARCHITECTURE.md VERIFICATION.md EVALUATION.md OBSERVABILITY.md README.md
```

If the output is non-empty (any file is modified, staged, untracked-where-tracked-was-expected, or deleted), abort with:

```
[BLOCKED] uncommitted changes in submission files. Commit or stash before running this skill.
  M USERS.md
  M README.md
```

Do not partially-run. The clean-tree precondition exists so that `git diff HEAD --` after the run shows *exactly and only* what the skill did. Without it, the user can't tell skill-edits apart from their own in-progress work.

The skill never runs `git stash`, `git restore`, `git reset`, or any destructive command on the user's behalf. Resolving the dirty-tree state is the user's call.

### 2.2 End-of-run summary with prose-change markers

After applying edits, the skill prints one line per applied edit. Each line names the file, the finding type, and a one-phrase description. Lines with `GAP RESOLVED` or `NEW GAP` (the two finding types that change *prose*, not just citations or links) carry a `⚠ prose change` marker so the user can scan for review-worthy edits without reading every diff.

Example summary:

```
[APPLIED] VERIFICATION.md   STALE ANCHOR    verification.ts:54-60 → 54-62 (line drift)
[APPLIED] OBSERVABILITY.md  GAP RESOLVED    ⚠ prose change  Open gap #1 (cost_estimate rates corrected — bullet struck)
[APPLIED] ARCHITECTURE.md   DRIFT           Langfuse posture row — added cloud/self-hosted split
[APPLIED] README.md         README MISSING LINK  EVALUATION.md added to TOC
[APPLIED] EVALUATION.md     STALE ANCHOR    runner.ts:294-295 → 296-297 (line drift)

Run complete: 5 edits applied across 4 files.
Review with: git diff HEAD -- USERS.md ARCHITECTURE.md VERIFICATION.md EVALUATION.md OBSERVABILITY.md README.md
Recovery: git checkout HEAD -- <file> reverts a single file; git checkout HEAD -- . reverts all six.
```

Mechanical findings (`STALE ANCHOR`, `DRIFT`, `README MISSING LINK`) get applied silently in the diff but still appear in the summary. The `⚠ prose change` marker is the user's signal to look closer at those specific findings.

## 3. Process

### Step 1 — Clean-tree check

For each of the six in-scope files at repo root, run `git status --porcelain -- <file>`. If any returns non-empty, abort with the `[BLOCKED]` message above. Do not proceed.

If any in-scope file is missing entirely (deleted, never created), surface that as the blocking error:

```
[BLOCKED] missing submission file: VERIFICATION.md
```

…and stop. Do not silently create a placeholder.

### Step 2 — Read all six files plus relevant code surfaces

Read each in-scope file. Note headings, "Open gaps" sections, and every `path:line` citation in the doc body.

For code surfaces named in the docs, read the current state to verify anchors and content claims. The per-file checklists in §4 name what to read for each doc.

### Step 3 — Audit per-file

Classify each finding as one of five types:

- **`STALE ANCHOR`** — citation `path:line` no longer points at what the doc claims (file moved, line drifted, or the cited token is no longer at that line).
- **`GAP RESOLVED`** — an "Open gaps" item appears done in the code; the bullet should be struck or marked complete.
- **`NEW GAP`** — drift introduced by recent code that the doc doesn't acknowledge yet (e.g., a new verification rule added to `verification.ts` not described in VERIFICATION.md).
- **`DRIFT`** — content claim no longer matches code (versions, counts, postures, deployment shape).
- **`README MISSING LINK`** — README TOC is missing a link to one of the seven submission/spec docs.

Findings without one of these classifications get dropped — vague "this could be better" observations are not findings.

### Step 4 — Apply edits

Apply the smallest possible edit per finding. **Preserve every line of surrounding prose.** Don't tidy, reflow, normalize whitespace, or re-format tables.

For `GAP RESOLVED`, prefer striking (or marking with a brief `(addressed)` parenthetical) over rewriting surrounding prose. The "Open gaps" sections were written so that bullet-level removal is safe.

For `NEW GAP`, append a new bullet to the relevant "Open gaps" section. Do not refactor existing bullets.

For `STALE ANCHOR`, change only the `path:line` portion of the affected markdown link. Do not edit the link's display text or surrounding sentence unless the line drift makes the sentence wrong.

For `DRIFT`, change only the specific phrase or table cell that's wrong. If the drift is bigger than a sentence (e.g., "the entire system diagram is now wrong"), surface it as a `NEW GAP` instead of attempting a wholesale edit — wholesale edits belong to a manual rewrite, not this skill.

For `README MISSING LINK`, add the missing link to the existing TOC list. If the README has no TOC section yet, propose-and-create one using the recommended shape in §5.

### Step 5 — Print the summary

Print one line per applied edit using the format in §2.2. Mark `GAP RESOLVED` and `NEW GAP` with `⚠ prose change`.

End with the run-complete + review/recovery hint lines.

## 4. Per-file audit

Reference shapes, not exhaustive. If something looks off and doesn't fit a checklist item, still flag it under the appropriate finding type.

### USERS.md

- Compare role/group lists against the GACL installer code under [interface/modules/custom_modules/oe-module-agentforge/](../../../interface/modules/custom_modules/oe-module-agentforge/).
- Check the `agentforge/use` and `agentforge/propose_write` permission references; they must match what the installer actually seeds.
- Check the V1 confirmed-write target list (chief complaint, vitals, tobacco, allergies) against `V1_WRITE_TARGETS` in [agentforge/api/eval/runner.ts](../../../agentforge/api/eval/runner.ts). If the runner's set has expanded, USERS' "V1 includes" list must match — `DRIFT`.
- If the role exclusion list (front office, accounting, etc.) has changed in the installer, surface as `DRIFT`.

### ARCHITECTURE.md

- Component diagram (textual / mermaid): each named component should still resolve to a real path on disk.
- Tech-stack versions: cross-check against [`agentforge/api/package.json`](../../../agentforge/api/package.json), [`agentforge/cui/package.json`](../../../agentforge/cui/package.json), and [`composer.json`](../../../composer.json).
- Deploy posture: [`docker/agentforge/secrets.prod.env`](../../../docker/agentforge/secrets.prod.env) and [`secrets.dev.env`](../../../docker/agentforge/secrets.dev.env) are the runtime source of truth (Langfuse base URL, LLM provider, etc.). If the doc claims `self-hosted Langfuse` but `secrets.prod.env` points at a cloud URL, that's `DRIFT`.
- Major decisions referenced in the doc — confirm referenced files / line ranges still exist.

### VERIFICATION.md

- Anchors: line numbers in [agentforge/api/src/agent/verification.ts](../../../agentforge/api/src/agent/verification.ts) for the four layers (citation enforcement, negative-claim backing, BP range guard, med-inactive warning).
- Anchor: [agentforge/api/src/agent/orchestrator.ts](../../../agentforge/api/src/agent/orchestrator.ts) for the verification call site (currently around line 660). If line drifted, `STALE ANCHOR`.
- "Open gaps" section: re-evaluate each item against the current state of `verification.ts` and `orchestrator.ts`. Items that look done → `GAP RESOLVED`.
- New verification logic added to `verification.ts` that the doc doesn't mention → `NEW GAP`.

### EVALUATION.md

- Verify case count by counting [agentforge/api/eval/cases/curated/](../../../agentforge/api/eval/cases/curated/)`*.json`. If not the count claimed in the doc (currently 13), the inventory table and the narrative ("13 curated cases", "Why 13 cases, not 50") need updating — `DRIFT`.
- Verify the six check names in the dispatcher at [agentforge/api/eval/runner.ts](../../../agentforge/api/eval/runner.ts) `evaluateCase` switch still match the doc's section headings under §"The six checks".
- Pass/fail inversion logic citation in `runner.ts` (currently around line 294-295) — confirm still valid.
- "Open gaps" section: re-evaluate.

### OBSERVABILITY.md

- Anchors: every line range cited in [agentforge/api/src/observability/](../../../agentforge/api/src/observability/) (`index.ts`, `redact.ts`).
- The cost-rate caveat: confirm [agentforge/api/src/agent/cost_estimate.ts](../../../agentforge/api/src/agent/cost_estimate.ts) still has the heuristic rates the doc describes. If rates were corrected to match the in-use model, the caveat → `GAP RESOLVED`.
- Tool span call sites: spot-check at least one tool (e.g., `tools/get_allergies.ts`) for the `recordToolCall` + `span.end` pattern still being present.
- "Open gaps" section: re-evaluate.

### README.md

The README plays three roles — TOC, AgentForge narrative, and preserved upstream content. Audit each.

**TOC role:**
- Verify the README contains a section that links to all seven submission/spec docs at repo root with relative paths: `AUDIT.md`, `USERS.md`, `ARCHITECTURE.md`, `VERIFICATION.md`, `EVALUATION.md`, `OBSERVABILITY.md`, `PRD.md`.
- If any are unlinked → `README MISSING LINK`.

**AgentForge narrative role:**
- The README must carry its own description of the application's current state — what AgentForge is, what's deployed, what V1 covers, where to start. The TOC alone is not sufficient.
- If the narrative is out of step with the application (e.g., "deployed at <old URL>", "supports <old feature set>"), that's `DRIFT`.
- Acceptable narrative anchors: live URL (currently `https://108-61-145-220.nip.io`), V1 use case summary (UC-A / UC-B / UC-C), explicit pointer to `Documentation/AgentForge/` for the process trail.

**Preservation role:**
- Upstream OpenEMR content (CI badges at the top, the OpenEMR project description, contributing/support pointers, GPL license note, Node version build instructions) must be preserved verbatim. Do not reformat or rewrite.
- If the user has manually edited upstream content, treat that as authoritative and do not re-paste the original — the skill is not the canonical OpenEMR README.

## 5. Recommended README TOC shape (used only when none exists)

If the README has no submission TOC section yet, add one in this shape, placed after the existing AgentForge introductory paragraph (currently around line 23-25):

```markdown
## Week 1 submission deliverables

The instructor-facing submission package. Each content doc opens with a 30-second
summary; cross-references between docs are live.

- [AUDIT.md](AUDIT.md) — security / threat audit findings (Stage 3, pre-code constraints).
- [USERS.md](USERS.md) — user roles, GACL groups, V1 use cases.
- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture and data flow.
- [VERIFICATION.md](VERIFICATION.md) — the verification layer: source attribution and domain constraints.
- [EVALUATION.md](EVALUATION.md) — the eval suite: deterministic checks over curated cases.
- [OBSERVABILITY.md](OBSERVABILITY.md) — Langfuse trace shape, PHI redaction, cost.
- [PRD.md](PRD.md) — product requirements.
```

If a submission section already exists in a different style (e.g., `# Submission`, or with different bullet wording), match the existing style — only add the missing link(s). The user's voice wins over the recommended shape.

## 6. Outputs and limits

- **Auto-apply over a clean tree only.** Refuse to run otherwise. The clean-tree precondition is non-negotiable; without it, `git diff` can't reliably tell the user what the skill did.
- **Surgical edits.** Change only the lines named in the finding. Don't reformat surrounding paragraphs.
- **Never invent gaps.** If a doc's "Open gaps" item still applies because the code hasn't changed, leave it.
- **Don't commit.** The skill writes to the working tree only. The user commits.
- **Don't touch files outside the six.** Process docs under `Documentation/AgentForge/`, journal entries, code files — all out of scope. If you notice drift in those, mention it once at the end as an aside, not as a finding.
- **Re-runnable.** Each invocation is independent.
- **Bound the work.** Per invocation, expect 0–10 findings under typical drift. If your finding count exceeds ~15, the codebase has drifted enough that a manual review is warranted — abort and tell the user "drift exceeds skill scope; suggest manual review."

## 7. When NOT to use this skill

- **First-time creation** of any of the five content docs. The skill audits existing docs; it doesn't write them from scratch.
- **Bulk rewrites** driven by changed requirements (the brief itself shifted). Manual rewrite is faster and cleaner than running the skill on a structurally-wrong doc.
- **Code-only changes** with no doc-facing surface. Refactoring an internal helper that no doc cites is not a submission concern.
- **One-off citation fixes.** A direct edit is faster than running the full skill.
- **Dirty working tree.** The skill aborts; commit your in-progress changes first, then run the skill on the clean tree.
