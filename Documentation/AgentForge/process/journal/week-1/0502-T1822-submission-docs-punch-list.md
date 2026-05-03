---
date: 2026-05-02
topic: VERIFICATION/EVALUATION/OBSERVABILITY submission docs + 15-item punch-list closure + sync skill
related_milestone: none (submission-doc deliverables; not a numbered process milestone)
---

# Submission docs + punch list — session journal

## Goal

Make sure the brief's three substantive requirements (Verification System, Observability, Evaluation) are demonstrably satisfied for the Sunday-noon submission. The user opened with: *"I want to make sure that we're satisfying every requirement… maybe we ought to have a [verification.md](http://verification.md), an [observability.md](http://observability.md), and an [evaluation.md](http://evaluation.md) that the Gauntlet instructors will be able to read."* Two things had to happen: write the docs honestly (with anchors and known limitations), then close the code-side gaps the docs surfaced.

## Context

Gate 6 had already closed (eval suite + Langfuse-live in prod) before this session. AUDIT.md / USERS.md / ARCHITECTURE.md were existing instructor deliverables; the brief's three pillars had no dedicated docs. Sunday-noon deadline ~24 hours out at session start. Existing pattern in `.agents/skills/` is symlinks-from-`.claude/skills/` for cross-tool agent compatibility (Claude Code + Cursor + others).

## Key decisions

### Decision: audit code first, then write docs from anchors

- **Prompt:** *"this part... is where I think we currently have a gap. Let's plan out how we're going to ensure that everything is meeting the requirements."*
- **Recommendation:** Don't write prose first. Run a fast code audit against each brief bullet, get a punch list of actually-missing vs. already-built, then write the docs as you fill the gaps — that way the docs are honest by construction and don't paper over real holes.
- **Outcome:** Audit produced a clean punch list (mostly documentation-shaped gaps; almost everything was already built through Gate 6). Three docs shipped at repo root in narrative form anchored to specific `path:line` citations, each with an explicit *"What this layer does NOT catch"* section the brief asks for. First commit: `2b99defb7`.

### Decision: skill mode = auto-apply with clean-tree precondition (reversal)

- **Prompt:** *"this skill should automatically just update the necessary files. That's the big difference here."*
- **Recommendation:** User reversed earlier propose-then-confirm choice. Pushed back briefly: pure auto-apply on hand-crafted narrative prose is risky if the audit misclassifies. Suggested adding a clean-tree precondition (skill refuses to run if any in-scope file has uncommitted changes) plus an end-of-run summary with `⚠ prose change` markers on `GAP RESOLVED` / `NEW GAP` edits. User accepted.
- **Outcome:** [.agents/skills/update-submission-files/SKILL.md](../../../.agents/skills/update-submission-files/SKILL.md) runs in auto-apply mode with `git diff HEAD` as the safety net. AUDIT.md and PRD.md excluded from scope (Stage-3 locked content / spec upstream of code). Symlinked into `.claude/skills/` matching the existing project pattern; `.claude/` is gitignored so the symlinks are local-only — canonical files live in `.agents/skills/`.

### Decision: external evidence citation = V2, not V1

- **Prompt:** *"is this something that would be included in the verification layer as described in the project brief PDF and as required by our submission checklist?"*
- **Recommendation:** No. The brief is consistent that "source attribution" means *patient's file*, not external literature. What the user described (citing PubMed / NEJM / OpenEvidence for general medical-knowledge questions) is *evidence-based citation* — a complementary safety layer, not the brief's verification. Architecturally clean V2 extension though: the citation enforcement layer already operates on UUIDs from any tool source; adding a `lookup_clinical_evidence` tool would extend the same logic without redesign.
- **Outcome:** Added §7 *"External evidence grounding"* to VERIFICATION.md known-limitations (closes the brief's explicit ask for limitations). Created [Documentation/AgentForge/implementation/v2-roadmap.md](../../implementation/v2-roadmap.md) with evidence-based citation as Theme 1 lead candidate. Avoided adding the implementation < 24 hours from submission.

### Decision: paraphrase coverage lives at vitest layer, not eval JSON fixtures

- **Prompt:** original punch-list item suggested adding `neg-claim-allergies-paraphrase-*.json` fixtures under `eval/cases/curated/` to cover the documented regex limitation.
- **Recommendation:** That's the architecturally wrong layer. The eval runner's `negative_claim_requires_empty_query` check operates on synthesized booleans (`negative_claim: true`, `backed_by_empty_query: true`), not on prose, so paraphrase JSON fixtures wouldn't actually exercise the regex. The right location is a vitest end-to-end test through `verifyClinicalBlocks` that asserts both what the regex catches AND what it intentionally misses.
- **Outcome:** [agentforge/api/test/agent/verification-negative-coverage.test.ts](../../../../agentforge/api/test/agent/verification-negative-coverage.test.ts) — 24 cases. EVALUATION.md "Open gaps" section explains the architectural reframing explicitly so an instructor reading the doc understands why this didn't ship as an eval fixture.

### Decision: two commits, push deferred

- **Recommendation:** Splitting submission docs (commit 1) from punch-list closures (commit 2) keeps each unit cohesive for review and rollback. Pre-existing parallel work (clinical-note write surfaces, system_prompt edits, etc.) was excluded from both commits via explicit `git add` paths.
- **Outcome:** `2b99defb7 docs(agentforge): add VERIFICATION/EVALUATION/OBSERVABILITY + skill` (4 files, 927 inserts). `885e15e28 docs(agentforge): close VERIFICATION/EVALUATION/OBSERVABILITY punch list` (17 files, 1212 inserts, 24 deletes). Push to `gitlab` (Gauntlet remote) vs. `origin` (personal GitHub fork) deferred to user — flagged that the new GitHub Actions workflow won't trigger on `gitlab` since GitLab uses `.gitlab-ci.yml`.

## Trade-offs and alternatives

- **Per-model cost lookup vs. per-provider heuristic** — left at per-provider (Anthropic = Haiku 4.5 rates) with comment that operator model-rotation invalidates the heuristic; per-model lookup is on V2 Theme 5. Langfuse Cloud is the authoritative cost source regardless.
- **AUDIT.md auto-sync vs. exclusion from skill scope** — excluded. AUDIT.md is Stage-3 locked content (pre-code constraints, dated 2026-04-28); it doesn't drift with code, only with new audit findings, which deserves a separate audit pass.
- **Copy vs. symlink for `.claude/skills/`** — symlinks (matched user's existing pattern). Single source of truth in `.agents/skills/`, no drift.
- **Mirror eval CI to `.gitlab-ci.yml`** — deferred. `.github/workflows/agentforge-eval.yml` matches the upstream js-test.yml convention; GitLab mirror is a small follow-up if Gauntlet enforcement matters.

## Tools, dependencies, commands

- `npm run eval` (3ms typical, 5s perf budget; emits `eval_perf_warning` if exceeded)
- `npx vitest run <path>` for the new test files
- `git mv` doesn't work on case-only renames on macOS APFS — used two-step plain `mv`: `verification.md → verification_tmp.md → VERIFICATION.md`

## Files touched

**Created:**
- `VERIFICATION.md`
- `EVALUATION.md`
- `OBSERVABILITY.md`
- `.agents/skills/update-submission-files/SKILL.md`
- `Documentation/AgentForge/implementation/v2-roadmap.md`
- `Documentation/AgentForge/runbooks/observability-debug.md`
- `agentforge/api/eval/README.md`
- `agentforge/api/eval/.gitignore`
- `agentforge/api/test/agent/verification-negative-coverage.test.ts`
- `agentforge/api/test/observability/redact.coverage.test.ts`
- `.github/workflows/agentforge-eval.yml`
- `.claude/skills/agentforge-process-doc` (symlink, local-only — `.claude/` is gitignored)
- `.claude/skills/update-submission-files` (symlink, local-only)

**Modified:**
- `agentforge/api/eval/runner.ts` (per-check schema validator + 5s perf budget)
- `agentforge/api/src/agent/cost_estimate.ts` (Anthropic rate `$3/$15 → $1/$5`)
- `agentforge/api/src/agent/orchestrator.ts` (inline signpost above the verification call)
- `agentforge/api/src/agent/verification.ts` (top-of-file docblock + LIMITATION on `verifyClinicalBlocks`)
- `agentforge/api/src/app.ts` (`probeLangfuse` + wired into `/health`)
- `agentforge/api/src/observability/index.ts` (top-of-file docblock)
- `agentforge/api/test/http/health-and-correlation.test.ts` (4 new Langfuse probe tests)

**Deleted:** _None this session._

## Outcomes

The submission package now has all six instructor-facing docs at repo root (AUDIT, USERS, ARCHITECTURE, VERIFICATION, EVALUATION, OBSERVABILITY) plus a README — three of those are new and each opens with a 30-second summary, anchors to specific code lines, and explicitly enumerates known limitations. The 15-item punch list from the initial audit is closed: 73 new test cases across two coverage matrices, a CI workflow, an eval reference README, a debug runbook, and three module-level docblocks make the safety story regression-tested rather than just narratively asserted. A reusable skill exists for keeping the submission docs in sync with future code changes (auto-apply over a clean tree, prose-change markers in the summary).

## Next steps

- [ ] Push to `gitlab` (Gauntlet remote) and possibly `origin` per user's call.
- [ ] Optional: mirror `.github/workflows/agentforge-eval.yml` to `.gitlab-ci.yml` if Gauntlet enforcement matters before submission.
- [ ] Continue submission preparation per [Submission-Checklist.md](../../implementation/Submission-Checklist.md) — Loom, social post, `submission.md` URL bundle.
- [ ] Run the `update-submission-files` skill once against a real code change (e.g., the parallel clinical-note write work) to verify the auto-apply flow in practice.

## Links

- Commit `2b99defb7` — VERIFICATION + EVALUATION + OBSERVABILITY docs at repo root + update-submission-files skill.
- Commit `885e15e28` — 15-item punch list closure: schema validation, perf budget, eval README, CI workflow, redactor coverage matrix, Langfuse `/health` probe, observability runbook, V2 roadmap.
- Related milestones: [process/15-gate6-complete.md](../../15-gate6-complete.md) (Gate 6 close — eval + observability infrastructure), [process/18-langfuse-observability-cost-analysis.md](../../18-langfuse-observability-cost-analysis.md) (Langfuse-live in prod).
- Submission-side: [Submission-Checklist.md](../../implementation/Submission-Checklist.md), [v2-roadmap.md](../../implementation/v2-roadmap.md).
