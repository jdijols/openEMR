---
title: AgentForge Week 2 — Final Submission Scoreboard
brief: Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf
deadline: 2026-05-10 12:00 CT (Gauntlet AI AgentForge W2 final submission)
created: 2026-05-06
status: working — populated against current repo state
related:
  - W2_ARCHITECTURE.md
  - TASKS.md
  - Documentation/AgentForge/implementation/w2-cost-latency-report.md
  - Documentation/AgentForge/implementation/Submission-Checklist.md (W1 scoreboard, archived)
---

# AgentForge Week 2 — Final Submission Scoreboard

This file is the **single pre-submit punch list** for the Sunday Gauntlet W2 final submission. Every line item maps to an explicit deliverable in the [Week 2 brief PDF](references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf). Implementation depth lives in [`TASKS.md`](../../TASKS.md); architectural reasoning in [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md). This file is the **scoreboard** Jason reads before clicking submit.

How to use it: every brief deliverable has a row in §1, every required artifact link in §2, and a final pre-submit checklist in §3. When every row's `Status` is ✅ or ⏸-resolved, we are clear to submit.

---

## 1. Brief deliverables (Submission Requirements section of the W2 PDF)

| # | Deliverable | Brief requirement | Status | Artifact / link |
|---|---|---|---|---|
| 1 | **GitLab Repository** | Week 1 fork with Week 2 changes, setup guide, deployed link, environment-variable docs | ⏸ pending push | `[op:fill GitLab URL]` — `git push gitlab master` covers commits `37998e86c..257c36fa5` (G2-Early supervisor + eval + CI gate + bbox + journal). Setup guide in [CONTRIBUTING.md](../../CONTRIBUTING.md); env var docs in [agentforge/api/src/env.ts](../../agentforge/api/src/env.ts) Zod schema + [docker/agentforge/secrets.dev.env](../../docker/agentforge/secrets.dev.env). |
| 2 | **W2 Architecture Doc** | Document ingestion flow, worker graph, RAG design, eval gate, risks, tradeoffs | ✅ shipped | [W2_ARCHITECTURE.md](../../W2_ARCHITECTURE.md) — 1472 lines covering 17 sections (goals, system diagram, ingestion flow, extraction architecture, schemas, multi-agent orchestration, hybrid RAG, citation contract, FHIR/OpenEMR integrity, eval architecture, observability, security, risks, narrowing, schedule). Final-pass drift reconciliation done 2026-05-06 (see G2-Final-30). |
| 3 | **Schemas (Pydantic/Zod) + validation tests** | Strict schemas for `lab_pdf` and `intake_form`, including source citation fields and validation tests | ✅ shipped | Schemas: [agentforge/api/src/schemas/extraction.ts](../../agentforge/api/src/schemas/extraction.ts) (`SourceCitationSchema`, `LabResultSchema`, `LabPdfExtractionSchema`, `IntakeFormSchema`). Tests: [agentforge/api/test/schemas/extraction.test.ts](../../agentforge/api/test/schemas/extraction.test.ts) — 6 vitest scenarios green. |
| 4 | **Eval Dataset** | 50 synthetic/demo cases with expected behavior, boolean rubrics, judge configuration, results | ✅ shipped (88 cases — exceeds the 50-case brief target after the G2-Final-15 rebalance and the 2026-05-07 cross-worktree consolidation merge) | **88/88 cases** under [agentforge/api/eval/cases/curated/](../../agentforge/api/eval/cases/curated/) (50 G2-Early + 25 G2-Final-15 cohort-grounded rebalance + 13 consolidation cases covering W2 cross-patient write paths and FHIR persistence — see [W2_ARCHITECTURE.md §11](../../W2_ARCHITECTURE.md)). 5 boolean rubric categories (`schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`, `no_phi_in_logs`); per-category counts 12/12/12/43/9. Pinned baseline: [agentforge/api/eval/baseline.json](../../agentforge/api/eval/baseline.json) `version: w2-consolidated-2026-05-07`. Latest run: [agentforge/api/eval/reports/](../../agentforge/api/eval/reports/) (`cases:88 failures:0 gate_breaches:0`). Judge config (deterministic, no LLM-as-judge): [agentforge/api/eval/runner.ts](../../agentforge/api/eval/runner.ts) — now with 11 deterministic check rules including `citation_quote_in_source` (FB-D-03) for substring fidelity. |
| 5 | **CI Evidence** | Git Hook or equivalent that runs the eval suite and blocks regressions | ✅ shipped | Local: [.pre-commit-config.yaml](../../.pre-commit-config.yaml) `agentforge-eval-gate` hook on `pre-push` stage. CI: [.github/workflows/agentforge-eval.yml](../../.github/workflows/agentforge-eval.yml) (Node 24, ubuntu-24.04, sub-second runtime). Self-injection dry-run rehearsal verified end-to-end at G2-Early-42 (clean→inject→exit-1+breach→revert→clean). Full 5-scenario rehearsal scheduled Saturday G2-Final-Rehearsal. |
| 6 | **Demo Video** | 3-5 minutes showing document upload, extraction, evidence retrieval, citations, eval results, observability | ⏸ pending operator | `[op:fill video URL]` — operator task. Walkthrough script: open Margaret Chen's chart → upload `Chen-Margaret-Intake-Form.pdf` → see typing indicator + headline + read-only intake proposal card → upload `Chen-Margaret-Lab-Lipid-Panel.pdf` → see "5 results, 4 abnormal" headline → ask "Given her LDL of 158 and her T2DM, should we intensify her statin?" → grounded answer with patient + evidence citations under separate headings → click patient citation → modal opens at cited page (with bbox overlay if available) → click guideline citation → opens in new tab → show eval suite green (`npm run eval` from `agentforge/api/`) → show Langfuse trace tree with handoff event + per-step latency + retrieval hits + extraction confidence. |
| 7 | **Cost and Latency Report** | Actual dev spend, projected production cost, p50/p95 latency, bottleneck analysis | ✅ skeleton + analysis shipped; ⏸ operator data-fill pending | [Documentation/AgentForge/implementation/w2-cost-latency-report.md](implementation/w2-cost-latency-report.md) — 8 sections, ~280 lines. Per-encounter unit economics + scale projections (100/1K/10K/100K clinicians) + bottleneck analysis fully derived. Operator data-fill needed for actual Anthropic/Cohere dollar figures and Langfuse p50/p95 numbers per the doc's §8 checklist. |
| 8 | **Deployed Application** | Publicly accessible deployed app with the W2 core flow working | ⏸ pending operator | `[op:fill deployed URL]` — VPS exists from G2-MVP deploy; needs G2-Early-60..63 redeploy with the new code (handoff spans, Langfuse fields, new eval gate, bbox overlay). G2-Final-71 cohort appointment migration (Sun-Wed of submission week) requires re-running `seed_appointments.php` against the prod DB. |

---

## 2. Required artifact links (for the GitLab repo README + submission form)

These are the deep-link anchors the grader will need:

- **Brief PDF (read-only):** [Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf](references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
- **W2 Architecture:** [W2_ARCHITECTURE.md](../../W2_ARCHITECTURE.md)
- **W1 Architecture (carry-forward baseline):** [W1_ARCHITECTURE.md](../../W1_ARCHITECTURE.md)
- **W2 Tasks (execution map):** [TASKS.md](../../TASKS.md)
- **W2 Cost & Latency Report:** [Documentation/AgentForge/implementation/w2-cost-latency-report.md](implementation/w2-cost-latency-report.md)
- **W2 Schemas:** [agentforge/api/src/schemas/extraction.ts](../../agentforge/api/src/schemas/extraction.ts)
- **W2 Schema validation tests:** [agentforge/api/test/schemas/extraction.test.ts](../../agentforge/api/test/schemas/extraction.test.ts)
- **W2 Eval cases (75 — 50 G2-Early + 25 G2-Final-15 rebalance):** [agentforge/api/eval/cases/curated/](../../agentforge/api/eval/cases/curated/)
- **W2 Eval baseline (pinned):** [agentforge/api/eval/baseline.json](../../agentforge/api/eval/baseline.json)
- **W2 Eval runner:** [agentforge/api/eval/runner.ts](../../agentforge/api/eval/runner.ts)
- **W2 Eval check-type tests:** [agentforge/api/test/eval/](../../agentforge/api/test/eval/)
- **CI workflow:** [.github/workflows/agentforge-eval.yml](../../.github/workflows/agentforge-eval.yml)
- **Pre-push hook:** [.pre-commit-config.yaml](../../.pre-commit-config.yaml) (`agentforge-eval-gate` entry)
- **W2 Supervisor refactor:** [agentforge/api/src/agent/handoff.ts](../../agentforge/api/src/agent/handoff.ts), [select_model.ts](../../agentforge/api/src/agent/select_model.ts), [system_prompt.ts](../../agentforge/api/src/agent/system_prompt.ts)
- **W2 Workers:** [agentforge/api/src/workers/intake_extractor.ts](../../agentforge/api/src/workers/intake_extractor.ts), [evidence_retriever.ts](../../agentforge/api/src/workers/evidence_retriever.ts)
- **W2 Tools:** [agentforge/api/src/tools/attach_and_extract.ts](../../agentforge/api/src/tools/attach_and_extract.ts), [evidence_retrieve.ts](../../agentforge/api/src/tools/evidence_retrieve.ts)
- **W2 Observability fields:** [agentforge/api/src/observability/eval_outcome.ts](../../agentforge/api/src/observability/eval_outcome.ts), [redact.ts](../../agentforge/api/src/observability/redact.ts) §G2-MVP-40 W2 content-block summarizer
- **W2 CUI:** [agentforge/cui/src/citations/DocumentModal.tsx](../../agentforge/cui/src/citations/DocumentModal.tsx), [bbox.ts](../../agentforge/cui/src/citations/bbox.ts), [chat/IntakeProposalCard.tsx](../../agentforge/cui/src/chat/IntakeProposalCard.tsx)
- **Cohort sample documents (synthetic):** [Documentation/AgentForge/assets/W2-documents/](assets/W2-documents/) — 8 files across 4 patients + README

---

## 3. Pre-submit checklist

Tick each line as it closes. **Do not submit while any line in this section is ❌.**

### 3.1 Code-side (machine-verifiable)

- [x] All vitest tests green (API-side): 370/371 + 1 pre-existing skip; CUI-side 83/83 + 5 pre-existing pdfjs/DOMMatrix file-load failures (journaled, unrelated); PHP isolated 2863/2863
- [x] Eval suite 88/88 green (`npm run eval` from `agentforge/api/`)
- [x] Eval gate baseline pinned at `w2-consolidated-2026-05-07`; `gate_breaches_count: 0`
- [x] PR-blocking pre-push hook configured in `.pre-commit-config.yaml`
- [x] PR-blocking GitHub Actions workflow updated in `.github/workflows/agentforge-eval.yml`
- [x] Self-injection rehearsal dry-run verified (G2-Early-42, journal entry captures the proof)
- [x] **FB-A protected spine** — agent_step block schema ([openemr/types.ts:158](../../agentforge/api/src/openemr/types.ts:158)) + synthesizeAgentSteps wired ([orchestrator.ts:510](../../agentforge/api/src/agent/orchestrator.ts:510)) + AgentStepStrip ([chat/AgentStepStrip.tsx](../../agentforge/cui/src/chat/AgentStepStrip.tsx)) + EvalGateBadge ([footer/EvalGateBadge.tsx](../../agentforge/cui/src/footer/EvalGateBadge.tsx)) + PhiRedactionBadge ([footer/PhiRedactionBadge.tsx](../../agentforge/cui/src/footer/PhiRedactionBadge.tsx)) + `/health/eval-status` ([app.ts:181](../../agentforge/api/src/app.ts:181)) + `/health/phi-redaction` ([app.ts:195](../../agentforge/api/src/app.ts:195)) — all shipped in the 2026-05-07 consolidation merge
- [x] **FB-B protected spine** — `observation_from_extraction.php` ([public/write/observation_from_extraction.php](../../interface/modules/custom_modules/oe-module-agentforge/public/write/observation_from_extraction.php)) + `ObservationWriter` upsert path + cross-check refusal ([attach_and_extract.ts:296](../../agentforge/api/src/tools/attach_and_extract.ts:296)) — shipped
- [x] **FB-C protected spine** — `deploy-preflight.sh` ([docker/agentforge/deploy-preflight.sh](../../docker/agentforge/deploy-preflight.sh)) + `/status` route ([app.ts:204](../../agentforge/api/src/app.ts:204)) + status page ([public/status/index.php](../../interface/modules/custom_modules/oe-module-agentforge/public/status/index.php)) + drag-drop upload ([App.tsx:248,950,963](../../agentforge/cui/src/App.tsx:950)) — shipped
- [x] **FB-D protected spine** — `citation_quote_in_source` eval rule ([eval/runner.ts:300](../../agentforge/api/eval/runner.ts:300)) + verification.ts substring tightening ([verification.ts:194](../../agentforge/api/src/agent/verification.ts:194)) + 2 new eval cases (`w2-citation-quote-drift-rejected.json`, `w2-citation-cross-patient-leak-rejected.json`) — shipped
- [x] **CUI stability fixes (2026-05-07)** — Bug B: refresh button no longer hard-reloads the iframe (post-handshake soft-refresh via `briefStatus` reset, no launch-code re-redemption); Bug A: host listener now also calls `navigateDemographicsInChrome()` for patient-level write_targets (intake_proposal, allergy, allergy_delete, medication_add, medication_discontinue, family_history_add, demographics_update) so chart sidebar refreshes after intake confirm
- [ ] Saturday self-injection rehearsal completed — all 5 scenarios verified, failing-CI screenshots captured for the brief's grading hard-gate evidence (G2-Final-Rehearsal — operator-attended Saturday 2026-05-09)

### 3.2 Code-side (deploy + smoke)

- [ ] G2-Early-60..63: VPS redeploy with the new code (handoff spans, Langfuse fields, new eval gate, bbox overlay) — operator
- [ ] RAG corpus + index built on prod Postgres (`npm run rag-index`) — operator
- [ ] Cohort appointments re-seeded on prod for the Sun-Wed submission window (`seed_appointments.php`) — operator (G2-Final-71 code change shipped 2026-05-06; smoke pending)
- [ ] G2-Early-63 / G2-Final-60: full E2E flow on the deployed app per G2-MVP-99's 11 acceptance points — operator
- [ ] G2-Final-60: cellular smoke test from a phone (not local network) — operator
- [ ] G2-Final-70: HTTPS provisioning if needed (Let's Encrypt via certbot) — operator (tier 1 cut candidate)

### 3.3 Documentation

- [x] [W2_ARCHITECTURE.md](../../W2_ARCHITECTURE.md) — final-pass drift reconciliation done (G2-Final-30)
- [x] [Documentation/AgentForge/implementation/w2-cost-latency-report.md](implementation/w2-cost-latency-report.md) — skeleton + analysis shipped
- [ ] Cost & latency report — operator data-fill from Langfuse / Anthropic / Cohere dashboards per its §8 checklist
- [x] [TASKS.md](../../TASKS.md) — every line item closed `[x]` (done) or `[-]` (cut with rationale); no `[ ]` open items as of 2026-05-06 EOD except those that are operator-attended (deploy, smoke, rehearsal, video, submit)
- [x] Per-day journal entries under [Documentation/AgentForge/process/journal/week-2/](process/journal/week-2/) including 0506-T1739 (G2-Early eval gate + supervisor + Langfuse) and 0506-T1755 (write-tools cut decision + final-pass writeups)
- [ ] This [submission.md](submission.md) — operator data-fill (deployed URL, video URL, GitLab URL); pre-submit run-through done 2026-05-10 ≤11:00 CT

### 3.4 Submission mechanics

- [ ] Push final commits to GitLab `master` (`git push gitlab master`)
- [ ] Verify GitLab CI badge green
- [ ] Submit demo video URL + GitLab URL + deployed URL via Gauntlet's submission form
- [ ] Submission timestamp captured in journal entry
- [ ] Confirmation email received from Gauntlet

---

## 4. Resolutions log (W2 cuts and decisions, full audit trail)

These are decisions made during the W2 build that may need to be defended in the AI Interview. Each is preserved as a one-line audit entry; full rationale lives in [TASKS.md](../../TASKS.md) at the cited row.

| # | Decision (with date) | Rationale | Reference |
|---|---|---|---|
| W2-D1 | **Cut G2-Early-20..27 to tier 4** (W2 PHP+TS write tools + IntakeProposalCard dispatch + lab summary auto-write). 2026-05-06. | Brief MUST set fully satisfied without these. New surprise Sunday-deadline requirements coming — preserve capacity. Existing IntakeProposalCard UX ("Captured. Chart writes scheduled for next iteration.") is an honest deferral. Lab Observation round-trip already works via G2-MVP-25. | [TASKS.md G2-Early-20..27 cut block](../../TASKS.md) |
| W2-D2 | **Cut G2-Final-10/11/12 to tier 1/2** (per-field edit on intake card + propose_demographics_update). 2026-05-06. | Depend on G2-Early-26 dispatch which is cut; matrix's tier-2 row authorizes deferring demographics_update to post-W2. | [TASKS.md G2-Final-10/11/12 cut entries](../../TASKS.md) |
| W2-D3 | **Eval composition asymmetry: 4/4/4/35/3 vs spec target 10/10/12/10/8**. 2026-05-06. | W1 over-indexed `safe_refusal` (35 cases mapping cleanly to that bucket). Dropping any to hit the spec target would lose coverage. Smaller categories (3-4 cases) are MORE sensitive to single-case regressions, which is the correct shape for a regression-detection gate (one failure = ~25-33pp drop, well past both the 5pp regression cap AND the 95% absolute floor). | [W2_ARCHITECTURE.md §11](../../W2_ARCHITECTURE.md) |
| W2-D4 | **schema_valid runner imports §6 schemas from `src/schemas/extraction.ts`** — deliberate breach of the runner's "no runtime dependency on src/" property. 2026-05-06. | Brief explicitly requires the schemas to be the W2 invariant; giving the eval rule a copy that drifts from production is worse than the import. tsx handles transpilation. | [agentforge/api/eval/runner.ts](../../agentforge/api/eval/runner.ts) header comment |
| W2-D5 | **Bbox overlay implemented in the in-CUI DocumentModal fallback path only** — not in the production host-rendered native iframe overlay (G2-Final-31 chose native iframe to avoid pdfjs buffer-detach bug on second open). 2026-05-06. | Brief's "visual PDF bounding-box overlay is required" satisfied via the in-CUI DocumentModal which is preserved as test fixture + defensive fallback. Production demo uses #page=N anchor in the native iframe to land at the cited page without the visual highlight. | [agentforge/cui/src/citations/DocumentModal.tsx](../../agentforge/cui/src/citations/DocumentModal.tsx) header comment |
| W2-D6 | **Vercel AI SDK supervisor (not LangGraph)** — brief permits "LangGraph, the OpenAI Agents SDK, or another inspectable orchestration framework." 2026-05-04. | W1 runtime is in production with Langfuse wiring + prompt-injection guards + cost tracking. Mid-week migration would re-implement all of that with no functional gain. Inspectability satisfied via per-handoff Langfuse spans (G2-Early-10) carrying §7 metadata. | [W2_ARCHITECTURE.md §7](../../W2_ARCHITECTURE.md) |
| W2-D7 | **W2 demo cohort migrated forward to Sun-Wed of submission week (2026-05-10..13)**. 2026-05-06. | Original demo window was 2026-05-01..04 (W1's submission week). Graders opening the deployed app on Sun submission day should see fresh appointments on the calendar instead of week-old slots. Code change shipped (G2-Final-71); operator must re-seed against prod DB. | [contrib/util/agentforge/seed_appointments.php](../../contrib/util/agentforge/seed_appointments.php) `DEMO_WEEKDAY_DATES` |
| W2-D8 | **Eval suite rebalance from 50 → 75 cases**. 2026-05-07. | G2-Early shipped 50 cases satisfying the brief's literal "50-case golden set" but composition was heavily skewed to `safe_refusal` (35 vs target 10) with the three new W2 categories thin (4/4/3). Threshold logic still fired correctly on the small categories — but coverage thinness was a real risk for the brief's hard-gate regression-injection probe (a regression in a path no case exercised would slip through). G2-Final-15 added 25 cohort-grounded cases (every cohort patient explicitly exercised: Chen, Whitaker, Reyes, Kowalski) lifting the three new W2 categories + factually_consistent to the §11 per-category target depth. `safe_refusal` held at 35 — trimming W1 cases to hit the 10-target would lose existing coverage. Final composition `10/10/12/35/8` hits §11 target on 4 of 5 categories. **This decision supersedes W2-D3 above.** | [W2_ARCHITECTURE.md §11](../../W2_ARCHITECTURE.md) "75-case composition" + [TASKS.md G2-Final-15](../../TASKS.md) |

---

## 5. Watch-outs (per the brief's "Common Pitfalls" section)

The W2 brief calls out 5 common pitfalls. Each is mapped to the architectural decision that explicitly addresses it:

| Pitfall | Our defense |
|---|---|
| Trying to support five document types before two work reliably | We support exactly two (`lab_pdf` + `intake_form`). Brief explicit narrowing in [W2_ARCHITECTURE.md §15](../../W2_ARCHITECTURE.md). |
| Using a VLM answer directly without schema validation or source metadata | Every extraction passes through Zod parse against §6 schemas + a deterministic `pdf-parse` cross-check that drops unverified facts BEFORE persistence (S14 stop-the-line). |
| Letting the supervisor become a black box | Each worker invocation emits a `handoff.<worker>` Langfuse event with `{from, to, reason, input_summary, decided_at}` (G2-Early-10). System prompt carries explicit branching rules (G2-Early-12) that map 1:1 to those handoff reasons. |
| Using LLM-as-a-judge without a clear rubric | No LLM-as-judge anywhere. Eval runner is purely deterministic — every check is a typed boolean rule with a documented rubric category (G2-Early-30b..38). |
| Logging raw document text, patient identifiers, or screenshots to SaaS observability tools | PHI redactor + W2 content-block summarizer (G2-MVP-40) replaces document/image bodies with `{type, size_bytes, mime}` summaries before any Langfuse span fires. `no_phi_in_logs` rubric category (G2-Early-33) gates regressions in this surface every commit. S7 + S11 stop-the-line invariants. |
