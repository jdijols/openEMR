---
date: 2026-05-07
topic: W2 eval suite rebalance 50 → 75 (G2-Final-15) + cohort grounding + doc reconciliation
related_milestone: process/milestones/week-2/04-g2-early-gate-completion.md
---

# W2 eval suite rebalance 50 → 75 (G2-Final-15) — session journal

## Goal

Jason's opening prompt: *"So I want to address our evals for week 2. The project brief and the task list say 50 evals. However, we had 39 existing ones from the previous weeks' requirements. I understand the current week's requirements as 50 new eval cases. ... If I'm misunderstanding something or not describing things accurately, please push back and offer your perspective."* The session became an alignment dialogue first, then a build pass once we agreed on Option B (rebalance toward §11 target depth, not 50 net-new).

## Context

Built directly on the G2-Early gate completion captured in [`0506-T2150`](0506-T2150-w2-session-wrap-and-handoff.md). G2-Early had shipped 50 cases satisfying the brief's literal "50-case golden set" requirement, but composition came in skewed — the 35 W1 deterministic refusal-rule cases all naturally bucketed under `safe_refusal`, while the three new W2 categories (`schema_valid`, `citation_present`, `no_phi_in_logs`) shipped lean (4/4/3 against §11 targets of 10/10/8). The asymmetry was already noted in [`W2_ARCHITECTURE.md §11`](../../../../W2_ARCHITECTURE.md) and in the [`0506-T1739`](0506-T1739-g2-early-eval-gate-supervisor-langfuse.md) journal, but had been left as "correct from a regression-detection standpoint" because small categories trip the 95% absolute floor on a single failure. The brief's hard-gate proof (G2-Early-42 self-injection rehearsal) had already verified end-to-end on the small categories.

The threshold logic was fine. The risk that surfaced in tonight's dialogue was **coverage thinness**: a regression that breaks a path no case exercises (multi-result lab panels, PNG image source, qualitative results, intake-form citations, openemr_record citations, distinct PHI deny-list patterns) wouldn't trip the gate at all because nothing in the suite walks that path. The grader's regression-injection probe is designed to land in real worker code; if the worker breaks but the eval suite never exercises the broken path, the gate stays green and the W2 build does not pass.

## Key decisions

### Decision: push back on "50 new" — the brief target is 50 total, we already have 50

- **Prompt:** Jason's framing was "50 NEW eval cases" on top of W1's 39, totaling 89. He explicitly invited push-back: *"If I'm misunderstanding something or not describing things accurately, please push back and offer your perspective."*
- **Recommendation:** The W2 brief PDF (Stage 4, Core req #6) says "**50-case golden set**" / "**50 synthetic or demo cases**" — no "new" or "additional" language. The G2-Early-34/35 rows in [`TASKS.md`](../../../../TASKS.md) executed exactly this strategy: re-tag 39 W1 cases under W2 categories, then add 11 new W2 cases to reach 50 total. The eval gate was already green at 50/50 with all 5 categories populated and a successful self-injection rehearsal.
- **Outcome:** Jason accepted the push-back and pivoted to the real coverage gap.

### Decision: Option B — rebalance toward §11 target depth (not 50 net-new), 25 new cases

- **Prompt:** *"Yeah, I think that makes sense on option B. I'm perfectly fine with balancing and adding more without going overboard. The new cases should be oriented around the new cohort patients that we've added and the data file types that we're testing and potentially asking questions about. ... Formulate a well-rounded suite of evals here that a gauntlet instructor would potentially ask me about or review."*
- **Recommendation:** Add ~25 cases targeted at the §11 per-category gaps, every cohort patient (Chen, Whitaker, Reyes, Kowalski) explicitly exercised with their real W2 fixture documents, plus a few synthetic edge fixtures for paths the cohort docs don't naturally hit (multi-result panels, qualitative values, schema constraints). Don't add 50 net-new — that's belt-and-suspenders padding. Lift `schema_valid` 4 → 10, `citation_present` 4 → 10, `factually_consistent` 4 → 12, `no_phi_in_logs` 3 → 8. Hold `safe_refusal` at 35 (trimming W1 cases would lose existing coverage). Final composition `10/10/12/35/8` = 75 total, hitting §11 target on 4 of 5 categories.
- **Outcome:** Built 25 new case files in 4 batches matching the proposed plan exactly. `npm run eval` reports `cases:75 failures:0 gate_breaches_count:0` with all 5 categories at pass_rate 1.0. Total runtime 12 ms — sub-second, well under the §11 30s budget. See "Files touched" below for the full case-id list.

### Decision: don't add a new W2-native factually_consistent rule — re-frame existing W1 rules with cohort context

- **Prompt:** Open question from the planning round: *"If a Gauntlet reviewer prefers one new W2-native rule (e.g., `cross_check_status_required` enforcing the §10 'unverified facts not persisted' rule), I'd build the rule + 4 cases for it instead of #13–16."* Jason: *"On your two questions, just use your best judgment."*
- **Recommendation:** Keep using the existing 3 factually_consistent W1 rules (`vitals_parser_uncertain_not_guess`, `negative_claim_requires_empty_query`, `conflicting_medication_records_warned`) and re-frame the cases with W2 cohort context (Whitaker AFib BP, Reyes T2DM temp, Kowalski RUQ pulse, Chen multi-BP, Whitaker warfarin, Kowalski statin, Reyes allergies, Chen family history). Adding a new runner rule under deadline adds rule-implementation + tests + risk; the W1 rules are general enough to apply across W2 patients (the rule logic is "agent must not hallucinate / silently pick / claim-without-query" — patient-agnostic). The narrative "this case is about Chen's statin question" lives in `use_case` text, not in the rule's context shape. This matches Jason's *"don't need to be super rigid based on what we completed in week one"* reading.
- **Outcome:** All 8 new factually_consistent cases use existing rules with explicit cohort framing (filename prefix `w2-fc-{patient}-...`). Per-rule counts updated: `vitals_parser_uncertain_not_guess` 1 → 5, `negative_claim_requires_empty_query` 2 → 4, `conflicting_medication_records_warned` 1 → 3.

### Decision: re-pin baseline at `w2-final-rebalance-2026-05-06`, not a new schema or new gate logic

- **Prompt:** Open question from the planning round: *"With composition shifting (3 → 8 in `no_phi_in_logs`, etc.), [agentforge/api/eval/baseline.json] needs to re-pin at the new per-category counts. ... Is that OK or do you want me to keep the same baseline name?"* Jason: *"Just use your best judgment."*
- **Recommendation:** Bump the version string to `w2-final-rebalance-2026-05-06` (matches the date the underlying composition decision was authorized; the rebalance lands 2026-05-07) and update each per-category `case_count`. Don't change the baseline JSON shape. Don't change the gate logic constants (`W2_GATE_ABSOLUTE_FLOOR=0.95`, `W2_GATE_REGRESSION_PP=0.05`). The G2-Early-42 hard-gate rehearsal already proved the gate logic correct; the new larger case counts make small-category regressions LESS sensitive (8 cases means one failure is 12.5pp drop instead of 33pp), but still well past the 5pp regression cap and the 95% absolute floor. The gate fires correctly on the new composition.
- **Outcome:** [`agentforge/api/eval/baseline.json`](../../../../agentforge/api/eval/baseline.json) updated with new version + per-category counts + a `description` field explaining the rebalance rationale for future audit-trail readers. The example baseline JSON in [`W2_ARCHITECTURE.md §11`](../../../../W2_ARCHITECTURE.md) was also updated to match the actual file shape (`per_category` not `categories`, `case_count` not `n`).

### Decision: cohort-grounded case-ids — every patient + document type explicitly exercised

- **Prompt:** *"The new cases should be oriented around the new cohort patients that we've added and the data file types that we're testing."*
- **Recommendation:** Match each new schema_valid + factually_consistent case to a specific cohort patient where the patient's real W2 fixture exercises the path. Use synthetic edges only where the cohort docs don't naturally hit the constraint (e.g., qualitative urinalysis values, pages_processed=0, abnormal_flag enum drift). Each case-id encodes the cohort patient and the constraint, so a reviewer reading the file list can map cases to fixtures at a glance.
- **Outcome:** Final cohort distribution across the 25 new cases:
  - **Chen (Margaret):** lipid panel + intake context → `w2-citation-present-chen-intake-claims-pass`, `w2-citation-present-chen-statin-mixed-pass`, `w2-fc-chen-multiple-bp-readings-not-silent-pick`, `w2-fc-chen-family-history-negative-claim-empty-query`
  - **Whitaker (James):** CBC + AFib + warfarin → `w2-schema-valid-whitaker-cbc-multi-result-pass`, `w2-fc-whitaker-bp-only-diastolic-uncertain`, `w2-fc-whitaker-warfarin-strength-mismatch-warned`
  - **Reyes (Sofia):** HbA1c PNG + T2DM → `w2-schema-valid-reyes-hba1c-image-no-bbox-pass`, `w2-fc-reyes-temp-unit-ambiguous-uncertain`, `w2-fc-reyes-allergies-negative-claim-empty-query`
  - **Kowalski (Robert):** CMP + statin discontinuation + RUQ → `w2-fc-kowalski-pulse-zero-not-guess`, `w2-fc-kowalski-statin-discontinued-vs-intake-active`
  - **Synthetic edges (constraint-targeted):** qualitative UA values, pages_processed=0, abnormal_flag out-of-enum, intake all-arrays-empty, 5 distinct PHI deny-list patterns (SSN, DOB-ISO, DOB-US, phone, email), citation contract edges (empty quote, confidence>1, bbox 3-element, openemr_record source).

## Trade-offs and alternatives

- **Hold at 50 (Option A) — defensible (brief-literal, gate green, rehearsal passed)** — rejected because coverage thinness was the real risk to the brief's hard-gate regression-injection probe; the gate's threshold logic isn't the limiting factor.
- **Pad to 89 cases by adding 50 net-new (Option C — Jason's initial framing)** — rejected because most of those new cases would be redundant with the 35 existing safe_refusal cases; the high-leverage work is rebalancing the W2-introduced categories, not stacking more refusals.
- **Build a new W2-native `cross_check_status_required` factually_consistent rule** — rejected for tonight in favor of re-framing existing W1 rules with cohort context; the W1 rules are general enough that the cohort framing in `use_case` text is sufficient. Could revisit post-W2 if a Gauntlet reviewer specifically asks about the §10 cross_check_status enforcement.
- **Trim safe_refusal from 35 to the §11 target of 10** — rejected because all 35 cases are W1 deterministic refusal rules; trimming would lose existing W1 coverage that the X-03 cross-cutting invariant explicitly preserves.

## Tools, dependencies, commands

_Existing toolchain only — no new dependencies._

- `npm install` (inline `cd agentforge/api && npm install` per memory: installs in agentforge subdirs leak into the root `package.json` without explicit `cd` in the Bash command itself) — `node_modules` was missing in this fresh worktree
- `npm run eval` (= `tsx eval/runner.ts`) — verification command; reports `cases:75, failures:0, duration_ms:12, gate_breaches_count:0`
- One-line bash audits across `Documentation/AgentForge/`, `W2_ARCHITECTURE.md`, `TASKS.md`, `Documentation/AgentForge/submission.md`, and the root `README.md` to find any stale `50.case` or `w2-early-2026-05-06` references that needed reconciliation

## Files touched

**Created (26):**

- 6 schema_valid case files: `agentforge/api/eval/cases/curated/w2-schema-valid-{whitaker-cbc-multi-result-pass, reyes-hba1c-image-no-bbox-pass, lab-non-numeric-value-pass, lab-pages-processed-zero-rejected, lab-abnormal-flag-out-of-enum-rejected, intake-all-arrays-empty-pass}.json`
- 6 citation_present case files: `agentforge/api/eval/cases/curated/w2-citation-present-{chen-intake-claims-pass, chen-statin-mixed-pass, quote-empty-string-rejected, confidence-above-one-rejected, bbox-three-element-rejected, openemr-record-source-pass}.json`
- 8 factually_consistent cohort-framed case files: `agentforge/api/eval/cases/curated/w2-fc-{whitaker-bp-only-diastolic-uncertain, reyes-temp-unit-ambiguous-uncertain, kowalski-pulse-zero-not-guess, chen-multiple-bp-readings-not-silent-pick, whitaker-warfarin-strength-mismatch-warned, kowalski-statin-discontinued-vs-intake-active, reyes-allergies-negative-claim-empty-query, chen-family-history-negative-claim-empty-query}.json`
- 5 no_phi_in_logs case files: `agentforge/api/eval/cases/curated/w2-no-phi-{ssn, dob-iso, dob-us, phone, email}-leak-fail.json`
- This journal entry: `Documentation/AgentForge/process/journal/week-2/0507-T0029-w2-eval-rebalance-50-to-75.md`

**Modified (4):**

- [`agentforge/api/eval/baseline.json`](../../../../agentforge/api/eval/baseline.json) — version bumped to `w2-final-rebalance-2026-05-06`, per-category `case_count` updated to 10/10/12/35/8, `description` field added with rebalance rationale
- [`W2_ARCHITECTURE.md`](../../../../W2_ARCHITECTURE.md) — §11 composition heading + table + asymmetry note rewritten as "75-case composition (Final rebalance, 2026-05-07)" + rebalance note; example baseline JSON updated to actual file shape; executive summary "expands to 50 cases" → "expands to 75 cases" with footnote; for-instructors decisions row "50 cases × 5 boolean rubrics" → "75 cases × 5 boolean rubrics"; submission-bundle line "50-case eval dataset" → "75-case eval dataset (50 brief-target + 25 G2-Final rebalance)"; G2-Early scope bullet updated to reflect Final-pass rebalance
- [`TASKS.md`](../../../../TASKS.md) — new G2-Final-15 row inserted between G2-Final-12 and G2-Final-Rehearsal documenting the rebalance with full case-id list and verification proof; X-03 cross-cutting "50-case suite" → "75-case suite (50 G2-Early + 25 G2-Final-15 rebalance)"; G2-Final scope-map row updated to mention G2-Final-15
- [`Documentation/AgentForge/submission.md`](../../../submission.md) — Eval Dataset deliverable row updated (75/75 cases, new baseline version, new latest-run numbers); artifact link "W2 Eval cases (50)" → "W2 Eval cases (75)"; pre-submit checklist "Eval suite 50/50 green" → "75/75 green" + new baseline version; new W2-D8 resolution row added documenting the rebalance decision (and explicitly noting it supersedes W2-D3)

## Outcomes

- **75/75 eval cases pass on a clean tree.** All 5 rubric categories at pass_rate 1.0; `gate_breaches_count: 0`; baseline `w2-final-rebalance-2026-05-06`. Per-category composition `10/10/12/35/8` hits the §11 per-category target on 4 of 5 categories (`safe_refusal` held at 35 by design).
- **Every cohort patient now exercised in the suite.** Chen (4 cases), Whitaker (3), Reyes (3), Kowalski (2) — plus synthetic edges for the constraint-targeted paths the cohort fixtures don't naturally hit.
- **Coverage gaps closed.** Multi-result lab panels (Whitaker CBC), PNG image source with no bbox (Reyes HbA1c), qualitative non-numeric lab values, mixed extraction+guideline claims (Chen statin), 5 distinct PHI deny-list patterns (was 1: MRN; now 6: MRN + SSN + DOB-ISO + DOB-US + phone + email + cohort_full_name), schema constraints (`pages_processed` positive, `abnormal_flag` enum, bbox arity, confidence range, empty quote), `intake_form` and `openemr_record` citation source types (was uncovered).
- **Audit trail intact for AI Interview defense.** The original W2-D3 asymmetry decision in [`submission.md`](../../../submission.md) is preserved as historical context; the new W2-D8 row supersedes it and points back to it. TASKS.md G2-Early-35 row remains historical (50 cases at G2-Early); G2-Final-15 row is the new source-of-truth for the 75-case state.
- **Gate logic unchanged.** Same `W2_GATE_ABSOLUTE_FLOOR=0.95` + `W2_GATE_REGRESSION_PP=0.05`. The G2-Early-42 hard-gate rehearsal evidence is still load-bearing — the rebalance only changed case counts and the version string.

## Next steps

- [ ] Push to both remotes (`gitlab`, `origin`) — included in this session per Jason's directive
- [ ] G2-Final-Rehearsal — Saturday self-injection 5-scenario rehearsal can pick a different PHI deny-list pattern this time (5 new patterns now covered vs the original 1) so the dry-run exercises a path the previous rehearsal hadn't hit
- [ ] All previously-listed G2-Final operator items remain unchanged (deploy, demo video, cellular smoke, https, submission)

## Links

- Brief: [Week 2 - AgentForge Clinical Co-Pilot.pdf](../../../references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
- W2 Architecture: [W2_ARCHITECTURE.md](../../../../W2_ARCHITECTURE.md) (§11 "75-case composition")
- W2 Tasks: [TASKS.md](../../../../TASKS.md) (G2-Final-15)
- W2 Submission Scoreboard: [Documentation/AgentForge/submission.md](../../../submission.md) (W2-D8)
- Eval baseline: [agentforge/api/eval/baseline.json](../../../../agentforge/api/eval/baseline.json)
- Eval cases: [agentforge/api/eval/cases/curated/](../../../../agentforge/api/eval/cases/curated/)
- Prior session journal (G2-Early gate completion + composition asymmetry rationale): [0506-T2150-w2-session-wrap-and-handoff.md](0506-T2150-w2-session-wrap-and-handoff.md)
