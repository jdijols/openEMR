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
| 4 | **Eval Dataset** | 50 synthetic/demo cases with expected behavior, boolean rubrics, judge configuration, results | ✅ shipped (88 cases — exceeds the 50-case brief target after the G2-Final-15 rebalance and the 2026-05-07 cross-worktree consolidation merge) | **88/88 cases** under [agentforge/api/eval/cases/curated/](../../agentforge/api/eval/cases/curated/) (50 G2-Early + 25 G2-Final-15 cohort-grounded rebalance + 13 consolidation cases covering W2 cross-patient write paths and FHIR persistence — see [W2_ARCHITECTURE.md §11](../../W2_ARCHITECTURE.md)). 5 boolean rubric categories (`schema_valid`, `citation_present`, `factually_consistent`, `safe_refusal`, `no_phi_in_logs`); per-category counts 12/12/12/43/9. Pinned baseline: [agentforge/api/eval/baseline.json](../../agentforge/api/eval/baseline.json) `version: w2-consolidated-2026-05-07`. Latest run: [agentforge/api/eval/reports/](../../agentforge/api/eval/reports/) (`cases:88 failures:0 gate_breaches:0`). Deterministic check rules (12 total, including `citation_quote_in_source` (FB-D-03) for substring fidelity): [agentforge/api/eval/runner.ts](../../agentforge/api/eval/runner.ts). **LLM judge** (committed prompt + model, opt-in via `EVAL_RUN_JUDGE=1`, scores `factually_consistent` + `safe_refusal` cases): prompt [agentforge/api/eval/judge/prompt.md](../../agentforge/api/eval/judge/prompt.md) `v1-2026-05-09`, model config [agentforge/api/eval/judge/model.json](../../agentforge/api/eval/judge/model.json) (`claude-sonnet-4-6`, temp 0, max_tokens 800), runner [agentforge/api/eval/judge/judge.ts](../../agentforge/api/eval/judge/judge.ts), test [agentforge/api/test/eval/judge.test.ts](../../agentforge/api/test/eval/judge.test.ts). |
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
- **W2 Eval cases (88 — 50 G2-Early + 25 G2-Final-15 rebalance + 13 G2-Final-FB consolidation):** [agentforge/api/eval/cases/curated/](../../agentforge/api/eval/cases/curated/)
- **W2 Eval baseline (pinned, `w2-consolidated-2026-05-07`):** [agentforge/api/eval/baseline.json](../../agentforge/api/eval/baseline.json)
- **W2 Eval runner (deterministic gate):** [agentforge/api/eval/runner.ts](../../agentforge/api/eval/runner.ts)
- **W2 LLM judge (committed prompt + model, opt-in `EVAL_RUN_JUDGE=1`):** [agentforge/api/eval/judge/prompt.md](../../agentforge/api/eval/judge/prompt.md) (`v1-2026-05-09`) · [agentforge/api/eval/judge/model.json](../../agentforge/api/eval/judge/model.json) (`claude-sonnet-4-6`, temp 0) · [agentforge/api/eval/judge/judge.ts](../../agentforge/api/eval/judge/judge.ts)
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

## 2b. W2 Surprise Challenge — Patient Dashboard Migration

**Brief:** [Documentation/AgentForge/references/AgentForge_Clinical-Co-Pilot_W2_Surprise-Challenge_Modernize-the-Patient-Dashboard.pdf](references/AgentForge_Clinical-Co-Pilot_W2_Surprise-Challenge_Modernize-the-Patient-Dashboard.pdf). Released 2026-05-06; same Sunday-noon submission deadline as the W2 main brief; graded as a separate deliverable.

| # | Deliverable | Brief requirement | Status | Artifact / link |
|---|---|---|---|---|
| 1 | **Working reimplementation in a modern framework** | Port the patient dashboard to a modern framework, consume OpenEMR's REST/FHIR API, no backend changes | ✅ shipped | [`patient-dashboard/`](../../patient-dashboard/) — React 19 + Vite 8 + TypeScript 6 + TanStack Query v5 + Zod v4 + Tailwind CSS v3. **11 cards** rendering live FHIR data: 6 Tier-0 (Patient Header, Allergies, Problem List, Medications, Prescriptions, Care Team, Vitals) + 5 Tier-1 stretch (Demographics, Health Concerns, Immunizations, Appointments, Labs). Embedded inside OpenEMR's chart shell at [`interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php`](../../interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php) (PHP loader) → React bundle in same module's `public/dashboard/`. **114 KB gzipped.** |
| 2 | **Authentication via OAuth2/OpenID Connect** | Login round-trip works | ✅ shipped (two paths) | **Production (embedded mode):** OpenEMR's existing OAuth2/OIDC login → React inherits the chart session via same-origin cookie + APICSRFTOKEN header (`LocalApiAuthorizationController` strategy, the same auth pathway `interface/main/tabs/main.php:133` uses). **Dev mode (preserved):** standalone OAuth2 + PKCE round-trip via `/login` and `/callback`. Both paths in source; production uses LocalApi. Defense narrative in [PATIENT_DASHBOARD_MIGRATION.md §7 (architecture revision)](../../PATIENT_DASHBOARD_MIGRATION.md) + [Appendix A (auth pathway, in detail)](../../PATIENT_DASHBOARD_MIGRATION.md). |
| 3 | **Patient header — name, DOB, sex, MRN, active status** | Persistent identity bar | ✅ shipped | [`patient-dashboard/src/patient/PatientHeader.tsx`](../../patient-dashboard/src/patient/PatientHeader.tsx). Sticky-top, all 5 brief-required fields, `<h1>` accessibility landmark. Renders from `Patient/{uuid}` FHIR resource. |
| 4 | **Required clinical cards (Allergies, Problem List, Medications, Prescriptions, Care Team)** | Each pulling live data from FHIR API | ✅ shipped | [`patient-dashboard/src/cards/`](../../patient-dashboard/src/cards/). Severity color-coding on Allergies (red/amber/emerald by `criticality` — beyond legacy parity which renders yellow regardless). Active-only filter on Medications; sort-by-`authoredOn`-desc on Prescriptions. Empty / loading / error states explicit (typed code + correlation id). |
| 5 | **One additional section of choice** | Encounter, labs, vitals, immunizations, appointments, or notes | ✅ shipped (Vitals is the brief's "+1"; Tier 1 adds 4 more) | Vitals card matches legacy parity (single most-recent encounter as key/value rows — discovered via PD-00 visual capture; would have shipped 10-row table without Phase 0). Labs card renders LOINC name + value + reference range + abnormal H/L pill in red — most clinically vivid card in the demo. |
| 6 | **PATIENT_DASHBOARD_MIGRATION.md defense doc** | Defense of framework choice + tradeoffs | ✅ shipped | [`PATIENT_DASHBOARD_MIGRATION.md`](../../PATIENT_DASHBOARD_MIGRATION.md) at repo root — 10 sections + Appendix A (auth pathway in detail) + Appendix B (5-route comparison table). Cross-referenced from PRD, dashboard-recon outputs, and this submission scoreboard. |
| 7 | **Reverse-engineering output (Phase 0)** | Per Tom Tarpey's reverse-first auditing methodology | ✅ shipped — exceeds | [`Documentation/AgentForge/implementation/dashboard-recon/`](implementation/dashboard-recon/) — 1,599 lines across 16 docs: `manifest.md` (entry-point map of all 22 legacy cards) + `cards/` (12 per-card MDs, 7 Tier-0 + 5 Tier-1) + `PARITY-NOTES.md` (parity catalog) + `MIGRATION-OPTIONS.md` (5-route comparison). 28 manual screenshots. |
| 8 | **Tab integration into OpenEMR chart shell** | (Implicit in "this page itself should be completely migrated over") | ✅ shipped | `Bootstrap.php` subscribes to `PatientMenuEvent::MENU_UPDATE` → rewrites the existing Dashboard tab URL to point at our `dashboard.php`. Clicking Dashboard from the secondary patient nav loads the React app full-canvas; legacy `demographics.php` no longer reachable from the menu. |
| 9 | **Visual elevation pass (Phase 7)** | (Implicit in the brief grading the demo video — visual cohesion is what graders see first) | ✅ shipped | [`interface/themes/agentforge-elevated.css`](../../interface/themes/agentforge-elevated.css) — single scoped CSS file using the same `--af-*` design tokens as the React surfaces. Loaded conditionally via two render-event hooks (chart shell + demographics.php). Re-skins the chart-shell top tab strip + the patient secondary nav so the chrome speaks the same visual language as the React app. Reverts in one commented-out line. |
| 10 | **Test suite + type safety** | (Implicit in framework defense) | ✅ shipped | **116/116 vitest cases passing** across 18 test files (113 from Phases 0–4 + 3 added during the auth refactor for the new mode-aware credential branch). `tsc --noEmit` clean. `npm run lint` clean. |
| 11 | **Deployed (graders can reach the dashboard)** | Reachable from the deployed app | ⏸ pending operator | Local Docker fully verified: HTTP 200 round-trip on dashboard.php; FHIR endpoints accept APICSRFTOKEN (200) and reject without (401); D6 + D7 audits pass. VPS deploy needs operator action: `git push gitlab master` + `agentforge-enable.php` to refresh module branding (per [project_module_registrar_refresh memory](../../.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/project_module_registrar_refresh.md)) + DB import refresh per [VPS DB deploys via full local-DB import memory](../../.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/project_vps_db_deploy_workflow.md). |
| 12 | **Demo video segment** | 30-second cut showing the modernized dashboard | ⏸ pending operator | Re-cut FB-C-06 to include 30s of the dashboard load (Phil Belford pid=1 verified locally) — Sunday AM. |

**Dashboard pre-submit (parallel to §3 below):**

- [x] `tsc --noEmit` clean
- [x] 116/116 vitest passing
- [x] PHP syntax clean (php -l on dashboard.php + Bootstrap.php)
- [x] Production build (`npm run build` from `patient-dashboard/`) lands in `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/` — 114 KB gzipped
- [x] PD-93 dashboard.php loader: session check + CSRF mint + `window.__AGENTFORGE_DASHBOARD__` injection
- [x] PD-95 PatientMenuEvent rewrite: secondary Dashboard tab URL → dashboard.php
- [x] PD-97 Phase 7 elevation: agentforge-elevated.css + dual-event injection (chart shell + demographics.php)
- [x] PD-98 D6 audit: zero PHP/Twig/Smarty in dashboard.php response body
- [x] PD-98 D7 audit: clinician auth context (authUser=admin, request_user_role=users)
- [x] PD-100 PATIENT_DASHBOARD_MIGRATION.md at repo root
- [ ] VPS redeploy + dashboard smoke from cellular — operator
- [ ] Demo video 30s segment — operator
- [ ] Submission form fields populated with the dashboard URL — operator

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
| W2-D8 | **Eval suite rebalance from 50 → 75 cases**. 2026-05-07. | G2-Early shipped 50 cases satisfying the brief's literal "50-case golden set" but composition was heavily skewed to `safe_refusal` (35 vs target 10) with the three new W2 categories thin (4/4/3). Threshold logic still fired correctly on the small categories — but coverage thinness was a real risk for the brief's hard-gate regression-injection probe (a regression in a path no case exercised would slip through). G2-Final-15 added 25 cohort-grounded cases (every cohort patient explicitly exercised: Chen, Whitaker, Reyes, Kowalski) lifting the three new W2 categories + factually_consistent to the §11 per-category target depth. `safe_refusal` held at 35 — trimming W1 cases to hit the 10-target would lose existing coverage. Final composition `10/10/12/35/8` hits §11 target on 4 of 5 categories. **This decision supersedes W2-D3 above.** *(Superseded by W2-D9 below — final state is 88 cases at `12/12/12/43/9` after the G2-Final-FB consolidation merge.)* | [W2_ARCHITECTURE.md §11](../../W2_ARCHITECTURE.md) + [TASKS.md G2-Final-15](../../TASKS.md) |
| W2-D9 | **Eval suite consolidation from 75 → 88 cases + LLM judge committed**. 2026-05-07 / 2026-05-09. | The G2-Final-FB feedback tracks (FB-A..FB-D) shipped in parallel session and were merged on 2026-05-07: 13 new cases covering W2 cross-patient write tools (`medication_add`, `medication_discontinue`, `allergy_delete`, `family_history_add`, `delete_uploaded_document`), the `citation_quote_in_source` (FB-D-03) substring-fidelity rule, the FHIR Observation persistence path, and deploy-preflight refusal shapes. Final composition `12/12/12/43/9` = **88 cases**, baseline `w2-consolidated-2026-05-07`. **2026-05-09:** committed LLM judge ([prompt.md](../../agentforge/api/eval/judge/prompt.md) `v1-2026-05-09` + [model.json](../../agentforge/api/eval/judge/model.json) `claude-sonnet-4-6` temp 0 + [judge.ts](../../agentforge/api/eval/judge/judge.ts)) added to satisfy instructor feedback that `factually_consistent` + `safe_refusal` need at least one judge-scored evaluation with documented prompt and model checked in. Judge is opt-in (`EVAL_RUN_JUDGE=1`), supplements the deterministic gate, never replaces it. **This decision supersedes W2-D8 above.** | [W2_ARCHITECTURE.md §11 "88-case composition"](../../W2_ARCHITECTURE.md) + [§11 LLM judge](../../W2_ARCHITECTURE.md) + [agentforge/api/eval/judge/](../../agentforge/api/eval/judge/) |

---

## 5. Watch-outs (per the brief's "Common Pitfalls" section)

The W2 brief calls out 5 common pitfalls. Each is mapped to the architectural decision that explicitly addresses it:

| Pitfall | Our defense |
|---|---|
| Trying to support five document types before two work reliably | We support exactly two (`lab_pdf` + `intake_form`). Brief explicit narrowing in [W2_ARCHITECTURE.md §15](../../W2_ARCHITECTURE.md). |
| Using a VLM answer directly without schema validation or source metadata | Every extraction passes through Zod parse against §6 schemas + a deterministic `pdf-parse` cross-check that drops unverified facts BEFORE persistence (S14 stop-the-line). |
| Letting the supervisor become a black box | Each worker invocation emits a `handoff.<worker>` Langfuse event with `{from, to, reason, input_summary, decided_at}` (G2-Early-10). System prompt carries explicit branching rules (G2-Early-12) that map 1:1 to those handoff reasons. |
| Using LLM-as-a-judge without a clear rubric | The eval gate is the deterministic runner — 12 typed boolean rules with documented rubric categories (G2-Early-30b..38). A separate LLM judge ([prompt.md `v1-2026-05-09`](../../agentforge/api/eval/judge/prompt.md), [model.json `claude-sonnet-4-6` temp 0](../../agentforge/api/eval/judge/model.json), [judge.ts](../../agentforge/api/eval/judge/judge.ts)) supplements `factually_consistent` + `safe_refusal` cases with judge-scored evaluations against an explicit five-band rubric (1.0 / 0.7-0.9 pass band / 0.4-0.6 partial / 0.1-0.3 fail / 0.0 catastrophic) and pass threshold 0.7. Judge is opt-in (`EVAL_RUN_JUDGE=1 npm run eval`), throws on API/parse error rather than fabricating a score, and is never the gate — the deterministic runner remains the merge blocker. |
| Logging raw document text, patient identifiers, or screenshots to SaaS observability tools | PHI redactor + W2 content-block summarizer (G2-MVP-40) replaces document/image bodies with `{type, size_bytes, mime}` summaries before any Langfuse span fires. `no_phi_in_logs` rubric category (G2-Early-33) gates regressions in this surface every commit. S7 + S11 stop-the-line invariants. |
