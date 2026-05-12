---
date: 2026-05-11
topic: W2 eval gate verification against the brief + GitLab CI mirror so the gate runs on the grading remote
related_milestone: none
---

# W2 eval gate — brief audit + GitLab CI mirror — session journal

## Goal

Confirm the W2 eval suite actually meets the Week 2 brief's Stage 4 / Requirement 6 criteria before grading, including the five required boolean rubric categories, the 50-case minimum, and a PR-blocking CI gate that fails on regression. Quote: *"Confirm that everything listed below is accurate to what we've implemented, including the Boolean rubrics."*

## Context

Submission week wrapped 2026-05-03; this session is post-deadline verification ahead of grading. The brief's HARD GATE note states graders will introduce a small regression and confirm the CI gate fails — so the gate has to be both real and visible on the GitLab remote that graders actually check.

## Key decisions

### Decision: confirm 5 boolean rubric categories + counts against the brief

- **Prompt:** *"I just want to make sure that our evaluations are meeting the criteria in the Week 2 brief… including the Boolean rubrics."*
- **Recommendation:** Audit `agentforge/api/eval/runner.ts`, `baseline.json`, and `cases/curated/` directly. Confirmed all five required categories present (`schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`, `no_phi_in_logs`), 88 curated cases (vs 50 required), and that the gate is fully Boolean — the optional LLM judge in `eval/judge/` emits 0.0–1.0 scores but is supplementary, not the gate.
- **Outcome:** Verified pass. Per-category counts (12/12/12/43/9) match `baseline.json` exactly. Gate enforced at `W2_GATE_ABSOLUTE_FLOOR = 0.95` and `W2_GATE_REGRESSION_PP = 0.05` in [agentforge/api/eval/runner.ts:901](../../../../../agentforge/api/eval/runner.ts).

### Decision: flag GitLab CI gap honestly

- **Prompt:** *"On your last flag, we use GitLab, so I don't know if there's a way to check if we're using a pre-commit or pre-push hook through GitLab. I don't even know what that really is, honestly."*
- **Recommendation:** Explained that local git hooks don't actually gate PRs (developers can `--no-verify`); the real gate is server-side CI. We had `.github/workflows/agentforge-eval.yml` but no `.gitlab-ci.yml`, meaning the gate was invisible to graders looking at the GauntletAI GitLab repo even though it ran on GitHub.
- **Outcome:** Decision to add a GitLab CI mirror rather than try to invent a local hook scheme. The brief's "Git Hook or equivalent" wording covers the CI pipeline interpretation.

### Decision: GitLab CI mirrors the GitHub workflow node-for-node

- **Prompt:** *"Yes, go ahead and write what is needed then."*
- **Recommendation:** Mirror the GitHub Actions workflow exactly — same `npm run eval` invocation, same trigger paths, same `node:24` image (as `node:24-bookworm-slim`). Use GitLab CI's `rules: changes:` for the same path filter, and emit `eval/reports/` as a `when: on_failure` artifact. Identical gate semantics across both platforms.
- **Outcome:** [`.gitlab-ci.yml`](../../../../../.gitlab-ci.yml) committed as `eae31dcb` and pushed to both remotes.

### Decision: enable instance runners + "Pipelines must succeed" on GitLab project

- **Prompt:** *"I just turned on the instance runner. Now what?"* and earlier the stuck-pending screenshot.
- **Recommendation:** The first pipeline went `Pending / stuck` because the GauntletAI GitLab project had no runner attached. Enabling **Instance runners** in Settings → CI/CD → Runners attached a shared runner. Pre-existing pipelines that went stuck before a runner appeared need to be cancelled and re-run; new ones pick up automatically. Separately, **Settings → Merge requests → "Pipelines must succeed"** must be checked or the red pipeline is purely cosmetic.
- **Outcome:** Both settings enabled. Pipeline #4747 went green on retry. The gate is now live and enforcing on the GitLab remote.

### Decision: do not run a deliberate-regression smoke test this session

- **Prompt:** *"No, that's fine. I think I'm good."*
- **Recommendation:** Offered to flip one curated case's expected outcome on a throwaway branch to prove the gate goes red — useful as defensive evidence given the brief's HARD GATE note that graders will introduce a regression. User declined.
- **Outcome:** Not done. The gate semantics are verified by code review (5pp regression cap + 95% absolute floor in `runner.ts`, `caseFailures > 0 || breaches.length > 0` returns exit 1 at [agentforge/api/eval/runner.ts:1263](../../../../../agentforge/api/eval/runner.ts)) and by green-run evidence on both CI platforms; not by an end-to-end fail-the-gate demonstration. Noted as residual risk.

## Trade-offs and alternatives

- **Local `.git/hooks/pre-push` script** — rejected. Doesn't gate MRs, developers can bypass, doesn't survive `git clone`. CI is the actual answer.
- **GitLab CI via Auto DevOps template** — rejected. Auto DevOps assumes a single deployable monorepo and would have run unrelated jobs (build, test, deploy stages we don't have). A bespoke 55-line `.gitlab-ci.yml` runs exactly the one job we want.
- **Run the smoke-regression test now** — deferred. Would have produced a screenshot for the grading folder but takes ~10 min and the user opted to wrap.

## Tools, dependencies, commands

```bash
# Verified clock for journal filename (Central time)
TZ=America/Chicago date +"%m%d-T%H%M"
TZ=America/Chicago date +"%Y-%m-%d"

# Commit and push both remotes
git add .gitlab-ci.yml
git commit --trailer "Assisted-by: Claude Code" -m "ci(agentforge): add GitLab CI mirror of W2 eval gate"
git push origin master
git push gitlab master
```

GitLab UI changes (no command-line equivalent):
- Settings → CI/CD → Runners → **Instance runners ON**.
- Settings → Merge requests → **"Pipelines must succeed" ON**.

## Files touched

- **Created:** `.gitlab-ci.yml`
- **Created:** `Documentation/AgentForge/process/journal/week-2/0511-T1856-w2-eval-gate-gitlab-mirror.md` (this file)

## Outcomes

- W2 eval gate verified against the brief: 88 cases, 5 boolean rubric categories, 5pp regression cap + 95% absolute floor, deterministic Boolean gate (judge is supplementary only).
- The same gate now runs on both remotes: `.github/workflows/agentforge-eval.yml` and `.gitlab-ci.yml`, both invoking `npm run eval` identically.
- GitLab project is now configured to actually block MRs on red pipelines (instance runners + "Pipelines must succeed" enabled).
- Pipeline #4747 ran green on the GauntletAI GitLab remote.

## Next steps

- [ ] (Optional, low priority) Run a deliberate-regression smoke test on a throwaway branch and capture a screenshot of the red GitLab pipeline as defensive evidence for the HARD GATE clause.
- [ ] If a grader's regression injection misses the gate, debug by reading the per-category aggregate in the JSON report under `agentforge/api/eval/reports/` (uploaded as a GitLab artifact on failure).

## Links

- Brief reference: [Documentation/AgentForge/references/Week-2_AgentForge-Clinical-Co-Pilot.pdf](../../../references/Week-2_AgentForge-Clinical-Co-Pilot.pdf) — Stage 4 + Requirement 6.
- Eval runner gate logic: [agentforge/api/eval/runner.ts:901-902, 1263](../../../../../agentforge/api/eval/runner.ts)
- Pinned baseline: [agentforge/api/eval/baseline.json](../../../../../agentforge/api/eval/baseline.json)
- Mirror workflow: [.github/workflows/agentforge-eval.yml](../../../../../.github/workflows/agentforge-eval.yml) and [.gitlab-ci.yml](../../../../../.gitlab-ci.yml)
