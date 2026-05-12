# 09 — W2 submission close-out and instructor-feedback hardening

The last Week 2 milestone. Covers the work between [milestone 08](08-affordance-queue-bundle-and-qa-pass.md) (5/10 morning — affordance queue + QA pass) and the final state shipped to prod at HEAD `0f5634014` on 5/11 evening CT. Spans the closing W2-build commits, the W2 submission itself, the post-deadline instructor-feedback review, three rounds of hardening (eval-status determinism, cost-evidence fill, critic-agent positioning), and the final VPS redeploy that put the W2 88-case judge-populated eval report live where the grader will land.

This milestone bridges directly into [Week 3 milestone 01](../week-3/01-prod-deploy-and-cohort-reset.md) (the marathon prod deploy + cohort reset that ran 5/10 evening → 5/11 early morning CT and pinned prod at `1556a7fcf` before this milestone's work shipped it forward to `0f5634014`).

## Purpose

Where 08 ended (5/10 morning):
- Affordance + queue iteration phases 1–4 landed; unified Confirm/Reject vocabulary; bundle proposals with server-side fan-out.
- QA-pass hardening: Sonnet 4.6 as the synthesis model; demographic/allergy/family-history payload normalization; lab cross-check refusal removed for demo trust; custom PHP endpoint reading JSON-sidecar lab observations.
- Pending: W2 final-day commits, prod deploy, instructor-feedback closure, prod redeploy after hardening.

What this milestone covers:
- **Citation contract end-to-end + bbox overlay landing** — final-day W2 build commit fixing three layered bugs that surfaced during demo dress-rehearsal (ADODB stdout corruption, upstream OpenEMR SQL bugs, sidecar-store reads). Bbox overlay yellow-highlight wired into the host-shell PDF viewer.
- **Langfuse finalizer + cost-fix pass** — final-day observability polish, captured in journal.
- **W2 prod deploy of 12 commits since 5/8 + post-deploy bug triage + cohort reset** — already documented in [Week 3 milestone 01](../week-3/01-prod-deploy-and-cohort-reset.md); referenced here because it sits in the middle of the W2 close-out sequence (Wk2-deadline commits → deploy → post-deploy fixes → W2 submission → instructor feedback → hardening → redeploy). Prod tip at `1556a7fcf` after that session.
- **GitLab CI mirror of the W2 eval gate** — single-commit addition mirroring the GitHub Actions workflow to the GitLab CI runner, captured in journal.
- **W2 submission hardening (this milestone's headline work)** — five hardening commits closing each instructor-feedback gap from the prior submission cycle:
  - `eval_status.ts` mtime-tie bug → sort by run-id timestamp embedded in the filename.
  - Stale W1-era eval reports removed from git; `agentforge/api/eval/.gitignore` updated with the canonical-evidence `git add -f` pattern.
  - Canonical W2 evidence report (`eval-20260511T214233553Z_e692f671.json` — 88 cases, 0 failures, 4 judge-scored evaluations) force-added so it's tracked.
  - 11 bare `ARCHITECTURE.md` links across AUDIT/OBSERVABILITY/COSTS/JOURNEY/USERS/Documentation-README repointed to `W1_ARCHITECTURE.md`.
  - Critic-agent positioning corrected in W2_ARCHITECTURE.md (brief Core, fulfilled by deterministic verification gate); README cross-link added to VERIFICATION.md.
  - Cost/latency report §1 + §2 filled from measured Anthropic/Cohere/Langfuse console screenshots; per-model attribution disentangling production-runtime cost from LLM-judge cost from Claude Code build-phase assistance.
  - W2 cost-evidence screenshots archived under `Documentation/AgentForge/assets/W2-cost-evidence/`; W1 Langfuse PNG rename surfaces and broken references fixed.
- **Demo Loom video link wired into README** — 3–5 minute walkthrough alongside the live demo URL at the top of README.
- **Schema regression caught and fixed in real-time** — adding `problem_list` as required to `IntakeFormSchema` (commit `311ac9ef5`) broke two pass-fixtures; gate fired, fixtures fixed, gate cleared. Live demonstration of the regression-blocking the brief asks graders to verify.
- **Prod redeploy to `0f5634014`** — VPS brought forward from `1556a7fcf` → `0f5634014` (10 commits, mostly the hardening + docs). Minimal `restart agentforge-api` was sufficient because the only substantive change was TypeScript source on the bind-mounted volume.

## The prior-art chain (sessions feeding into this milestone)

| Session | Journal | Topic |
|---|---|---|
| Citation contract + bbox overlay (W2 final-day fixes) | [0510-T1115](../../journal/week-2/0510-T1115-citation-bbox-and-adodb-output.md) | ADODB stdout claim, FHIR query try/catch, bbox overlay, finalizer cost-fix folded in |
| Langfuse finalizer cost fix | [0510-T1121](../../journal/week-2/0510-T1121-langfuse-finalizer-cost-fix.md) | Final-day Langfuse polish |
| W2 prod deploy + post-deploy bug triage + cohort reset | [0510-T1300](../../journal/week-2/0510-T1300-deploy-bug-triage-cohort-reset.md) → Week-3 [0511-T1257](../../journal/week-3/0511-T1257-prod-deploy-and-cohort-reset.md) | 12-commit deploy, five post-deploy bugs, problem_list write target, encounter-bind fallback, cohort reset workflow. Promoted to [Week 3 milestone 01](../week-3/01-prod-deploy-and-cohort-reset.md). |
| GitLab CI mirror | [0511-T1856](../../journal/week-2/0511-T1856-w2-eval-gate-gitlab-mirror.md) | `.gitlab-ci.yml` parity with the GitHub Actions W2 eval gate |
| W2 submission hardening + prod redeploy (this milestone's headline session) | [0511-T1930](../../journal/week-2/0511-T1930-w2-submission-hardening-and-prod-redeploy.md) | eval-status mtime fix, schema-regression catch, critic defense, cost-evidence fill, prod redeploy to `0f5634014` |

## Decisions

### eval_status endpoint determinism

`loadEvalStatus` previously sorted reports by `mtimeMs` with strict-`>` comparison. After a fresh `git checkout` on the VPS, all committed reports share the checkout instant — alphabetical ties (visited via `readdirSync`) make the April-30 W1 stub always win. Switched to sort by the run-id timestamp embedded in the filename (`eval-YYYYMMDDTHHMMSSmmmZ_<uuid>.json` → lexical = chronological). Deploy-deterministic, no longer dependent on filesystem mtime semantics.

### Reports directory stays gitignored; one canonical evidence file per submission cycle

The `reports/` directory remains gitignored to keep per-dev-run JSON noise out of git. A single "canonical evidence" snapshot is force-added at submission milestones via `git add -f`. Stale W1-era reports that pre-dated the W2 baseline were removed from git in the same pass (they were the failure mode the live endpoint kept landing on). [`.gitignore`](../../../../agentforge/api/eval/.gitignore) carries a comment block documenting the pattern.

### Critic agent → deterministic verification gate (brief-Core fulfillment)

W2_ARCHITECTURE.md previously framed the brief's Core "Critic agent that rejects uncited claims or unsafe action suggestions" as "extension, not core" — a misread of the brief's printed structure. Rewrote §1 non-goals + §15 narrowing to acknowledge the brief's Core listing and document the verification-gate fulfillment (citation enforcement + constraint-boundary describes-vs-recommends rule). Chose deterministic over LLM-critic for auditability + zero-added-latency + no second hallucination surface. Visible in three reading-path locations: README W2-submission block, W2_ARCHITECTURE.md §1 and §15, and VERIFICATION.md.

### Cost report — measured numbers, per-model attribution

Replaced `[op:fill]` placeholders in [w2-cost-latency-report.md §1 + §2](../../../implementation/w2-cost-latency-report.md) with transcribed console-screenshot data. Critical addition: per-model attribution disentangling **Haiku 4.5** (production-equivalent agent runtime, ~$3–5 of the W2 total — the cost surface that scales with end-user traffic), **Sonnet 4.6** (LLM-judge per-release cost), and **Opus 4.7** (build-phase Claude Code developer assistance that does not recur in production). All three share the same `openEMR` API key, which without attribution would look like inflated runtime cost.

§4.2/§4.3 per-span p50/p95 deliberately left as operator-pull because they require Langfuse Cloud → Metrics drill-down per span name; a banner at the top of the report tells the grader exactly which sections are filled vs which are post-submission console rolls.

### Real-time regression catch as evidence of gate strength

Schema regression introduced by `problem_list` being added as required to `IntakeFormSchema` was caught when running `npm run eval` after edits — `schema_valid` dropped to 10/12 (83.3% < 95% floor) → gate `BLOCKED`. Fix path: update the two pass-fixtures to carry empty `problem_list: []` rather than lower the floor. Result: the in-tree git history now carries **two distinct proofs of regression-blocking** — the May 7 CI failure (5 schema failures → BLOCKED) and this session's `problem_list` catch. The grader's "introduce a regression and watch the gate fail" test is pre-demonstrated twice.

### VPS redeploy alignment with prior journal pattern

Initial smoke test attempted `curl localhost:3000/health/eval-status` which returned empty because `agentforge-api` has no host-published ports per the prod compose (Caddy is the only public entry). Prior deploy journals ([0506-T1650](../../journal/week-2/0506-T1650-w2-prod-deploy-and-cui-fix.md), [0508-T0111](../../journal/week-2/0508-T0111-https-retrofit-vps-deploy.md)) consistently use `curl -fsS https://108-61-145-220.nip.io/health` via Caddy. Realigned to the established pattern; smoke succeeded against the public URL.

## Brief deliverable status at milestone close

| Brief deliverable | Status |
|---|---|
| GitLab Repository | ✅ HEAD `0f5634014` synced to gitlab/master |
| W2 Architecture Doc | ✅ [W2_ARCHITECTURE.md](../../../../W2_ARCHITECTURE.md) covers ingestion + worker graph + RAG + eval gate + risks + tradeoffs (§3–§15) |
| Schemas (Zod for lab_pdf + intake_form) | ✅ [extraction.ts](../../../../agentforge/api/src/schemas/extraction.ts) + [extraction.test.ts](../../../../agentforge/api/test/schemas/extraction.test.ts) |
| Eval Dataset (50 cases, boolean rubrics, judge config, results) | ✅ 88 cases, 5 W2 rubric categories, judge prompt + model committed at [eval/judge/](../../../../agentforge/api/eval/judge/), canonical evidence report `eval-20260511T214233553Z_e692f671.json` with 4 judge evaluations |
| CI Evidence (Git Hook, blocks regressions) | ✅✅ pre-push hook + GitHub Actions + GitLab CI mirror; two distinct regression-blocks in tree (May 7 CI + `problem_list` schema catch) |
| Demo Video (3–5 min) | ✅ Loom linked from [README](../../../../README.md) line 6 |
| Cost and Latency Report | ✅ §1 + §2 measured-data filled; §4.2/§4.3 per-span p50/p95 post-submission pull |
| Deployed Application | ✅ `https://108-61-145-220.nip.io/health/eval-status` returns the W2 88-case judge report at HEAD `0f5634014` |
| Observability (#7 — tool sequence, latency by step, token usage, cost, retrieval hits, extraction confidence, eval outcome, no raw PHI) | ✅ all seven fields wired + PHI redactor + W2 content-block summarizer (see [OBSERVABILITY.md](../../../../OBSERVABILITY.md) §"W2 additions") |
| Hard gate (regression-blocking CI) | ✅✅ two in-tree proofs |
| Critic agent (Core) | ✅ deterministic verification gate fulfills the contract; defense in [W2_ARCHITECTURE.md §15](../../../../W2_ARCHITECTURE.md), README cross-link, [VERIFICATION.md](../../../../VERIFICATION.md) |

## Deferred (post-grading)

- Langfuse Cloud → Metrics drill-down for per-span p50/p95 to fill cost-report §4.2/§4.3.
- `social_history.php` 500s visible in agentforge-api logs (`openemr_invalid_json`) — pre-existing, doesn't break the demo, surfaces as a tool-call failure through the verification gate.
- Lab observations from agent extractions persist to `agentforge_w2/_obs/<sha256>.json` sidecar JSON read by a custom PHP endpoint; Option-B FHIR Observation table persistence runbook captured in [Week 3 milestone 01](../week-3/01-prod-deploy-and-cohort-reset.md).

## Production state at milestone close

- **VPS HEAD:** `0f5634014`
- **Compose project:** `development-easy` (12 containers including agentforge-api, openemr, patient-dashboard, caddy, postgres, langfuse, mariadb)
- **Eval-status endpoint:** `https://108-61-145-220.nip.io/health/eval-status` → 88 cases, 5 W2 categories at 1.0, baseline `w2-consolidated-2026-05-07`
- **Basic /health endpoint:** all four deps green (`openemr_module: ok`, `postgres: reachable`, `langfuse: ok`)
- **Demo cohort:** four W2 patients (Margaret Chen, James Whitaker, Sofia Reyes, Robert Kowalski) in new-patient-intake state on prod; multi-day appointment schedule live per [Week 3 milestone 01](../week-3/01-prod-deploy-and-cohort-reset.md).
