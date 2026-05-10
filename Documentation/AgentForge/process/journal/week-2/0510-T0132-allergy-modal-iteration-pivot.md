---
date: 2026-05-10
topic: W2 instructor-feedback sweep, hybrid allergy modal build (rounds 1–20), strategic pivot to affordance+queue iteration plan
related_milestone: none
---

# W2 allergy modal build → affordance+queue iteration pivot — session journal

## Goal

Two-phase session. **Phase A** — work the instructor's W2 feedback punch list (eval at 88/88, LLM judge, README, write round-trip). **Phase B** — turn the hybrid agent+manual allergy UX from "kind of works" to bulletproof. Late in the session, **Phase C emerged** — pivot from round-by-round iteration to a written plan that unifies *all* proposal surfaces (vitals, clinical_note, intake bundles, labs) under the affordance+queue pattern, then end the chat and pick up Phase 1 of that plan in a fresh one.

## Context

Instructor reviewed the W2 submission and flagged six items: stale eval-status endpoint serving April data, missing LLM judge with score, broken README links + no W2 section, unverified bbox click-through, FHIR persistence "ideally by Sunday", CI run history showing only W1 cases. Submission deadline 2026-05-10 noon CT. The "FHIR persistence" item became the centerpiece — it's not really FHIR (writes go through OpenEMR's PHP module path), but it *is* the agent → modal → DB → dashboard round-trip. That round-trip is what most of this session built.

## Key decisions

### Decision 1: Hybrid agent + manual modal architecture (foundational)

- **Prompt:** *"Instead of the proposal card, what if the agent on turn two opens up the add allergy pop-up modal and pre-fills in the input fields based on the information it received? It still works like the proposal card, but instead of generating that UI within the chat, it just shows the UI within the dashboard while still inviting via text in the chat to supply more information."*
- **Recommendation:** Build a single `AllergyModal` that operates in two modes off one prop (`proposalId?`): manual `+` add (no proposal until Save) and agent-driven (proposal exists, modal binds via GET + SSE). The proposal payload in Postgres is the single source of truth — both the modal and the agent's `update_proposal` tool PATCH the same row, so manual edits and agent updates merge cleanly. CUI and dashboard coordinate via a same-origin `BroadcastChannel('agentforge-proposals')`. Above the composer in the CUI: a persistent "Save new allergy ✓ ✗" affordance pinned to the chat input — same pattern Claude Code uses for permission prompts.
- **Outcome:** Built across rounds 1–20. Server: [agentforge/api/src/conversations/proposal_bus.ts](../../../../../agentforge/api/src/conversations/proposal_bus.ts), 6 new HTTP routes under `/proposals` in [agentforge/api/src/app.ts](../../../../../agentforge/api/src/app.ts). CUI: [agentforge/cui/src/proposals/AboveComposerAffordance.tsx](../../../../../agentforge/cui/src/proposals/AboveComposerAffordance.tsx). Dashboard: [patient-dashboard/src/cards/AllergyModal.tsx](../../../../../patient-dashboard/src/cards/AllergyModal.tsx). Auth: [interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php) extended to mint a launch code on every dashboard load.

### Decision 2: FHIR transform emits `reaction.severity` so granular grade round-trips

- **Prompt:** *"Change the severity options to: Unassigned, Mild, Moderate, Severe, Fatal. Also, inside of the allergy card, each allergy has a badge that seems to be linked to the severity level. However, the text in the badge says 'low' or 'high'."*
- **Recommendation:** OpenEMR's FHIR encoder maps `severity_al` → FHIR `criticality` (only `low` / `high` / `unable-to-assess`), collapsing the eight underlying option_ids into three buckets — so "Fatal" or "Mild to moderate" cannot survive a write→read round-trip. Modified [src/Services/FHIR/FhirAllergyIntoleranceService.php:192](../../../../../src/Services/FHIR/FhirAllergyIntoleranceService.php) to also emit `reaction[0].severity` carrying the raw `severity_al` option_id alongside the spec-mandated criticality. Dashboard's `severityLabel` prefers `reaction[0].severity` and only falls back to criticality for legacy rows.
- **Outcome:** Round 7. The badge "Mild" / "Moderate" / "Severe" / "Fatal" / "Unassigned" labels physicians choose now persist exactly through the round-trip. Coarse FHIR criticality is still emitted for spec-compliant external consumers — the granular value is additive.

### Decision 3: Substance editable in update mode — `update_substance` action threaded everywhere

- **Prompt:** *"Why can't I edit the substance name for the allergy? It prevents us from doing so, whereas in the Legacy system I am able to update the substance name of an allergy after it's already been added to the database."*
- **Recommendation:** Locking substance was wrong — the legacy `Add/Edit Issue` form lets you change the title; we should match. Added a new `update_substance` action threaded through five files: Zod allergy schema (`agentforge/api/src/tools/propose_writes.ts`), PHP `ACTIONS` allowlist + `parse()` validation in [AllergyWritePayload.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/AllergyWritePayload.php), match arm in [AllergyWriteAction.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/AllergyWriteAction.php) dispatching to `updateAllergy(['title' => ...])`, dashboard `AllergyAction` type, and modal `handleSave` change-detection (now diffs substance / reaction / severity and submits up to three sequential proposals when multiple fields change in one Save).
- **Outcome:** Round 15. The schema and PHP ACTIONS list now have four allergy actions (`add` / `update_substance` / `update_reaction` / `update_severity`). Modal correctly surfaces the substance as editable in click-to-edit, capitalizes on save (round 17), and dispatches up to three writes for multi-field saves.

### Decision 4: Storage-boundary normalization — substance, reaction, severity

- **Prompt (substance):** *"always capitalize the first letter in the substance text"* + **(reaction):** *"the agent didn't identify the shortness of breath that I mentioned as the reaction"* + **(severity):** *"unassigned and fatal come back with an HTTP/400 error"*
- **Recommendation:** Three layered normalizations to keep the agent's free-form dictation, the manual modal's typed input, and the PHP allowlist all consistent. (1) `normalizeSubstance()` in `propose_writes.ts` trims + capitalizes the first character; modal mirrors via `capitalizeFirst()` on Save; AllergiesCard `nameOf` capitalizes on display as a defensive fallback for legacy data. (2) `normalizeReactionToOptionId()` maps "shortness of breath" / "SOB" / "dyspnea" / "rash" → controlled `list_options` ids (`hives` / `nausea` / `shortness_of_breath` / `other`). (3) PHP `SEVERITY_TO_OPTION_ID` and (new) `REACTION_TO_OPTION_ID` allowlist maps extended to accept both the controlled vocabulary and the legacy PRD aliases. Added a real `('reaction', 'other', 'Other')` row to `list_options` so the FHIR LEFT JOIN actually resolves on read-back.
- **Outcome:** Rounds 9, 11, 16, 17. The agent's natural-language reactions now land as canonical option_ids; the PHP write surface accepts everything the modal can produce; legacy lowercase substances render capitalized in the dashboard. The full add → edit → re-edit → save → re-open round-trip works for every (substance, reaction, severity) combination.

### Decision 5: Suppress in-chat proposal card for allergy (then plan to extend universally)

- **Prompt:** *"All the data the extractor was able to pull, none of it shows up in our new dashboard as well... the modal to save a new allergy produced an error... we have to figure this out and create a better experience: 1. so that the AI can actually fill in the correct information 2. so that the chat experience can be intuitive"*
- **Recommendation:** Two surfaces showing the same Confirm/Reject pair (in-chat proposal card + above-composer affordance, both pointing at the same `proposal_id`) is confusing. Suppress the in-chat card for `write_target === 'allergy'` — the dashboard modal + above-composer affordance own the action for allergy. Other write targets (vitals, clinical_note, etc.) keep the in-chat card *for now*; the iteration plan extends this universally.
- **Outcome:** Round 16. [agentforge/cui/src/chat/MessageList.tsx](../../../../../agentforge/cui/src/chat/MessageList.tsx) `case 'proposal'` returns a Fragment when `write_target === 'allergy'`. Round 20 added the `proposal:resolved` BroadcastChannel event so the dashboard's Save dismisses the CUI's affordance even though the CUI never ran the confirm path itself.

### Decision 6: Strategic pivot — stop iterating, write a unified affordance+queue plan, end chat, restart fresh

- **Prompt:** *"I no longer want to have proposal cards that are in line with chat messages. I want to treat them separately. We have to really consider how this affects any downstream logic that we have already built so we don't break anything... I think thorough research on proposal cards and how they're generated and how they write to databases is really needed to come up with the most bulletproof plan here."*
- **Recommendation:** Round-by-round iteration was the right tactic for getting the allergy round-trip bulletproof, but extending the same pattern to vitals + clinical_notes + chief_complaint + tobacco + intake bundles is a real refactor that needs a written plan, not more rounds. Stopped coding. Researched the existing proposal pipeline (3 confirm code paths today: `/conversations/:id/confirm`, `/proposals/:id/confirm`, `intake_dispatch.ts`). Drafted a five-phase plan: (1) affordance redesign with `ProposalCardShell` tokens + FIFO queue + counter; (2) suppress in-chat cards universally; (3) modal contract — Confirm/Reject vocabulary, X-close = snooze, body-click reopens modal (or navigates to encounter for modal-less targets); (4) intake/lab become single bundle proposals with auto-opening review modal + per-section selectivity ("Confirm 7 of 10"); (5) per-target dashboard modals deferred. Wrote the plan as a self-contained doc so a fresh chat can pick up Phase 1 cold. Decided to end this chat after the plan lands.
- **Outcome:** Plan committed to [Documentation/AgentForge/implementation/affordance-queue-iteration.md](../../../implementation/affordance-queue-iteration.md). Captures the full decision matrix (X-close = snooze / body-click semantics / FIFO + counter / bundle confirm-N-of-M / disabled-button matrix / per-target preview format spec), current vs target architecture, files in scope, per-phase acceptance criteria, risk register, and references back to the rounds 11–20 history.

## Trade-offs and alternatives

- **Editable proposal cards in chat** — user rejected outright ("we tried it, didn't like it"). Cards are read-only previews; modifications happen through additional dictation turns or the modal.
- **Single combined `update` action** vs per-field `update_reaction` / `update_severity` / `update_substance` — kept per-field actions for backward compat with the eval suite (existing test cases reference `update_reaction` specifically) and the existing PHP write surface. Multi-field saves issue sequential proposals client-side.
- **Decompose intake form into ~12 individual affordances** (one per write target row) vs **bundle as one affordance** — bundled. 12 confirm clicks for one intake form is worse UX than one Confirm All with per-section selectivity in a review modal.
- **Server-side substance backfill** (FHIR call from agentforge-api) vs **dashboard-side react-query cache lookup** — dashboard-side. The AllergiesCard already loads the FHIR bundle; modal reads from `queryClient.getQueriesData(...)` (round 18). Avoids an extra HTTP roundtrip in the propose-tool latency path.
- **Different button labels in modal vs affordance** (Save/Cancel + Confirm/Reject) — rejected. One vocabulary across surfaces; standardized on `Confirm` / `Reject`. The X-close in the modal is "snooze," not "Cancel".
- **X-close = Reject** vs **X-close = snooze** — picked snooze after pushback. X-close + click-outside-modal both leave the proposal `pending` so the affordance stays in the queue; clicking the affordance body re-opens the modal pre-populated.

## Tools, dependencies, commands

- Many `npm run typecheck`, `npm run test`, `npm run build`, `npm run eval` cycles across `agentforge/api`, `agentforge/cui`, `patient-dashboard`. Eval stayed at 88/88 throughout.
- `docker exec development-easy-mysql-1 mariadb -uroot -proot openemr -e "..."` — direct DB inspection (rounds 11, 14, 19).
- `INSERT IGNORE INTO list_options (...) VALUES ('reaction', 'other', 'Other', 50, ...)` — added the "Other" reaction option_id so the FHIR LEFT JOIN resolves.
- `EVAL_RUN_JUDGE=1 npm run eval` — new script invokes the LLM judge alongside the deterministic checks.
- No new npm dependencies. No skill changes.

## Files touched

Highlights only — actual change set spans ~30 files. Full diff is in `git status`.

- **Created:**
  - `agentforge/api/eval/judge/{prompt.md,model.json,judge.ts}` — LLM judge module (claude-sonnet-4-6, prompt v1-2026-05-09)
  - `agentforge/api/test/eval/judge.test.ts`
  - `agentforge/api/src/conversations/proposal_bus.ts` — in-memory pub-sub for SSE
  - `agentforge/api/test/conversations/proposal_bus.test.ts`
  - `agentforge/cui/src/proposals/{proposalBus.ts,AboveComposerAffordance.tsx}`
  - `patient-dashboard/src/cards/AllergyModal.tsx` + tests
  - `patient-dashboard/src/proposals/{proposalsApi.ts,proposalStream.ts,session.ts,proposalBus.ts}`
  - `Documentation/AgentForge/implementation/affordance-queue-iteration.md` ← the plan itself
- **Modified (high-signal):**
  - `agentforge/api/src/app.ts` — six new `/proposals` lifecycle routes
  - `agentforge/api/src/tools/propose_writes.ts` — `update_proposal` tool, normalize helpers, severity enum, allergy schema with `update_substance`
  - `agentforge/api/src/agent/system_prompt.ts` — allergy add-vs-update discipline section (round 19)
  - `agentforge/api/src/conversations/{store.ts,apply_pending_write.ts}` — PATCH support, broadcast on confirm/reject
  - `agentforge/api/eval/runner.ts` + 5 stale fixtures patched (the rebalance from 50 → 88 passing)
  - `agentforge/cui/src/App.tsx` — affordance state, queue lookup, `proposal:resolved` subscription
  - `agentforge/cui/src/chat/MessageList.tsx` — suppress in-chat proposal card for allergy
  - `interface/modules/custom_modules/oe-module-agentforge/src/Write/AllergyWriteAction.php` — `update_substance` arm, reaction → reaction column
  - `interface/modules/custom_modules/oe-module-agentforge/src/Write/AllergyWritePayload.php` — extended ACTIONS + SEVERITY_TO_OPTION_ID + new REACTION_TO_OPTION_ID
  - `interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php` — handshake mint + `apiBase` injection
  - `src/Services/FHIR/FhirAllergyIntoleranceService.php` — emit `reaction[0].severity` from `severity_al`
  - `patient-dashboard/src/cards/{AllergiesCard.tsx,AllergyModal.tsx}` — many rounds of polish (dropdown options, hover scope, severity palette, substance backfill)
  - `README.md`, `agentforge/README.md`, `agentforge/api/README.md`, `agentforge/cui/README.md` — W2 pointer block, fixed broken `ARCHITECTURE.md` links
- **DB row added:** `list_options('reaction', 'other', 'Other', seq=50)` — local MariaDB; will propagate via VPS dump-and-import per the existing deploy convention.

## Outcomes

What is now true that was not true at session start:

- Eval suite at **88/88** against the consolidated `w2-consolidated-2026-05-07` baseline, with five W2 categories at 100%, gate breaches 0. LLM judge ships alongside with four committed evaluations (factually_consistent + safe_refusal × 2 each, model `claude-sonnet-4-6`, scores 0.0 / 0.0 / 0.9 / 1.0).
- Hybrid agent+manual allergy round-trip works end-to-end: dictate → modal opens pre-filled → physician edits → Save → MariaDB write → dashboard `AllergyIntoleranceCard` refreshes via `chart:updated` BroadcastChannel. Substance editable, reaction stored as controlled option_id, severity granular grade preserved through FHIR.
- Above-composer affordance dismisses correctly when the dashboard modal saves (round 20's `proposal:resolved` event closed the last gap).
- Iteration plan exists at `Documentation/AgentForge/implementation/affordance-queue-iteration.md`. A fresh chat can pick up Phase 1 (affordance redesign + FIFO queue) without conversational context.

## Next steps

- [ ] Commit the W2 sweep work as a checkpoint (eval rebalance, LLM judge, proposal lifecycle, AllergyModal, dashboard polish, FHIR transform extension).
- [ ] VPS deploy: rebuild `agentforge-api` container so the new `/proposals` routes + system prompt go live; `agentforge-enable.php` post-deploy to refresh the module registrar.
- [ ] Re-record demo video showing: bbox click-through, dictation → allergy modal pre-fill, click-to-edit existing allergy, severity granular round-trip, intake form (still legacy IntakeProposalCard until Phase 4 of the plan).
- [ ] **In a fresh chat:** kick off Phase 1 of the iteration plan — affordance redesign with `ProposalCardShell` tokens, FIFO queue + counter + transition, voice-confirm targets head of queue. The plan doc is self-contained.

## Links

- [affordance-queue-iteration.md](../../../implementation/affordance-queue-iteration.md) — the iteration plan written this session
- [v2-roadmap.md](../../../implementation/v2-roadmap.md) — broader V2 sequencing this plan slots into
- Prior journal: [0509-T2237-w2-card-collapse-and-layout-polish.md](./0509-T2237-w2-card-collapse-and-layout-polish.md)
