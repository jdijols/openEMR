---
date: 2026-05-11
topic: W2 submission hardening (eval-status fix, schema-regression catch, critic defense, cost-evidence fill) + prod redeploy
related_milestone: process/milestones/week-2/09-w2-submission-closeout-and-instructor-feedback.md
---

# W2 submission hardening + prod redeploy — session journal

## Goal

Multi-pass audit and close-out of every W2-submission gap identified after the
prior submission cycle's review feedback, then push the resulting hardening
live so the grader sees current state. Session opened with: *"Review the code
base and please validate that I have satisfied the requirements brought up by
my gauntlet instructor's feedback from my last submission"* and closed by
redeploying to prod with HEAD `0f5634014` and confirming `/health/eval-status`
serves the W2 88-case judge-populated report end-to-end.

## Context

Prior cycle's instructor feedback flagged: (a) no committed W2 eval run
visible to graders, (b) live `/health/eval-status` serving an April 2-case
W1 stub, (c) no judge-scored evaluations committed for `factually_consistent`
+ `safe_refusal` (the brief's named LLM-judge categories), (d) README pointing
to a non-existent `ARCHITECTURE.md`, (e) `[op:fill]` placeholders in the W2
cost/latency report. Also at risk by code inspection but unproven on video:
bbox overlay click-to-source, FHIR persistence live round-trip, and whether
the CI gate actually blocks regressions on the 88-case W2 suite.

W2 final deadline was Sunday 2026-05-10 noon CT; this session ran 5/11
afternoon (post-deadline) as a close-out + instructor-feedback hardening pass.

## Key decisions

### Decision: Audit-first, write-after — three-pass loop over the feedback list

- **Prompt:** "Review the code base and please validate that I have satisfied the requirements ... Bubble up any gaps that I didn't address."
- **Recommendation:** Structured audit checking each instructor-named gap against current repo + live VPS + committed reports, rather than trusting prior commits' messages. First pass identified five remaining gaps (live stale endpoint, latest report empty `judge_results`, 11 dead `ARCHITECTURE.md` links in adjacent docs, cost-report placeholders, critic-agent misframing); subsequent passes after parallel-agent commits narrowed the list down to deploy + redeploy.
- **Outcome:** Five hardening commits across the session: `10c2ca973`, `46eebf038`, `449a96c3c`, `9c9e2c0c7`, plus the journal commit pair landing this session's writeup.

### Decision: eval_status.ts mtime sort → run-id timestamp sort

- **Prompt:** "the BPS deploy should be done. ... I'm most concerned with the evaluation criteria and making sure that my 88 cases are passing the requirements and, most specifically, blocking the regression test that they will do."
- **Recommendation:** Diagnosed why the live endpoint kept returning the April W1 stub even after the W2 88-case report appeared committed: `loadEvalStatus` sorted by `mtimeMs` with strict `>`, and after a fresh `git checkout` all committed reports share the checkout instant — alphabetically-first wins on ties, which is always the April `eval-20260430...` file. Fix: sort by the run-id timestamp embedded in the filename (`eval-YYYYMMDDTHHMMSSmmmZ_<uuid>.json` → lexical sort = chronological sort). Deterministic, deploy-independent. Defense-in-depth on top of also removing the W1-era reports from git.
- **Outcome:** [agentforge/api/src/observability/eval_status.ts:85-100](../../../../agentforge/api/src/observability/eval_status.ts) with the comment block documenting the failure mode; test fixture updated to use realistic timestamped filenames with mtime ordered the opposite direction to prove the sort uses the name, not mtime. 6/6 unit tests green.

### Decision: Discovery — reports/ is gitignored; force-add the canonical W2 evidence and remove W1 stubs

- **Prompt:** *(no single prompt — surfaced mid-session when `git add reports/eval-20260510T193243101Z_88744fe6.json` failed)*
- **Recommendation:** `agentforge/api/eval/.gitignore` excludes `reports/`; the May reports I'd been treating as "committed" were all local-only. Four W1-era reports (April 30, May 1 ×3) were the only ones actually tracked in git — which is exactly what the live VPS kept returning. Strategy: keep `reports/` gitignored (dev runs don't pollute git), but use `git add -f` for one canonical W2 evidence report at submission milestones, with a comment block in the .gitignore documenting the pattern. Remove the 4 stale W1 reports from git in the same commit.
- **Outcome:** [agentforge/api/eval/.gitignore](../../../../agentforge/api/eval/.gitignore) updated. W1 reports removed via `git rm`. Canonical W2 report `eval-20260511T214233553Z_e692f671.json` (88 cases, 0 failures, baseline `w2-consolidated-2026-05-07`, 4 judge evaluations) force-added.

### Decision: Schema regression caught in real-time; fix fixtures, not floor

- **Prompt:** *(eval gate fired during the post-edit `npm run eval` sanity check)*
- **Recommendation:** Adding `problem_list` as required to `IntakeFormSchema` in commit `311ac9ef5` had broken two pass-case fixtures (`w2-schema-valid-intake-all-arrays-empty-pass.json`, `w2-schema-valid-intake-form-pass.json`); `schema_valid` dropped to 10/12 (83.3% < 95% floor) → gate `BLOCKED`. Fix path: update the fixtures to carry `problem_list: []` rather than lower the floor or soften the schema. This is a second in-tree proof the gate works on the same suite the instructor will probe (May 7 CI failure was the first).
- **Outcome:** Both fixtures updated with empty `problem_list` array; eval gate cleared (88/88, 0 failures). Documented in the commit message as the regression-blocking demonstration.

### Decision: Critic-agent positioning — acknowledge brief Core, defend verification-gate fulfillment

- **Prompt:** "the critic agent is still optional" *(later clarification after the audit flagged W2_ARCHITECTURE.md misframing it as "listed as extension, not core")*
- **Recommendation:** Whether instructor calls it optional or Core, the W2_ARCHITECTURE.md previously contradicted the brief's printed text and risked grader confusion. Rewrote §1 non-goals and §15 narrowing to: brief lists "Critic agent that rejects uncited claims or unsafe action suggestions" under Core, and we fulfill it deterministically via the verification gate (citation enforcement strips uncited claims; constraint-boundary rule rejects advisory phrasing). Reasoning for deterministic-over-LLM-critic: auditability + zero added latency + no second hallucination surface. README's "Week 2 submission" section added a `VERIFICATION.md` bullet pointing at the defense.
- **Outcome:** [W2_ARCHITECTURE.md §1, §15](../../../../W2_ARCHITECTURE.md), [README.md "Week 2 submission" block](../../../../README.md), [VERIFICATION.md](../../../../VERIFICATION.md) cross-link. Defense visible in three places along the grader's expected reading path.

### Decision: Cost report — fill measured numbers, mark Langfuse drill-down as post-submission

- **Prompt:** "I've attached the screenshots from Claude, Langfuse, and Cohere to add to our documents."
- **Recommendation:** Replace `[op:fill]` placeholders with transcribed numbers from the three console screenshots (Anthropic $18.14 MTD, Cohere $0.09 / 47 reranks, Langfuse 79 traces / $0.52 past-1d), with explicit per-model attribution so the grader sees Haiku 4.5 ≈ production runtime (~$3-5), Sonnet 4.6 = LLM-judge per-release (~$0.30), Opus 4.7 = build-phase Claude Code assistance (does not recur in production). §4.2/§4.3 per-span p50/p95 stay as operator-pull (Langfuse Metrics drill-down) with a banner at the top of the report telling the grader exactly which sections are filled vs which require live console drill-down.
- **Outcome:** [Documentation/AgentForge/implementation/w2-cost-latency-report.md §1, §2](../../../implementation/w2-cost-latency-report.md). Screenshots embedded under [Documentation/AgentForge/assets/W2-cost-evidence/](../../../assets/W2-cost-evidence/). Caught and fixed a related rename: `LangFuse.png` → `W1-LangFuse.png` referenced in [OBSERVABILITY.md:138](../../../../OBSERVABILITY.md) + [Submission-Checklist.md:325](../../../implementation/Submission-Checklist.md) (would have broken the W1 Langfuse image embed).

### Decision: VPS redeploy via prior-journal Caddy entry point, not localhost:3000

- **Prompt:** "My intuition is telling me that you're trying to do something different that's not aligned with our previous deployments."
- **Recommendation:** Initial smoke test attempted `curl localhost:3000/health/eval-status` which returned empty because `agentforge-api` has no host-published ports per the prod compose (Caddy is the only public entry). Prior deploy journals (0506-T1650, 0508-T0111) consistently use `curl -fsS https://108-61-145-220.nip.io/health` via Caddy. Followed the established pattern; smoke succeeded against the public URL.
- **Outcome:** Live `https://108-61-145-220.nip.io/health/eval-status` returns the W2 canonical report (88 cases, 5 categories at 1.0, baseline `w2-consolidated-2026-05-07`); basic `/health` returns `ok: true` with all four deps green. VPS HEAD: `0f5634014`.

## Trade-offs and alternatives

- **Whitelist `eval-pinned.json` via .gitignore exception (vs `git add -f` per milestone)** — Considered. Rejected because timestamped filenames already give us chronological sort; requiring a fixed name would force a rename or symlink on every fresh evidence snapshot. The `git add -f` pattern is one-character cost per submission cycle and keeps the audit trail honest.
- **Lower the eval-gate floor below 95%** — Considered when schema regression breached `schema_valid`. Rejected. Floor is the contract; fixtures are the variable. Fixing the fixtures preserves the gate's actual regression-blocking strength.
- **Embed screenshots inline as base64** — Considered for the cost report. Rejected for binary size + diff-noise reasons; saved PNGs to a dedicated `assets/W2-cost-evidence/` directory and linked from a source-evidence table.

## Tools, dependencies, commands

- `EVAL_RUN_JUDGE=1 npm run eval` (from `agentforge/api/`) — opt-in judge invocation, dotenv-loaded API key from `docker/agentforge/secrets.dev.env`.
- `git add -f agentforge/api/eval/reports/eval-20260511T214233553Z_e692f671.json` — canonical evidence force-add under the existing `reports/` gitignore.
- VPS deploy sequence (5/11 evening): `ssh root@108.61.145.220` → `cd /opt/openemr` → `git fetch origin` → `git reset --hard origin/master` → `docker compose -p development-easy restart agentforge-api` → `curl -fsS https://108-61-145-220.nip.io/health/eval-status | python3 -m json.tool`. No `up -d --build` needed because the only substantive change was TypeScript source read via the bind mount; `restart` re-runs the compose `command` (`npm ci && npm run build && node dist/index.js`) which picks up the new `eval_status.ts`.

## Files touched

- **Created:** `agentforge/api/eval/reports/eval-20260511T214233553Z_e692f671.json` (canonical W2 evidence, force-added)
- **Created:** `Documentation/AgentForge/assets/W2-cost-evidence/Claude.png`, `Cohere.png`, `Langfuse.png`
- **Modified:** `agentforge/api/src/observability/eval_status.ts` (sort by run-id timestamp)
- **Modified:** `agentforge/api/test/observability/eval_status.test.ts` (test fixture realism)
- **Modified:** `agentforge/api/eval/.gitignore` (canonical-evidence pattern documented)
- **Modified:** `agentforge/api/eval/cases/curated/w2-schema-valid-intake-all-arrays-empty-pass.json`, `w2-schema-valid-intake-form-pass.json` (problem_list field)
- **Modified:** `W2_ARCHITECTURE.md` (§1 non-goals, §15 narrowing — critic-agent defense)
- **Modified:** `README.md` (VERIFICATION.md row, cost-report row, Loom video alongside live demo)
- **Modified:** `AUDIT.md`, `OBSERVABILITY.md`, `COSTS.md`, `JOURNEY.md`, `USERS.md`, `Documentation/AgentForge/README.md` (11 bare `ARCHITECTURE.md` links repointed to `W1_ARCHITECTURE.md`)
- **Modified:** `OBSERVABILITY.md`, `Documentation/AgentForge/implementation/Submission-Checklist.md` (W1 Langfuse PNG rename)
- **Modified:** `Documentation/AgentForge/implementation/w2-cost-latency-report.md` (§1 + §2 filled from measured console screenshots; banner clarifying what's filled vs operator-pull)
- **Modified:** `Documentation/AgentForge/assets/W1-LangFuse.png` (renamed from `LangFuse.png` — handled by parallel chat; references updated here)
- **Deleted:** `agentforge/api/eval/reports/eval-20260430T225137000Z_13cf8189.json`, `eval-20260501T190104436Z_46a9d985.json`, `eval-20260501T192026258Z_e682c61c.json`, `eval-20260501T203818906Z_27edddc1.json` (4 W1-era stubs that were the failure mode the live endpoint kept serving)

## Outcomes

- Live `/health/eval-status` serves the W2 88-case judge-populated report at runtime — the exact gap the instructor flagged is closed at the source on prod (`0f5634014`).
- Eval gate has **two distinct in-tree proofs of regression-blocking**: May 7 CI (5 schema failures → BLOCKED) and this session's `problem_list` catch (2 schema failures → BLOCKED → fixed). Stronger evidence than one synthetic injection.
- Cost/latency report carries measured numbers from all three source dashboards plus per-model attribution that disentangles the agent-runtime cost from the LLM-judge cost from the Claude Code build-phase assistance.
- Critic-agent design choice is documented in three places along the grader's expected reading path.
- VPS prod HEAD = master HEAD; both `gitlab` and `origin` remotes synced.

## Next steps

- [ ] Optional, post-grading: Langfuse Cloud → Metrics → group by span name to fill `w2-cost-latency-report.md` §4.2/§4.3 per-span p50/p95.
- [ ] Optional, post-grading: fix the pre-existing `social_history.php` 500s visible in agentforge-api logs (`openemr_invalid_json` on `/context/social_history.php`); pre-dates this session, doesn't break the demo but adds log noise.
- [ ] Week 3 brief acknowledged via the [W3 architecture defense](../../../../W3_Architecture-Defense.md) (committed `0f5634014`); Week 3 milestone trail already opened under `process/milestones/week-3/`.

## Links

- Numbered milestone: [process/milestones/week-2/09-w2-submission-closeout-and-instructor-feedback.md](../../milestones/week-2/09-w2-submission-closeout-and-instructor-feedback.md)
- Prior milestone: [process/milestones/week-2/08-affordance-queue-bundle-and-qa-pass.md](../../milestones/week-2/08-affordance-queue-bundle-and-qa-pass.md)
- Bridge to Week 3: [process/milestones/week-3/01-prod-deploy-and-cohort-reset.md](../../milestones/week-3/01-prod-deploy-and-cohort-reset.md)
- W2 brief deliverable mapping: [W2_ARCHITECTURE.md](../../../../W2_ARCHITECTURE.md), [EVALUATION.md](../../../../EVALUATION.md), [OBSERVABILITY.md](../../../../OBSERVABILITY.md), [w2-cost-latency-report.md](../../../implementation/w2-cost-latency-report.md)
