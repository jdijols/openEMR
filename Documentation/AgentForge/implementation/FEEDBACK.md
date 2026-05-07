---
title: AgentForge — Instructor Feedback Reconciliation (W2 MVP → Early Submission)
brief: Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf
deadline: 2026-05-10 12:00 CT (Gauntlet AI AgentForge W2 final submission)
created: 2026-05-07
status: actionable plan — every instructor point mapped to a concrete repo gap + sequenced fix
related:
  - W2_ARCHITECTURE.md
  - TASKS.md
  - Documentation/AgentForge/submission.md
  - Documentation/AgentForge/implementation/Submission-Checklist.md
  - Documentation/AgentForge/implementation/post-deploy-bug-log.md
---

# AgentForge — Instructor Feedback Reconciliation

This document is the single, authoritative response to instructor feedback on the W2 MVP submission. It reconciles every line of guidance the instructors posted in Slack (group thread + clarifications) and the personal feedback delivered to Jason directly. Each point is mapped to:

1. **What the instructor said** — verbatim, in scope.
2. **Where we stand today** — grounded against the actual repo state (file paths, line numbers, current behavior).
3. **What the gap is** — narrowed to a one-line gap statement.
4. **Plan to close it** — sequenced, technically concrete, identified by `G2-Final-FB-NN` IDs so they can land in [TASKS.md](../../../TASKS.md) without reformatting.

The goal of this document is not retrospective justification. It is the punch list a reviewer can hand back to us and verify, point-by-point, that the W2 Early Submission addresses everything the W2 MVP submission missed.

---

## 0. Executive summary

Instructors raised **eleven distinct points** across the group Slack thread, four clarification posts, the local-git-hook ack, and Jason's personal feedback. Of those:

| # | Theme | Status today | Severity | Tier |
|---|---|---|---|---|
| 1 | End-to-end physician workflow visibility | Partial — backend complete, in-product surfacing is thin | High | T0 (must) |
| 2 | Supervisor / orchestrator routing observability | Backend ✅ (Langfuse `handoff.<worker>` events). In-product ❌ — reviewer sees no UI evidence of routing | High | T0 |
| 3 | Hybrid retrieval truly sparse + dense + rerank | ✅ verified in [evidence_retriever.ts](../../../agentforge/api/src/workers/evidence_retriever.ts) — surfacing the funnel into the UI is the gap | Medium | T1 |
| 4 | Citations reliable + visible | Backend ✅, CUI rendering ✅ (per-block `claim` blocks with `[1] [2]` pills). Hardening the "every claim has a citation" promise in the eval is the gap | Medium | T1 |
| 5 | Eval gate ≥ 50 grounded cases | ✅ 75 cases — exceeds target; gap is making the gate **observable to the reviewer in the product**, not in CI logs | Low | T1 |
| 6 | Clinical-guideline corpus = approved practice docs | ✅ JNC8, ADA glycemic, USPSTF statin in [eval/guidelines/](../../../agentforge/api/eval/guidelines/) — gap is corpus selection rationale + bigger source surface for the demo | Medium | T1 |
| 7 | Patient data persisted to OpenEMR as FHIR (NOT chunked into vector DB) | Lab path ✅ (`ObservationWriter` exists). Wiring it from `attach_and_extract` ❌ (deferred at W2-D1). Intake-form path ❌ (no propose_*-write flow) | **Critical** | T0 |
| 8 | Intake-extractor returns strict-schema JSON | ✅ shipped — Zod + deterministic cross-check in [intake_extractor.ts](../../../agentforge/api/src/workers/intake_extractor.ts) | Done | — |
| 9 | Evidence-retriever returns evidence + source metadata | ✅ shipped — every chunk carries `SourceCitation` envelope | Done | — |
| 10 | Local git hooks are fine for the eval-suite-blocking requirement | ✅ pre-push hook in [.pre-commit-config.yaml](../../../.pre-commit-config.yaml) — surfacing the green/red badge IN the product is the gap | Medium | T1 |
| 11 | Deployment stable + tighter walkthrough + surface orchestration in product | ❌ deployed link broken on instructor's last visit; in-product orchestration surfacing is thin | **Critical** | T0 |

**Net result of this plan:** twelve discrete changes, identified `G2-Final-FB-01` through `G2-Final-FB-12`, sequenced across two work days. The plan respects the existing `[TASKS.md](../../../TASKS.md)` cut-tier policy (T0 must ship; T1 ships if budget; T2 deferred to V2 with explicit rationale). Every change carries a concrete acceptance criterion that can be verified by the instructor on the deployed app without reading code.

---

## 1. Group-thread feedback (general guidance)

> *"Make sure your supervisor/orchestrator routing is observable, your hybrid retrieval is truly sparse + dense with reranking, your citations are reliable and visible, and your eval gate is meaningful with 50+ grounded cases. Also spend time polishing the actual physician workflow, not just the backend architecture. We should clearly be able to see upload → extraction → persistence → retrieval → grounded response without needing to infer behavior from the repo."*

The five sub-points decompose as follows.

### 1.1 Supervisor / orchestrator routing must be observable — `G2-Final-FB-01`

**Where we stand.** [agentforge/api/src/agent/handoff.ts](../../../agentforge/api/src/agent/handoff.ts) emits a `handoff.<worker>` Langfuse event before every `attach_and_extract` and `evidence_retrieve` invocation, carrying `{from, to, reason, input_summary, decided_at}`. The supervisor system prompt at [system_prompt.ts](../../../agentforge/api/src/agent/system_prompt.ts) carries explicit branching rules that map 1:1 to those handoff reasons. **In Langfuse this is fully observable. In the product, it is not.** A reviewer who clones the repo and exercises the chat sees the answer arrive but has no UI evidence that the supervisor routed to a worker, why it routed, or what the worker returned.

**Gap.** Routing is observable to us (Langfuse). It is not observable to the reviewer (CUI).

**Plan — `G2-Final-FB-01`: Surface supervisor routing inline in the CUI.**

- Add a new chat block type `agent_step` to the [`chatBlockSchema`](../../../agentforge/api/src/openemr/types.ts) discriminated union:
  ```ts
  z.object({
    type: z.literal('agent_step'),
    worker: z.enum(['intake_extractor', 'evidence_retriever']),
    reason: z.string().min(1).max(160),
    input_summary: z.record(z.string(), z.unknown()),
    duration_ms: z.number().int().nonneg(),
    outcome: z.enum(['ok', 'no_results', 'error']),
    stats: z.record(z.string(), z.unknown()).optional(),
  })
  ```
- In [orchestrator.ts](../../../agentforge/api/src/agent/orchestrator.ts) `runChatTurn` (line ~570 onward), after `collectToolResultsFromGenerateTextResult`, walk the merged tool results and synthesize one `agent_step` block per `attach_and_extract` / `evidence_retrieve` invocation. The `stats` field carries the `RetrievalStats` payload from [evidence_retriever.ts](../../../agentforge/api/src/workers/evidence_retriever.ts) (`hits_sparse`, `hits_dense`, `hits_unioned`, `hits_after_rerank`) for retrieval steps, and the `extraction-confidence summary` (`schema_valid`, `cross_check_status`, `facts_total / facts_verified`) for extraction steps.
- Render `agent_step` in the CUI as a collapsed inline strip — single line:
  > *🛈 Routed to `evidence_retriever` (1.2s) — sparse 7 + dense 10 → 12 unioned → 5 reranked.*
  > *🛈 Routed to `intake_extractor` (3.4s) — schema valid, 14/14 facts verified.*

  Click expands to show `reason`, `input_summary`, full `stats`. Match the existing `ProposalCardShell` accent border so the visual identity is consistent.
- Reviewer can now see, in-product, that the supervisor routed and why. No Langfuse needed for the demo.

**Acceptance.** Open Margaret Chen's chart on the deployed app, upload `Chen-Margaret-Lab-Lipid-Panel.pdf`, ask *"Given her LDL of 158 and her T2DM, should we intensify her statin?"*. The transcript shows two `agent_step` strips before the final answer. Click each — the routing rationale + stats render inline.

### 1.2 Hybrid retrieval truly sparse + dense with reranking — `G2-Final-FB-02`

**Where we stand.** [evidence_retriever.ts](../../../agentforge/api/src/workers/evidence_retriever.ts) lines 90–149 explicitly run `tsvector / plainto_tsquery / ts_rank_cd` (sparse), `pgvector <=>` cosine on bge-small embeddings (dense), union-and-dedupe, then Cohere `rerank-english-v3.0` to produce top-N. `RetrievalStats` already carries the funnel shape per stage. **Reality matches the brief.**

**Gap.** Reviewer can't see the funnel without Langfuse.

**Plan — `G2-Final-FB-02`: Surface the retrieval funnel.** Folded into `G2-Final-FB-01` — the `agent_step` block for `evidence_retriever` carries the `RetrievalStats` payload directly. No separate plan item. The reviewer reads `sparse 7 + dense 10 → 12 unioned → 5 reranked` and the cohere model name on the same line.

**Acceptance.** Reviewer sees `sparse N + dense M → K unioned → R reranked` on every retrieval call.

### 1.3 Citations reliable + visible — `G2-Final-FB-03`

**Where we stand.** Every claim block emitted by the LLM passes through [verification.ts](../../../agentforge/api/src/agent/verification.ts) which enforces `claim → citation_ids[]` non-empty and validates each `citation_id` resolves to a `SourceCitation` returned by an upstream tool. The CUI's [`CitationLink`](../../../agentforge/cui/src/citations/CitationLink.tsx) renders three `source_type` variants (`lab_pdf | intake_form | guideline_chunk | openemr_record`) with click-through behavior per type. Backend + frontend already meet the brief.

**Gap.** Two failure modes the current eval doesn't directly probe:
1. A claim with a citation_id that resolves to a different *patient's* citation (cross-patient citation leak).
2. A retrieval result whose `quote_or_value` does not appear in the cited chunk's text (post-rerank citation drift).

**Plan — `G2-Final-FB-03`: Strengthen citation reliability gates.**

- **Add eval cases** under [agentforge/api/eval/cases/curated/](../../../agentforge/api/eval/cases/curated/):
  - `w2-citation-cross-patient-leak.json` — claim cites a `lab_pdf` from patient B while bound to patient A; expect refusal, mapped to `safe_refusal` category. Rule: `cross_patient_blocked` (already exists) extended to assert no foreign-patient `source_id` survives in claim citations.
  - `w2-citation-quote-drift.json` — `quote_or_value` is text *not* present in the cited chunk's body; expect verification layer to drop the claim. New rule `citation_quote_in_source`: deterministic substring check — `quote_or_value` MUST appear in the chunk's full text (not just the truncated 400-char preview). Adds ~15 lines to [runner.ts](../../../agentforge/api/eval/runner.ts).
- **Tighten production verification.** [verification.ts](../../../agentforge/api/src/agent/verification.ts) currently checks the `citation_id` resolves; extend it to assert the resolved `quote_or_value` is contained in `chunk.text` (not just the 400-char preview returned to the model). One-line check, no new dependencies.
- **In-product visibility.** Every citation pill renders the source label inline (e.g., `[USPSTF §3.1]`, `[Chen lipid p.1]`) instead of a bare `[1]`. The pill's `aria-label` carries the verbatim quote so a screen reader announces it.

**Acceptance.** A reviewer reading the chat sees every claim end with one or more named-source pills. Hovering a pill reveals the verbatim quote. Clicking a guideline pill opens the source URL in a new tab; clicking a patient-document pill opens the DocumentModal at the cited page.

### 1.4 Eval gate meaningful with 50+ grounded cases — `G2-Final-FB-04`

**Where we stand.** 75 cases (50 G2-Early + 25 G2-Final-15 cohort-grounded rebalance). 5 boolean rubric categories. Pinned baseline at `w2-final-rebalance-2026-05-06`. Per-category counts 10/10/12/35/8 — exceeds the brief's 50-case target by 50%. CI workflow [agentforge-eval.yml](../../../.github/workflows/agentforge-eval.yml) blocks PRs on regression. Pre-push hook in [.pre-commit-config.yaml](../../../.pre-commit-config.yaml) blocks pushes locally.

**Gap.** The reviewer can verify the gate works by reading our `Submission-Checklist.md`, but cannot verify it from the deployed product. They have to trust us that the green badge is real.

**Plan — `G2-Final-FB-04`: Surface the eval gate state in the product.**

- Add a new endpoint `GET /agentforge/api/health/eval-status` that reads the most recent report from [agentforge/api/eval/reports/](../../../agentforge/api/eval/reports/) and returns:
  ```json
  {
    "run_id": "20260507T...-...",
    "ran_at": "2026-05-07T16:04:11Z",
    "cases_total": 75,
    "cases_failed": 0,
    "perf_over_budget": false,
    "baseline_version": "w2-final-rebalance-2026-05-06",
    "gate_breaches_count": 0,
    "per_category": { "schema_valid": { "pass_rate": 1.0, "case_count": 10 }, ... }
  }
  ```
- Embed a small "Eval gate" status badge in the CUI footer — green when all categories ≥ 95% and 0 breaches, red otherwise. Click expands to per-category table.
- Wire the GitHub Actions workflow to publish the latest report to a stable artifact path that the badge endpoint reads from. The artifact is committed back to the repo (via a workflow that opens a PR on `master` after every successful eval run); the deployed app reads from disk so the badge is always derived from the same artifact the reviewer can inspect on GitHub.

**Acceptance.** Reviewer opens the deployed app, sees a green "Eval 75/75" pill in the footer, clicks to see per-category breakdown. The same numbers match what the GitHub Actions run shows in the latest CI artifact.

### 1.5 Polish the actual physician workflow — `G2-Final-FB-05`

**Where we stand.** Workflow today: clinician opens a chart → AgentForge rail iframe loads in OpenEMR's right panel → user can chat with the chart-context agent, attach a document via a hidden file input embedded in the Composer, and receive an extraction acknowledgment + a (read-only) intake-proposal card. Flows that work end-to-end: text Q&A grounded in chart context, document upload + extraction, clinical-note proposal & confirm (lab summaries are gated off per W2-D1 cut). Flows that have rough edges:

1. **Document upload** is hidden behind an unlabeled paperclip icon — no drag-and-drop, no preview before submit.
2. **Doc-type detection** is manual (radio buttons in Composer). The brief implies the supervisor should detect this.
3. **Confirmation** for the read-only intake card says *"Captured. Chart writes scheduled for next iteration."* — this is honest but visibly unfinished from a reviewer's perspective.
4. **Status pills** during extraction (`Got it. Reading the document now…`) don't reveal progress beyond the spinner. A 25-second extraction looks indistinguishable from a hung request.

**Gap.** The workflow technically works but reads as a backend demo with a frontend, not a physician copilot.

**Plan — `G2-Final-FB-05`: Workflow polish pass.**

- **Drag-and-drop upload** anywhere in the Composer. Replace radio buttons with auto-detection: PDF MIME → look at first page text — if it contains `Reference Range` / `LOINC` / `Specimen` keywords, route as `lab_pdf`; otherwise `intake_form`. Detection runs server-side in a new helper inside [attach_and_extract.ts](../../../agentforge/api/src/tools/attach_and_extract.ts), with a deterministic regex panel; uncertain cases fall back to a single in-card prompt *"This looks like neither a lab report nor an intake form — please pick:"*.
- **Progress streaming** on extraction. The pending acknowledgment carries a step trace (`Reading PDF` → `Calling extractor` → `Validating schema` → `Cross-checking quotes`) updated via SSE on the existing `/conversations/:id/messages` channel. Each step shows elapsed time. This makes a 25-second extraction feel inspectable instead of frozen.
- **Replace the "scheduled for next iteration" copy** on the intake card. Either ship the FHIR persistence per `G2-Final-FB-07` and flip the copy to *"Confirm to write 14 facts to the chart"* with real persistence, OR (if persistence slips) downgrade the card to a clearly-marked *"Read-only summary — no chart writes in this build"* banner. **Do not ship the half-state copy** — it reads as broken.
- **Empty-state copy** on the chart-rail landing screen. Today the rail loads with an idle blank state. Replace with three example chips:
  - *"Summarize this patient's last visit."*
  - *"What changed in their meds since last labs?"*
  - *"Are they due for a statin given their T2DM?"*

  Click sends as a turn. Reviewer immediately knows what the agent does without reading docs.

**Acceptance.** Reviewer can open a chart, drag a PDF onto the rail, watch the extraction's per-step progress, and see the result either persisted to the chart (per `G2-Final-FB-07`) or honestly labeled as a read-only summary. The blank rail offers three obvious next-actions instead of a hint to type something.

### 1.6 Upload → extraction → persistence → retrieval → grounded response without inferring from repo — `G2-Final-FB-06`

**Where we stand.** Each segment exists. Together, they don't form a self-explanatory loop in the product.

**Gap.** Persistence is the broken link (see `G2-Final-FB-07`); without that, the loop short-circuits and the reviewer reads "agent extracts then forgets."

**Plan — `G2-Final-FB-06`: Make the loop visible end-to-end.**

The loop the reviewer must be able to walk in the product:

1. **Upload.** Drag PDF onto rail → file preview appears in Composer.
2. **Extraction.** Inline progress trace from `G2-Final-FB-05`.
3. **Persistence.** A confirm card showing exactly what will be written to the chart (FHIR Observations for labs; per-section proposals for intake) — see `G2-Final-FB-07`.
4. **Retrieval.** The next user question routes through the supervisor; the `agent_step` strip from `G2-Final-FB-01` shows the worker dispatch.
5. **Grounded response.** Final answer carries inline citations to *both* the patient document the reviewer just persisted *and* the guideline corpus chunk.

Loop is the demo. Each numbered step is one of the five fixes in this document. The `agent_step` strip + DocumentModal already give us 1 / 2 / 4 / 5 — `G2-Final-FB-07` is the missing rail.

**Acceptance.** A reviewer can open the deployed app, walk through steps 1–5 above without prompting, and see each step's evidence in the UI without opening any external tool (Langfuse, GitHub, repo).

---

## 2. Clarification posts (in-thread expansions)

### 2.1 Clinical-guideline corpus = approved practice docs (NOT patient-derived) — `G2-Final-FB-07-CORPUS`

> *"The 'clinical-guideline corpus' represents documents that are agreed practices that the hospital/clinic/office follows. […] Patient-derived data (lab results, intake observations, etc.) should be stored in OpenEMR as FHIR records, not chunked into a vector DB."*

**Where we stand.** Today's corpus contains only approved practice documents:
- [eval/guidelines/jnc8-bp.md](../../../agentforge/api/eval/guidelines/jnc8-bp.md) — JNC 8 hypertension guideline (JAMA 2014).
- [eval/guidelines/ada-glycemic.md](../../../agentforge/api/eval/guidelines/ada-glycemic.md) — ADA Standards of Care, glycemic targets.
- [eval/guidelines/uspstf-statin.md](../../../agentforge/api/eval/guidelines/uspstf-statin.md) — USPSTF statin recommendations.

These are chunked + embedded into `rag_chunks` (Postgres + pgvector) by [scripts/build-rag-index.mjs](../../../agentforge/api/scripts/build-rag-index.mjs). **The corpus is correctly bounded.** No patient data is anywhere near it.

**Gap.** Three guidelines is thin for a demo. Reviewer asking off-topic questions (e.g., diabetic foot screening, immunization schedule) will find no evidence and the agent will refuse — which is technically correct but reads as undercoverage.

**Plan — `G2-Final-FB-07-CORPUS`: Expand the corpus to a defensibly-sized "house guideline" set.**

Add four more public-domain primary-care guidelines, chosen for breadth across the cohort's clinical surface:
1. **CDC ACIP Adult Immunization Schedule (2025).** ~1500 words covering routine adult vaccines.
2. **USPSTF Diabetes Screening (2021).** Screening criteria for adults aged 35–70 with overweight/obesity.
3. **ACC/AHA Lipid Management (2018), Chapter 4 — Statin Therapy.** Risk thresholds, intensity tiers.
4. **CDC Tobacco Cessation Brief Intervention.** 5As framework — relevant to the W1 tobacco-status write tool.

Each is a single Markdown file in [eval/guidelines/](../../../agentforge/api/eval/guidelines/), structured with section headers (the chunker uses headers as boundaries). All four are public-domain or CC-BY licensed — checked against the source URL footer in each file.

A new `Documentation/AgentForge/references/corpus-selection-rationale.md` doc explains:
- Why each guideline was chosen (cohort match + coverage gap).
- The license / source URL of each.
- The chunking strategy (header-bounded, 200–600 tokens per chunk, ~85 chunks total at 7 docs).
- The intentional decision to keep the corpus *small and curated* — the brief explicitly says *"Be reasonable and intentful when selecting documents. Especially for MVP, just get something in there that can be referenced, then build from there."*

**Acceptance.** Reviewer can ask *"Is this patient due for a Tdap?"*, *"Should I screen this patient for T2DM?"*, *"What's the statin intensity tier for this LDL?"*, *"How would you brief them on quitting smoking?"* — each routes through `evidence_retrieve` and lands a relevant guideline citation.

### 2.2 The extracted should go somewhere — patient data → OpenEMR DB as FHIR — `G2-Final-FB-07`

> *"The extracted should go somewhere. Otherwise it's not being ingested. Is the extracted data FHIR data? If so, it should go into the OpenEMR db."*

**This is the most consequential gap in the W2 MVP submission.** The extractor reaches the chat as an `extraction` block; the read-only intake card shows the data; the lab summary gets formatted; **the OpenEMR DB receives nothing.**

**Where we stand.**
- The persistence service exists: [`OpenEMR\Modules\AgentForge\Documents\ObservationWriter`](../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/ObservationWriter.php) is fully implemented for FHIR Observations derived from lab extractions, with idempotency keyed on `(patient_uuid, docref_uuid, extraction_field_path)` and an audit trail row per write.
- The intake-side write port does **not** exist — there is no `AllergyWriter`, `MedicationWriter`, `FamilyHistoryWriter`, or `DemographicsUpdater` in the AgentForge module.
- Both write paths are gated off in the chat — the lab summary auto-write was cut at W2-D1 because the W1 catch-all in `ClinicalNoteWriteAction.execute()` swallowed an exception during the final hour before W2 MVP submission.
- The intake card carries the honest copy *"Captured. Chart writes scheduled for next iteration (G2-Early-26)."*

**Gap.** The MVP submission does not ingest extractions into the FHIR-shaped OpenEMR DB. The instructor flagged this directly.

**Plan — `G2-Final-FB-07`: Ship FHIR persistence end-to-end for both doc types.**

This is the largest single piece of work in the plan. Sequenced into **seven sub-tasks**, each landing as its own commit so a regression can be bisected:

#### `G2-Final-FB-07a` — Lab pathway: end-to-end FHIR Observation persistence

Wire `attach_and_extract` for `lab_pdf` directly to `ObservationWriter`:
- After the extractor returns `crossCheckStatus === 'verified'` (every `quote_or_value` matched the PDF text), iterate `extraction.results[]` and call `ObservationWriter::upsert()` for each lab result.
- `extraction_field_path` follows the §10 convention: `extraction.results[i].value` for the value, with `loinc` populated when present.
- The post-write proposal card shows *N FHIR Observations written, link to chart*. No clinician confirmation needed — the W2-D1 cut wanted Confirm/Reject; the brief's MVP only requires that the data lands in the chart with provenance.
- **Why no Confirm gate.** The brief's S2 invariant (*"no silent module write"*) applies to *clinician-initiated structured edits* (chief complaint, vitals, clinical notes, allergy adds). FHIR Observations derived from a clinician-uploaded document with cross-check verification are explicitly the brief's "ingestion" path, not a structured-edit proposal. The audit row + `derivedFrom` provenance is the safety surface here, not a Confirm/Reject gate.

#### `G2-Final-FB-07b` — Lab pathway: PDF-failed-cross-check refusal

If `crossCheckStatus !== 'verified'`, ZERO Observations are written. The chat shows a refusal block *"Some values in this lab couldn't be verified against the source PDF — not writing to the chart. Open the source to review."*. New eval case `w2-lab-cross-check-fail-no-write.json` under `factually_consistent`.

#### `G2-Final-FB-07c` — Intake pathway: per-section write tools

Five new tools under [agentforge/api/src/tools/](../../../agentforge/api/src/tools/), one per intake section, each landing on a corresponding PHP write endpoint:
- `propose_allergy_add` → `interface/modules/custom_modules/oe-module-agentforge/public/write/allergy.php` (already exists; add the `add` payload shape).
- `propose_medication_add` → new `write/medication.php` plus a `MedicationWriter` PHP service modeled on `ObservationWriter`'s idempotency contract.
- `propose_family_history_add` → new `write/family_history.php` + `FamilyHistoryWriter`. Idempotent on `(patient_uuid, relation, condition)`.
- `propose_chief_complaint_set` → existing `write/chief_complaint.php`, repurposed to accept the intake card's chief-concern text.
- `propose_demographics_update` — **deferred to V2** (W2-D2 cut). The intake card surfaces demographics for review only; clinician edits via OpenEMR's native demographics form.

Each tool emits a **`proposal` chat block with Confirm/Reject** (the brief S2 invariant applies here — these are structured edits).

#### `G2-Final-FB-07d` — Intake card → bulk Confirm flow

The read-only intake card grows a Confirm button that fans out to N proposals (one per section with extracted facts, gated by section). The card shows per-section success/failure as the writes resolve. On 100% success, the card flips to a green "Persisted to chart" banner with click-through to each FHIR resource. On partial failure, the section that failed shows an inline error with retry.

#### `G2-Final-FB-07e` — Audit trail surfacing

Every write inserts an audit row in `agentforge_audit` with `action='extraction_persisted'`, `correlation_id`, `extraction_field_path`, `proposal_id`. Add a panel page `interface/modules/custom_modules/oe-module-agentforge/public/panel.php?view=extractions` listing recent extractions with click-through to the audit rows + the source DocumentReference.

#### `G2-Final-FB-07f` — Retrieval round-trip via FHIR

A new chart_context_read tool `read_observations` queries the same FHIR Observation rows that `G2-Final-FB-07a` wrote. The agent now retrieves what it just persisted, closing the loop. Includes an integration test that:
1. Uploads `Chen-Margaret-Lab-Lipid-Panel.pdf`.
2. Persists Observations.
3. Asks *"What's her latest LDL?"* in a fresh conversation.
4. Asserts the answer carries a citation to the just-written Observation row.

#### `G2-Final-FB-07g` — Eval cases for the persistence path

Five new cases under [eval/cases/curated/](../../../agentforge/api/eval/cases/curated/):
- `w2-fhir-lab-observation-write-pass.json` — verified lab → Observations written.
- `w2-fhir-lab-cross-check-fail-no-write.json` — unverified lab → zero writes (already covered by `G2-Final-FB-07b`).
- `w2-fhir-intake-allergy-add-pass.json` — intake confirm → AllergyIntolerance written.
- `w2-fhir-intake-partial-failure-recoverable.json` — 4 of 5 sections succeed, 1 fails → user sees per-section status, can retry.
- `w2-fhir-intake-cross-patient-blocked.json` — patient_uuid mismatch on confirm → write blocked, audit row records the attempt.

**Acceptance.** Reviewer uploads `Chen-Margaret-Lab-Lipid-Panel.pdf`, sees `5 FHIR Observations written` banner, navigates to OpenEMR's native Lab Results panel for Chen, sees the 5 LDL/HDL/triglycerides/etc. rows. Same flow for intake form. Asks the agent *"what was her last LDL?"* in a fresh conversation — answer cites the just-persisted Observation.

### 2.3 Upload location — clarification — `G2-Final-FB-08`

> *"The upload can be where you feel it fits best. Consider the upload flow already in the app as well."*

**Where we stand.** Upload is currently in the chat Composer — a paperclip icon next to the send button. Some reviewers will expect to upload via OpenEMR's existing **Documents** module (a dedicated chart panel for uploading any file), then ask the agent to extract.

**Gap.** Upload-from-chat is the only path. Upload-from-Documents-then-extract isn't wired.

**Plan — `G2-Final-FB-08`: Add a "Send to AgentForge" affordance in the OpenEMR Documents module.**

- New right-click context-menu item `Send to AgentForge` on PDF rows in `interface/patient_file/documents/list_documents.php`. On click, it opens the AgentForge rail with a pre-filled message: *"Extract from `<filename>`"* and a hidden `docref_uuid` carrying the existing document reference. The rail's existing `attach_and_extract` flow handles it from there.
- The Composer-attached upload path remains as the fast lane. Both converge on the same `attach_and_extract` tool.
- Documentation note in [Documentation/AgentForge/runbooks/](../../../Documentation/AgentForge/runbooks/) explaining when each path is appropriate.

**Acceptance.** A reviewer can either drag a PDF onto the rail Composer or right-click a row in OpenEMR's Documents panel and pick "Send to AgentForge" — both reach the same extraction.

### 2.4 Intake-extractor returns strict-schema JSON — `G2-Final-FB-09` (verification)

> *"The intake-extractor should gather document data and return the extracted values as strict-schema JSON."*

**Where we stand.** [intake_extractor.ts](../../../agentforge/api/src/workers/intake_extractor.ts) lines 140–168 parses the LLM's JSON envelope through Zod (`LabPdfExtractionSchema` / `IntakeFormSchema`) and short-circuits with `schemaValid=false` on any rejection. Six vitest scenarios green in [test/schemas/extraction.test.ts](../../../agentforge/api/test/schemas/extraction.test.ts). The eval gate's `schema_valid` rubric (10 cases) imports the production schemas directly per W2-D4. **Already meets the brief.**

**Plan — `G2-Final-FB-09`: Confirm the contract is visible to the reviewer.**

- Add a `Documentation/AgentForge/references/extraction-schema-tour.md` document showing each schema's structure with an annotated example. Cross-link from the README.
- Surface schema validity in the `agent_step` block from `G2-Final-FB-01` — the extraction step shows `schema valid ✓` or `schema invalid: <first issue path>` on its inline strip.

**Acceptance.** Reviewer reading the chat sees the strict schema verifying inline; reading the docs sees the full schema tour.

### 2.5 Evidence-retriever does sparse + dense + rerank with source metadata — `G2-Final-FB-10` (verification)

> *"Yes, the evidence-retriever uses sparse and dense retrieval over your clinical guideline corpus, reranks the results, and returns evidence snippets with source metadata pointing back to specific text in the corpus."*

**Where we stand.** Verified above (§1.2). Each chunk carries a full `SourceCitation` envelope with `source_url`, `page_or_section`, `field_or_chunk_id`, and `quote_or_value`. **Already meets the brief.**

**Plan — `G2-Final-FB-10`: No code change.** Already shipped, surfacing covered by `G2-Final-FB-01`.

### 2.6 Supervisor doesn't have to be the main agent — `G2-Final-FB-11` (verification)

> *"The supervisor does not have to be the main agent. It could be the main agent, or it could be an agent that gets called."*

**Where we stand.** The supervisor IS the main agent — it's the model invoked by [orchestrator.ts](../../../agentforge/api/src/agent/orchestrator.ts) `runChatTurn`, with the workers (`intake_extractor`, `evidence_retriever`) as tools the supervisor can dispatch. Decision recorded as **W2-D6** in [submission.md](../submission.md): we use Vercel AI SDK with the supervisor-as-main-agent pattern instead of LangGraph's nested graph, because W1 is in production with Langfuse + prompt-injection guards already wired and a mid-week migration would re-implement that with no functional gain.

**Plan — `G2-Final-FB-11`: No code change.** The decision is already documented and it's an explicitly permitted pattern. Surfacing the supervisor's identity to the reviewer is covered by `G2-Final-FB-01`.

### 2.7 Proof of where data came from — `G2-Final-FB-12` (verification)

> *"Yes, you need proof of where the data came from so someone could easily verify it."*

**Where we stand.** Every fact carries a citation. Every citation has a verbatim `quote_or_value`. Every patient-document citation has a `bbox` (when populated by pdfjs) and opens the source PDF at the cited page when clicked. Every guideline citation opens the source URL in a new tab. **Already meets the brief.**

**Plan — `G2-Final-FB-12`: Surface provenance for the persisted FHIR rows.** Folded into `G2-Final-FB-07a`'s `derivedFrom` linkage. The reviewer can navigate from a written Observation row → the source DocumentReference → the original PDF, end-to-end traceable.

---

## 3. Local git hooks ack — `G2-Final-FB-13`

> *"yes, local git hooks are fine for the requirement to prevent eval suite breakages from getting merged into your repos"*

**Where we stand.** Pre-push hook configured in [.pre-commit-config.yaml](../../../.pre-commit-config.yaml) under `agentforge-eval-gate`. Verified end-to-end at G2-Early-42 (clean → inject regression → exit 1 + breach → revert → clean). CI workflow [agentforge-eval.yml](../../../.github/workflows/agentforge-eval.yml) blocks PRs on regression as belt-and-suspenders. **Already meets the brief.**

**Plan — `G2-Final-FB-13`: Capture the hook firing on a regression for the demo video.** Two screenshots in [Documentation/AgentForge/implementation/](../implementation/):
1. Local terminal — `git push` rejected by the hook with the breach reason.
2. GitHub Actions — same regression rejected by the CI workflow.

Reviewer can see both surfaces from the demo video; the actual `.pre-commit-config.yaml` entry is one click away.

**Acceptance.** Demo video shows the hook firing; documentation has a still image of each surface.

---

## 4. Personal feedback — Jason direct DM

> *"Jason, thank you for taking me through the submission. I wasn't able to use the deployed link since it was broken, but I was able to clone the repo locally and test the workflow directly. The upload and extraction flow were functioning when tested, and I was able to verify the hybrid retrieval pipeline, Cohere reranking, evidence metadata handling, worker separation, and overall Week 2 architecture direction in the repo. The biggest thing to improve now is verification visibility. There are still several areas that were difficult to fully validate from the demo and deployment experience, including schema enforcement, supervisor routing visibility, eval coverage, CI execution, PHI-safe logging behavior, and full end-to-end persistence flows. For early submission, make the deployment stable, tighten the walkthrough, and surface more of the orchestration and validation behavior directly in the product so reviewers do not have to infer it from the codebase."*

The instructor named six surfaces that need visibility, plus three meta-asks (deployment stability, walkthrough tightening, in-product surfacing). Each is folded into the plan above:

| Personal-feedback surface | Plan item |
|---|---|
| Schema enforcement visibility | `G2-Final-FB-01` (`agent_step` block surfaces `schema_valid ✓ / ✗`) + `G2-Final-FB-09` (schema tour doc) |
| Supervisor routing visibility | `G2-Final-FB-01` (inline `agent_step` strip) |
| Eval coverage visibility | `G2-Final-FB-04` (footer eval-gate badge in product) |
| CI execution visibility | `G2-Final-FB-04` (badge endpoint reads CI artifact) + `G2-Final-FB-13` (demo video stills) |
| PHI-safe logging visibility | `G2-Final-FB-14` (NEW — see below) |
| End-to-end persistence | `G2-Final-FB-07` (FHIR persistence) + `G2-Final-FB-06` (loop visualization) |
| Deployment stability | `G2-Final-FB-15` (NEW — see below) |
| Walkthrough tightening | `G2-Final-FB-05` (workflow polish) + `G2-Final-FB-16` (NEW — guided demo mode) |

### 4.1 PHI-safe logging visibility — `G2-Final-FB-14`

**Where we stand.** [observability/redact.ts](../../../agentforge/api/src/observability/redact.ts) is a deny-list redactor with W2 content-block summarization (G2-MVP-40). Eight PHI denylist patterns (SSN, MRN, DOB, phone, email, person names, address, bearer tokens) exercised by 8 dedicated `no_phi_in_logs` eval cases. PHI redaction is on the wire-out path of every Langfuse span. **The behavior is correct and tested. The reviewer can't see it without Langfuse access.**

**Plan — `G2-Final-FB-14`: In-product PHI-safe-logging proof.**

- New `GET /agentforge/api/health/phi-redaction` endpoint that runs the redactor against a fixed test fixture (a synthetic clinical note with embedded fake-PHI: SSN 555-12-3456, DOB 1980-01-15, phone 555-867-5309, name JOHN DOE, MRN 12345). Returns:
  ```json
  {
    "input_sample": "<truncated to first 80 chars>",
    "redacted_sample": "<truncated to first 80 chars showing [REDACTED] markers>",
    "patterns_tested": ["ssn", "dob_iso", "phone_us", "person_name", "mrn_label"],
    "patterns_caught": ["ssn", "dob_iso", "phone_us", "person_name", "mrn_label"],
    "all_caught": true
  }
  ```
- Wire into the same footer-status panel as `G2-Final-FB-04`'s eval gate. Reviewer clicks "PHI redaction ✓ — 5/5 patterns caught" → modal shows side-by-side input/output for the synthetic fixture.
- The endpoint runs the redactor live, so it cannot drift from production behavior.

**Acceptance.** Reviewer opens the deployed app, clicks the PHI badge in the footer, sees the redaction operating against synthetic PHI in real time.

### 4.2 Deployment stability — `G2-Final-FB-15`

**Where we stand.** Deployment last broke at the W2 MVP submission window per the instructor DM. Possible failure modes (per [post-deploy-bug-log.md](post-deploy-bug-log.md) and the project memory):
1. Module registrar staleness (memory note: needs `agentforge-enable.php` refresh after every redeploy).
2. `npm run dev` (tsx, transpile-only) hides type errors that surface in `npm run build` (memory note flagged this previously).
3. agentforge-api needs glibc, not musl (memory note flagged onnxruntime-node binaries breaking on alpine).
4. Demo cohort appointments expire — graders open the calendar and see a week-old date range (G2-Final-71 fix shipped, smoke pending).

**Plan — `G2-Final-FB-15`: Pre-flight deploy gate + watchdog.**

- **Strict pre-deploy gate.** New script `docker/agentforge/deploy-preflight.sh` that runs sequentially:
  1. `npm run build` (not `dev`) — surfaces the type errors that musl/tsx hides.
  2. `composer phpstan` — full repo, not subset.
  3. `npm run eval` — must exit 0 with zero breaches.
  4. `prek run --all-files` — the pre-commit suite.
  5. Module-registrar checksum verification — fail if the prod manifest doesn't match the local one.
  6. Cohort appointment validity check — fail if `seed_appointments.php`'s `DEMO_WEEKDAY_DATES` is in the past.

  Any failure aborts deploy. Documented in [docker/agentforge/README.md](../../../docker/agentforge/README.md).
- **Post-deploy smoke loop.** A new lightweight CronCreate scheduled task hits `/agentforge/api/health/eval-status`, `/agentforge/api/health/phi-redaction`, and a synthetic chat turn every 60 seconds for the 30 minutes after a deploy. First failure auto-rolls-back to the previous container tag (Caddy maps `agentforge.<host>` → `agentforge-api:<tag>`; rollback flips the tag).
- **Status page.** Embed the smoke results into a `/agentforge/api/status` page that's the first thing a reviewer can hit to verify the deployment is healthy. Three pills: API, Postgres, Langfuse — green/yellow/red with last-seen timestamp.

**Acceptance.** Reviewer hits the deployed app, the page renders. If they hit `/agentforge/api/status`, they see all three pills green. If a deploy is mid-rollout, the status page shows yellow with the rollout state.

### 4.3 Guided demo mode — `G2-Final-FB-16`

**Where we stand.** The reviewer is a busy instructor who has clones of every cohort member's repo. They will spend 5 minutes in our deployed app, max. Today they would: load the rail, look at the chat, type something, and either be impressed or move on.

**Gap.** No structured walkthrough. The reviewer has to figure out what to do.

**Plan — `G2-Final-FB-16`: Guided demo mode in the deployed app.**

- New URL parameter `?demo=guided` on the chart-rail launch URL. When present, the rail loads with a tour overlay:
  - Step 1 (3s pause): *"This is AgentForge — a clinical copilot for OpenEMR. Click 'Start' to walk through the W2 deliverables."*
  - Step 2: highlights the Composer's drag-zone — *"Drop a PDF here to extract structured facts."* Pre-loaded with `Chen-Margaret-Lab-Lipid-Panel.pdf` available in a "demo files" picker.
  - Step 3: extraction runs — narrates each `agent_step` strip as it appears.
  - Step 4: persistence card — *"5 FHIR Observations will be written to the chart. The audit row carries the source DocumentReference."*
  - Step 5: pre-fills the next message — *"Given her LDL of 158 and her T2DM, should we intensify her statin?"*. User clicks Send.
  - Step 6: highlights citations on the response — *"Every claim carries a verbatim quote. Click to open the source."*
  - Step 7: shows the footer badges — *"Eval gate (75/75), PHI redaction, supervisor routing — all surfaced live in the app."*

  Each step has Skip + Next + Stop tour buttons.
- The tour does not change behavior — it only annotates what the user already sees.

**Acceptance.** Reviewer follows the URL `https://<deployed>/agentforge/launch?patient=chen&demo=guided` and walks through the full upload → extraction → persistence → retrieval → grounded response loop in 90 seconds without typing anything they don't choose to.

---

## 5. Sequencing

Two work days remaining before W2 final submission (Sun 2026-05-10 noon CT). Each item is sized in hours and gated against the cut-tier policy.

### Day 1 — Saturday 2026-05-09

| Slot | Item | Hrs | Tier |
|---|---|---|---|
| Morning | `G2-Final-FB-15` deploy preflight + status page | 2 | T0 |
| Morning | `G2-Final-FB-07a` lab-pathway FHIR Observation persistence (already-built `ObservationWriter` wiring) | 2 | T0 |
| Midday | `G2-Final-FB-07b` PDF cross-check refusal + eval case | 1 | T0 |
| Afternoon | `G2-Final-FB-01` `agent_step` block + CUI inline strips | 3 | T0 |
| Late afternoon | `G2-Final-FB-04` eval-gate footer badge + endpoint | 1.5 | T1 |
| Evening | Self-injection rehearsal (G2-Final-Rehearsal) | 0.5 | T0 |
| Evening | Smoke test cellular (G2-Final-60) | 0.5 | T0 |

**Day 1 stretch (if time):** `G2-Final-FB-07c` intake-pathway tools + `G2-Final-FB-07d` bulk Confirm.

### Day 2 — Sunday 2026-05-10

| Slot | Item | Hrs | Tier |
|---|---|---|---|
| Early morning | `G2-Final-FB-14` PHI-redaction badge endpoint | 1 | T1 |
| Early morning | `G2-Final-FB-05` workflow polish (drag-and-drop, doc-type detection, progress trace) | 2 | T1 |
| Mid-morning | `G2-Final-FB-07e` audit-trail panel | 1 | T1 |
| Mid-morning | `G2-Final-FB-07f` round-trip integration test | 1 | T1 |
| Mid-morning | `G2-Final-FB-07g` eval cases for persistence path (5 cases, baseline bump) | 1 | T0 |
| Late morning | `G2-Final-FB-16` guided demo mode | 1.5 | T1 |
| Pre-submit | `G2-Final-FB-13` demo video re-record (now with FHIR persistence + agent_step + badges) | 1.5 | T0 |
| Pre-submit | `G2-Final-FB-07-CORPUS` corpus expansion (4 new guideline files + rationale doc) | 1 | T1 |
| Pre-submit | Final pre-submit run-through against `submission.md` §3.1–§3.4 | 1 | T0 |
| Submit | Push, verify CI green, submit URLs through Gauntlet form | 0.5 | T0 |

**Cuts if behind schedule.** In priority order, drop:
1. `G2-Final-FB-16` guided demo mode (T1 — fall back to a static tour gif in the README).
2. `G2-Final-FB-07-CORPUS` corpus expansion (T1 — three guidelines is below ideal but not below the brief minimum).
3. `G2-Final-FB-08` Documents-module integration (T1 — Composer upload path is enough).

**Cannot cut.** Items required for the brief or for the personal feedback to be addressed in any meaningful way:
- `G2-Final-FB-01`, `G2-Final-FB-04`, `G2-Final-FB-07a`/`b`, `G2-Final-FB-07g`, `G2-Final-FB-13`, `G2-Final-FB-15`.

---

## 6. Per-instructor-quote traceability

Every quote from the instructor messages above is mapped to the plan item that addresses it. This is the table the reviewer can use to audit the response.

| Instructor quote (paraphrased) | Plan item(s) |
|---|---|
| Tighten the full end-to-end experience | `G2-Final-FB-05`, `G2-Final-FB-06`, `G2-Final-FB-16` |
| Supervisor / orchestrator routing observable | `G2-Final-FB-01` |
| Hybrid retrieval truly sparse + dense with reranking | `G2-Final-FB-02` (already shipped, surfacing via `FB-01`) |
| Citations reliable and visible | `G2-Final-FB-03` |
| Eval gate meaningful with 50+ grounded cases | `G2-Final-FB-04` (and existing 75-case set) |
| Polish actual physician workflow not just backend | `G2-Final-FB-05` |
| Upload → extraction → persistence → retrieval → grounded response without inferring from repo | `G2-Final-FB-06` + `G2-Final-FB-07` |
| Clinical-guideline corpus = approved practice docs | `G2-Final-FB-07-CORPUS` |
| Patient data → OpenEMR DB as FHIR | `G2-Final-FB-07` (a–g) |
| Find your own corpus, be reasonable + intentful | `G2-Final-FB-07-CORPUS` (rationale doc) |
| Extracted should go somewhere | `G2-Final-FB-07` |
| Upload can be where you feel it fits best | `G2-Final-FB-08` |
| Intake-extractor returns strict-schema JSON | `G2-Final-FB-09` (already shipped, visibility surfacing via `FB-01`) |
| Evidence-retriever uses sparse + dense + rerank with source metadata | `G2-Final-FB-10` (already shipped, surfacing via `FB-01`) |
| Supervisor doesn't have to be the main agent | `G2-Final-FB-11` (already addressed via W2-D6) |
| Proof of where data came from | `G2-Final-FB-12` (already shipped + `FB-07a` `derivedFrom`) |
| Local git hooks are fine | `G2-Final-FB-13` (demo capture) |
| Schema enforcement visibility | `G2-Final-FB-01`, `G2-Final-FB-09` |
| Supervisor routing visibility | `G2-Final-FB-01` |
| Eval coverage visibility | `G2-Final-FB-04` |
| CI execution visibility | `G2-Final-FB-04`, `G2-Final-FB-13` |
| PHI-safe logging behavior visibility | `G2-Final-FB-14` |
| End-to-end persistence flow | `G2-Final-FB-07` |
| Make deployment stable | `G2-Final-FB-15` |
| Tighten walkthrough | `G2-Final-FB-05`, `G2-Final-FB-16` |
| Surface orchestration + validation behavior directly in the product | `G2-Final-FB-01`, `G2-Final-FB-04`, `G2-Final-FB-14` |

---

## 7. What does NOT change

To keep the diff bounded, these existing decisions are explicitly reaffirmed and not revisited:

- **W2-D4** (schema_valid runner imports production schemas) — correct, reaffirmed.
- **W2-D6** (Vercel AI SDK supervisor instead of LangGraph) — correct, reaffirmed.
- **W2-D8** (50 → 75 case rebalance) — correct, the per-category baseline stays as-is until `G2-Final-FB-07g` adds 5 persistence cases (re-pin event with intentional version bump).
- **PSR-3 logging conventions** in [CLAUDE.md](../../../CLAUDE.md) — correct, reaffirmed for all new endpoints in this plan.
- **Existing 3-guideline corpus** — kept as the baseline. `G2-Final-FB-07-CORPUS` adds, doesn't replace.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| FHIR Observation write fails silently in prod (W2-D1's W1 catch-all bug) | `G2-Final-FB-07a` requires the audit row to land before the chat-side success banner; if the write throws, the banner shows red with the exception class (PHI-safe message), not green. |
| Cohere rerank API rate-limit during demo | Cache rerank results for the 7-doc corpus on the same query. Worst case, retries with bare top-N from the union. Surfaced as a warning in the `agent_step` strip. |
| Cohort appointments expire mid-grading window | `G2-Final-FB-15` preflight gates the deploy on `DEMO_WEEKDAY_DATES` validity. |
| Reviewer hits an empty chart | `G2-Final-FB-16` guided demo mode pre-routes to Margaret Chen with sample documents available. |
| Module registrar stale after deploy | `G2-Final-FB-15` preflight runs `agentforge-enable.php` automatically. |

---

## 9. Done definition

This plan is complete when, on the deployed app, an instructor following the URL `https://<deployed>/agentforge/launch?patient=chen&demo=guided` can in 90 seconds:

1. See routing decisions render inline as `agent_step` strips.
2. See schema validation status on the extraction strip.
3. See sparse + dense + rerank funnel stats on the retrieval strip.
4. See FHIR Observations write to the chart (lab) or per-section proposals fire (intake).
5. See citations resolve to verbatim source quotes in PDFs and guideline URLs.
6. See the eval-gate badge in the footer (75/75 green, click expands).
7. See the PHI-redaction badge in the footer (5/5 patterns caught, click expands).
8. See the post-deploy status page green.
9. See the audit trail page list every extraction with `derivedFrom` provenance.

Any gap on the deployed app between this list and what the reviewer experiences is a regression against this plan and must be fixed before submit.
