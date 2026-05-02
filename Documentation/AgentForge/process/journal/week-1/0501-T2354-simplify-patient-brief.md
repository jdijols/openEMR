---
date: 2026-05-01
topic: Simplify auto case presentation brief to three fixed sections
related_milestone: [process/13-gate3-complete.md](../../13-gate3-complete.md)
---

# Simplify patient brief — session journal

## Goal

Replace the SOAP-style LLM-authored case presentation with a **fixed three-section brief**: **Reason for visit** (exact `form_encounter.reason` from today’s encounter as an encounter-linked cite), **Recorded today** (vitals with the same segmented inline citation pattern as before), and **Previous visits** (up to three prior encounters: date as encounter link + short description from LLM grounded on encounter-adjacent context). User also asked for a plan first with clarifying questions, then implementation.

## Context

Gate 3 already ships case presentation via `runCasePresentation`: chart prefetch, one `generateText` call, `verifyClinicalBlocks`, and CUI cite navigation from `source_pack.navigation_hint`. This session narrows what the model may author so headings and current reason are **deterministic** and citations stay trustworthy.

## Key decisions

### Decision: Source for “Reason for visit” and empty sections

- **Prompt:** (Plan-mode choices) Reason = current chief complaint / reason text; always show all three headings with placeholders when data is missing; prior line = visit reason plus notable findings.
- **Recommendation:** Use encounter row `reason` verbatim; use text placeholders (`No reason for visit recorded.`, `None recorded today.`, `No previous visits found.`) where applicable so the rail shape is stable.
- **Outcome:** Implemented in [`agentforge/api/src/agent/case_presentation_format.ts`](../../../../../agentforge/api/src/agent/case_presentation_format.ts) (`buildSimplifiedCasePresentationBlocks`).

### Decision: Deterministic shell + narrow LLM for prior lines only

- **Prompt:** Implement the attached plan: fixed headings in code; LLM only for short prior-visit descriptions; merge JSON; keep verification.
- **Recommendation:** Stop passing the full `bundleForLlm` into the summary prompt; send a small `previous_visits` array (encounter id/date/reason plus filtered notes/vitals/labs slices). Assemble final `ChatBlock[]` in TypeScript after parsing `{"previous_visits":[{"citation_uuid","summary"}]}`.
- **Outcome:** [`agentforge/api/src/agent/case_presentation.ts`](../../../../../agentforge/api/src/agent/case_presentation.ts) + [`agentforge/api/src/agent/case_presentation_prompt.ts`](../../../../../agentforge/api/src/agent/case_presentation_prompt.ts) (`CASE_PRESENTATION_PRIOR_VISIT_SUMMARY_PROMPT`). Invalid or missing summary JSON falls back to encounter reason / category text.

### Decision: “Recorded today” = vitals panels for calendar today

- **Prompt:** Plan: “same information as under Objective,” inline cites.
- **Recommendation:** Context service exposes structured vitals rows with `source_pack`; objective also historically included labs — this implementation documents **today’s vitals rows only** for the second section to avoid inventing labs layout; placeholder when none.
- **Outcome:** `todayVitalsBlocks` in `case_presentation_format.ts`. Extending to same-day labs would be a small follow-up if product wants parity with old “Objective” bullet.

### Decision: Tests and verification commands

- **Prompt:** Complete plan todos including targeted tests.
- **Recommendation:** Rewrite `case_presentation` tests for the new blocks, headings, cite segments, cap of three priors, and prompt shape; keep cache / coalesce / encounter-keyed cache scenarios meaningful.
- **Outcome:** [`agentforge/api/test/agent/case_presentation.test.ts`](../../../../../agentforge/api/test/agent/case_presentation.test.ts). Ran:

  `npm --prefix agentforge/api test -- --run test/agent/case_presentation.test.ts`

  `npm --prefix agentforge/api test -- --run test/agent/verification.test.ts test/agent/orchestrator.test.ts`

  Full `npm --prefix agentforge/api run typecheck` still reported **pre-existing** errors in other test files (`RequestInfo`, `never.query`) — not introduced by this brief work.

## Trade-offs and alternatives

- **Full LLM brief** — Rejected: headings and exact encounter reason would drift and complicate verification.
- **No LLM when zero prior visits** — Deferred: current path still calls `generateText` (empty `previous_visits` list); could skip for latency/cost later.

## Tools, dependencies, commands

- `TZ=America/Chicago date +"%m%d-T%H%M"` — journal filename prefix for this entry (`0501-T2354`).
- `npm --prefix agentforge/api test -- --run test/agent/case_presentation.test.ts`
- `npm --prefix agentforge/api test -- --run test/agent/verification.test.ts test/agent/orchestrator.test.ts`
- `npm --prefix agentforge/api run typecheck` — fails on unrelated tests (see Outcomes).

## Files touched

- **Created:** `agentforge/api/src/agent/case_presentation_format.ts`
- **Modified:** `agentforge/api/src/agent/case_presentation.ts`
- **Modified:** `agentforge/api/src/agent/case_presentation_prompt.ts`
- **Modified:** `agentforge/api/test/agent/case_presentation.test.ts`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0501-T2354-simplify-patient-brief.md` (this entry)

## Outcomes

The auto brief is now **three Markdown headings** with **deterministic** reason and vitals blocks, **encounter-linked** reason and prior dates, and **LLM-authored blurbs** only for prior-visit lines (with deterministic fallback). Targeted Vitest suites for case presentation, verification, and orchestrator pass. Repo-wide API `tsc` on tests still has unrelated failures outside these files.

## Next steps

- [ ] Optionally add **today’s labs** (or other objective rows) under **Recorded today** with the same cite-segment pattern if product wants parity with the old Objective section.
- [ ] Consider **skipping `generateText`** when `previous_visits` is empty to save cost/latency.
- [ ] Repair or narrow **`agentforge/api` typecheck** so unrelated test globals don’t block clean `tsc` (separate hygiene pass).

## Links

- Numbered milestone: [process/13-gate3-complete.md](../../13-gate3-complete.md)

