---
date: 2026-05-02
topic: Clinical Notes CRUD (read/write/update/delete) + dictation routing rewrite + encounter auto-refresh + vitals formatting + demo-data hygiene + UX polish
related_milestone: none (post-Gate-6 feature push for the Sunday-noon submission)
---

# Clinical Notes CRUD + UX polish — session journal

## Goal

User opened with a plan another agent had drafted for adding Clinical Notes read/write to AgentForge. The real motivating bug: physician dictation was being routed to `propose_chief_complaint_write`, which overwrote the front-desk-entered `form_encounter.reason` field. Anything the physician dictated (e.g., "patient reports chest pain") clobbered the original reason for visit. Goal: stop that, give the agent a proper place to put physician dictation (a clinical note), then read those notes back, then make CRUD complete (update + delete), then make the experience feel right end-to-end before submission.

## Context

Sunday noon CT deadline ~22 hours out at session start. Gate 6 already closed. Existing write surfaces: chief_complaint, vitals, tobacco, allergy. Existing read tools didn't include clinical-note narrative bodies — `get_notes_metadata` only surfaced `DocumentService` rows (uploaded files), not anything from `form_clinical_notes`. Dictation pipeline (CUI mic → AssemblyAI → final transcript → /chat) was already working end-to-end.

## Key decisions

### Decision: critique the inherited plan before building, not after

- **Prompt:** *"Go ahead and review this plan and be critical of it and suggest updates… If there are any gaps that I'm missing, then bubble that up as well."*
- **Recommendation:** Before recommending any cuts to a plan, verify its claims against the codebase. Spawned an Explore agent against 14 specific items the plan referenced (file paths, method names, existence claims). Found the plan got the architecture right but had factual errors: `ChiefComplaintWriteAction` calls `updateEncounterReason()` not generic `updateEncounter()`; `ClinicalNotesService` lacks a "list active for encounter" method (only by-form or by-patient-all). Also flagged real gaps the plan missed: model intent disambiguation, multi-row reads, audit-event distinctness, no policy on append vs new-row writes.
- **Outcome:** Plan revised in the same session. Big architectural decision locked early: **canonical "physician progress note" row per encounter** (`clinical_notes_type='progress_note'`), separate from any existing nursing/intake row. First dictation creates the row, subsequent dictations append with `\n\n` separator. Preserves author attribution (MA's note stays MA's; physician's note stays physician's) and matches the mental model of "the physician is building up their own note as the visit progresses."

### Decision: cut SOAP structure, cut voice-confirm, ship CRUD anyway

- **Prompt (after cost-of-prompt-change pushback):** *"I do think it's possible for us to complete this before the deadline."*
- **Recommendation:** I initially recommended Phase 1 (read) only by deadline, deferring writes. User pushed back — the real harm is the chief_complaint mis-routing, not the absence of new writes. Reframed: implement Phase 1 + 2 (read + write) but cut prompt-engineering risk by dropping SOAP section formatting, dropping voice-confirm flow handling, dropping the internal `chief_complaint → encounter_reason` rename. UI label change ("Reason for visit") + system-prompt routing rule covers the user-visible distinction without a code rename.
- **Outcome:** Reads + writes shipped same session. Then user asked for full CRUD (update + delete), which followed the same pattern as the write — added in a second pass.

### Decision: edit + delete via single tool with action enum, two write_targets

- **Prompt:** *"Is it reasonable for us to have a full CRUD workflow?… we should also have the ability to update any specific lines in the clinical notes… as well as delete any critical notes."*
- **Recommendation:** Mirror the existing `propose_allergy_write` pattern (action-discriminated). One tool, one PHP endpoint, one action class with internal dispatch. But split the `write_target` string by action (`clinical_note_update` vs `clinical_note_delete`) so the proposal-card chip in the rail can clearly say "Update note" vs "Delete note" — destructive operations need a different visual signal than editorial ones, even when they share the backend.
- **Outcome:** [propose_writes.ts](../../../../../agentforge/api/src/tools/propose_writes.ts) `propose_clinical_note_edit` with `action: 'update' | 'delete'` enum; [ClinicalNoteEditAction.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteEditAction.php) dispatches by payload action; [apply_pending_write.ts](../../../../../agentforge/api/src/conversations/apply_pending_write.ts) maps both `clinical_note_update` and `clinical_note_delete` write_targets to the same endpoint. Delete is **soft-delete** (`activity = 0`) — the row stays in the DB for audit/compliance, hidden from active chart view. Matches medical-record norms; the model's spontaneous safety response ("Clinical notes are part of the permanent medical record and are typically protected from deletion") was clinically correct in spirit but soft-delete satisfies both the audit requirement and the demo's "I made a typo" use case.

### Decision: prompt-side fixes for output structure are fragile — moved to deterministic UI

- **Prompt:** *"There is the duplicate text that appears there… I think we need some type of deterministic logic that says whenever a proposed change or approval card is presented, no other agent response should be attached to it."*
- **Recommendation:** Initially tried a system-prompt rule — "do NOT also emit a text or claim block that restates the proposal preview." It worked for proposal duplicates but caused two regressions in unrelated queries: (1) the model started producing Markdown prose with embedded JSON-claim fragments instead of clean `{"blocks":[...]}` envelopes, breaking parser recovery; (2) `insufficient_evidence_after_verification` fires on responses that didn't trip it before. Reverted the rule entirely. Implemented suppression in [MessageList.tsx](../../../../../agentforge/cui/src/chat/MessageList.tsx) `suppressDuplicateProposalNarration`: if any proposal block exists in the message, drop all text/claim blocks (warnings/refusals/tool blocks preserved). Single-line check, deterministic, can't break the agent's response shape.
- **Outcome:** Confirmed working in subsequent rounds. **Generalizable lesson:** prompt-side rules about *output structure* are uniquely fragile because they compete with the model's structural training. Prompt-side rules about *behavior* (routing, tool selection) are safer because they augment rather than constrain the structured output.

### Decision: routing for declarative statements requires explicit "no verification first" rule

- **Prompt:** *"if I do not include the word patient, it doesn't register that this should be something that goes into a clinical note."*
- **Recommendation:** The model treated brief observational statements ("A1C is low", "asthma symptoms are improving") as ambiguous — possibly a question? possibly something to verify against chart data? — and either tried to fetch labs first or asked "would you like me to add this?". Strengthened the dictation routing rule with three layers: (1) "the word 'patient' is NOT required; the physician is in the room with the patient and is dictating about THIS patient by default"; (2) explicit examples covering brief/telegraphic input ("A1c low", "fever resolved", "no chest pain"); (3) "Do NOT verify the statement against chart data before writing. Do NOT call get_labs/get_vitals/get_clinical_notes just to 'check' the dictation."
- **Outcome:** Verified by user — "A1C is low" now routes directly to a clinical-note proposal card.

### Decision: tool-invocation discipline must be explicit for destructive ops

- **Prompt (observing the bug):** *"For the crud update, it did populate text to seem to want to execute my ask. However, it should have populated another proposal card with the confirm or reject options instead."*
- **Recommendation:** The model was *narrating* delete/update proposals in prose ("Proposal: Update progress note (UUID a1af8bde…) / Current text: … / Proposed replacement: … / Confirm to proceed? (Y/N)") instead of calling `propose_clinical_note_edit`. The tool was correctly registered (verified via the orchestrator's `...proposeBundle` spread) — the model was being defensive about destructive operations and inventing its own chat-confirmation pattern. Added a prompt rule "Tool invocation discipline" applying to ALL `propose_*_write` tools: "Calling the tool causes the rail UI to render a Proposed Change card with Confirm and Reject buttons; that card IS the confirmation surface. You MUST NOT write the proposal preview as prose, markdown, 'Proposal:' headers, 'Current text / Proposed replacement' comparisons, 'Y/N' prompts… This applies equally to destructive operations (delete) and editorial ones (update). Do NOT add a chat confirmation step before calling the tool because the operation feels destructive — the UI already requires a Confirm click."
- **Outcome:** Model now invokes the tool directly. Confirmed via screenshots.

### Decision: encounter-view auto-refresh — postMessage + frame-tree walk

- **Prompt:** *"is it fairly easy on confirming a proposal to then also trigger a refresh of the current open encounter's summary (openEMR UI)…?"*
- **Recommendation:** First implementation called `window.top.refreshVisitDisplay()` from the rail container. Failed silently because of an iframe-hierarchy mistake on my end: I assumed the rail container was loaded inside `encounter_top.php`, but [Bootstrap.php:36](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php) injects it directly into `main.php`'s body via `EVENT_BODY_RENDER_POST`. So `window.top` from the rail = `main.php`, which doesn't define `refreshVisitDisplay`. That function lives in `encounter_top.php`, loaded as a child frame. Rewrote as `triggerOpenEmrEncounterRefresh()` that recursively walks `window.top.frames` to find the first frame defining `refreshVisitDisplay` — same feature-detection pattern OpenEMR's own [tabs_view_model.js:343](../../../../../interface/main/tabs/js/tabs_view_model.js) uses to discover the encounter frame (it looks for `twAddFrameTab`).
- **Outcome:** Auto-refresh works on every confirmed write. Patient-binding guard (compare `expected_patient_uuid` in the message against the iframe's `data-patient-uuid` attribute) prevents stale messages from a previous chart triggering a refresh on the wrong patient.

### Decision: vitals formatting — server-side, deterministic, in the case-brief assembler

- **Prompt:** *"For all of our vitals… we need to format these numbers better… temperature should always be in degrees Fahrenheit… For weight, it should always be in pounds, rounded to the nearest single pound… height should be in feet and inches."*
- **Recommendation:** OpenEMR stores most vitals as MySQL `DECIMAL` with trailing zeros (`58.000000`, `220.200000`). Two places to format: in the context endpoint ([vitals.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/context/vitals.php)) so the model sees clean numbers, OR in the case-brief assembler ([case_presentation_format.ts](../../../../../agentforge/api/src/agent/case_presentation_format.ts)) where the rail-visible string is built. The case brief is **deterministic server-side rendering** (not LLM-generated prose), so formatting there gives the strongest guarantee: clean output regardless of model behavior, no risk of the LLM rewriting "97.8°F" as "97.8 degrees Fahrenheit". Per-vital formatters: HR/RR/SpO2/Pain integer; Temp 1-decimal + `°F`; Wt integer + ` lb`; Ht feet+inches via `Math.floor(n/12)` and `n % 12`; BMI 1-decimal; BP integers (no decimals).
- **Outcome:** `Vitals: BP 132/80, HR 58, RR 20, Temp 97.8°F, SpO2 98%, Wt 220 lb, Ht 5'10", BMI 31.6.` All US/imperial because OpenEMR's default vitals form captures °F/lb/in.

### Decision: strip demo-data leakage at seed level + DB level

- **Prompt:** *"there's this bracket text in the beginning that says 'AgentForge intake'. That should not be there… any other mention of demo data that populates in our responses should be deleted."*
- **Recommendation:** Two leakage sources found: (1) `[AgentForge Intake] ` prefix on `form_encounter.reason` (added by [seed_visit_intake.php](../../../../../contrib/util/agentforge/seed_visit_intake.php) `INTAKE_REASON_PREFIX`); (2) `MA intake (demo seed): ` prefix and `Reason for visit (schedule): X` line in MA nursing-note bodies. Fixed three layers in parallel: (a) seed code stops adding the prefixes going forward, (b) seed's purge/verification logic switches from "match by reason prefix" to "match by pid + demo dates" (since the prefix is no longer there to grep), (c) one-shot SQL `UPDATE` patches existing rows — 26 encounters and 28 nursing notes cleaned. Plus: re-attributed MA intake notes from user `physician` (Donna Lee) to user `clinician` (Fred Stone, an existing OpenEMR seed user) so the Clinical Notes Form table visually distinguishes the two authors.
- **Outcome:** Zero `[AgentForge` rows remain in `form_encounter`; zero `MA intake (demo seed):` or `Reason for visit (schedule):` rows in `form_clinical_notes`. Author column on the MA note now reads "clinician" instead of "physician".

### Decision: walk-the-iframe-tree pattern over hardcoded paths

- **Recommendation:** When the rail container needs to call a function that lives in an unknown frame in the OpenEMR iframe hierarchy, walk the tree with feature detection rather than hardcoding `parent.frames['enctabs']` or similar. Two reasons: (1) OpenEMR's own JS uses this pattern (`tabs_view_model.js` line 343 does `for (var i = 0; i < frames.length; ++i) { if (frames[i].twAddFrameTab) { ... } }` to find the encounter frame), so we follow precedent; (2) cross-origin frames throw on `.frames[i].refreshVisitDisplay` access, so the walk needs try/catch anyway, and feature detection naturally skips frames that don't have what we need.
- **Outcome:** [rail_container.html.twig](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) `triggerOpenEmrEncounterRefresh()` walks recursively from `window.top` and stops at first match. Cross-origin frames silently skipped. Robust to OpenEMR rearranging its tab structure.

## Trade-offs and alternatives

- **One canonical physician progress note row per encounter vs. new row per dictation** — chose canonical row + append. Trade-off: harder to roll back individual dictations (the whole row's text grows). Mitigation: the new `propose_clinical_note_edit` `action: 'update'` lets the agent rewrite the whole description if needed; `action: 'delete'` removes the row entirely.
- **Soft-delete (activity=0) vs. hard DELETE** — soft. Trade-off: the row keeps using a UUID and DB space. Reason: clinical notes are legal records; OpenEMR honors `activity = 0` as the audit-preserving deletion semantic; `setActivityForClinicalRecord` already exists for this purpose.
- **Format vitals on the wire vs. in the case-brief assembler** — case-brief assembler. Trade-off: the LLM sees raw decimals if it calls `get_vitals` directly (rare in current flows). Reason: the case brief is the most-visible vitals surface; formatting there guarantees the rail looks right regardless of model behavior; the model can still reason over the clean numeric strings if it ever needs them via the read tool.
- **Two write_targets (`clinical_note_update`, `clinical_note_delete`) vs. one (`clinical_note_edit`) with action in payload** — two. Trade-off: two entries in the dispatch table mapping to the same endpoint. Reason: the proposal-card chip needs to visually distinguish destructive (delete) from editorial (update) ops at a glance; chip text is derived from `write_target`; one shared target would force the chip to read "Clinical note edit" for both, losing the distinction.
- **Heuristic substring-match duplicate-suppression vs. "any proposal = suppress all text/claim"** — chose the aggressive form on second pass. First version did substring match on the preview-after-arrow with a 12-char threshold; missed cases where the model rephrased ("I've drafted a clinical note entry with your observation: 'X'" instead of restating the preview verbatim) and missed short payloads ("A1C is low", 11 chars, below threshold). Aggressive form is deterministic and doesn't need to predict what the model might emit alongside a proposal.
- **Citation arrow ↗ kept vs. removed** — removed. Originally added to signal "clicking changes the chart view" — but the icon's visual semantic in clinician UIs is "external link", which was misleading. Dotted-underline + link color is enough.

## Tools, dependencies, commands

- DB cleanup ran inside the docker container directly:
  - `docker exec development-easy-mysql-1 sh -c "echo \"UPDATE form_encounter SET reason = TRIM(SUBSTRING(reason, LENGTH('[AgentForge Intake] ') + 1)) WHERE reason LIKE '[AgentForge Intake] %';\" | mariadb -uopenemr -popenemr openemr"` — 26 rows
  - Same pattern for `form_clinical_notes` `MA intake (demo seed): ` (28 rows) and `\nReason for visit (schedule): X` (28 rows)
  - `UPDATE form_clinical_notes SET user='clinician' WHERE clinical_notes_type='nursing_note' AND user='physician';` (20 rows)
- `cd agentforge/cui && npm run build` — required after any CUI source change so OpenEMR serves the new bundle (build script also deletes a stale index.html). 89/89 vitest tests stayed green throughout.
- `cd agentforge/api && npm run typecheck` — confirmed src/ clean; the four pre-existing test-file errors (`RequestInfo` not found, `query` on `never`) persisted but are unrelated to this work.
- API process ran as host-side `tsx watch` (PID changed across restarts mid-session). The placeholder `agentforge-api` container in compose just runs `sleep infinity` — it's not the actual API server. Worth noting for the runbook.
- `composer phpstan` not run this session; PHP changes followed existing module patterns and passed `php -l` syntax checks.

## Files touched

**Created (PHP — write/edit endpoints, payload classes, ports, adapters, actions, read endpoint):**
- `interface/modules/custom_modules/oe-module-agentforge/public/context/clinical_notes.php`
- `interface/modules/custom_modules/oe-module-agentforge/public/write/clinical_note.php`
- `interface/modules/custom_modules/oe-module-agentforge/public/write/clinical_note_edit.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteWritePayload.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteWritePort.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/OpenEmrClinicalNoteAdapter.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteWriteAction.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteEditPayload.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteEditPort.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/OpenEmrClinicalNoteEditAdapter.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteEditAction.php`

**Modified (API tools, system prompt, case-brief assembler, dispatch table):**
- `agentforge/api/src/agent/system_prompt.ts` — dictation routing (rule 1 declarative-statement default + no-verification-first), tool invocation discipline, encounter-binding extended to clinical_note* targets, get_clinical_notes vs get_notes_metadata distinction
- `agentforge/api/src/agent/case_presentation_fetch.ts` — clinical_notes added to parallel fetch + bundleForLlm + toolResults
- `agentforge/api/src/agent/case_presentation_format.ts` — `vitalParts()` rewrite with per-vital formatters
- `agentforge/api/src/conversations/apply_pending_write.ts` — `WRITE_TARGETS` + `RELATIVE_PATH` + `ENCOUNTER_REQUIRED_TARGETS` set
- `agentforge/api/src/tools/propose_writes.ts` — `propose_clinical_note_write`, `propose_clinical_note_edit` (action enum)
- `agentforge/api/src/tools/chart_context_reads.ts` — `get_clinical_notes` registered

**Modified (PHP service + module shared code):**
- `src/Services/ClinicalNotesService.php` — `getActiveClinicalNotesForPatient()`, `appendPhysicianNoteForEncounter()`, `findActiveNoteByUuid()`, `softDeleteNoteByUuid()`, `replaceNoteDescriptionByUuid()`
- `interface/modules/custom_modules/oe-module-agentforge/src/Context/SourcePackFactory.php` — `clinicalNote()` factory
- `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig` — `triggerOpenEmrEncounterRefresh()` + WRITE_CONFIRMED handler with patient-binding guard
- `contrib/util/agentforge/seed_visit_intake.php` — drop `INTAKE_REASON_PREFIX` from new reasons; drop `"MA intake (demo seed):"` and `"Reason for visit (schedule):"` from MA note body; `loadIntakeStaffUsername()` (clinician → nurse → medical_assistant → ma → receptionist → oe-system); purge/verification queries switched to pid+date matching

**Modified (CUI):**
- `agentforge/cui/src/chat/MessageList.tsx` — `formatWriteTarget` chip labels (chief_complaint → "Reason for visit"; clinical_note* → "Clinical note" / "Update note" / "Delete note"); `suppressDuplicateProposalNarration` (any proposal = suppress all text/claim); `notifyParentOfWriteConfirmed` postMessage on confirm; removed `IconArrowOut` from cite buttons + dropped the function definition
- `agentforge/cui/src/index.css` — `.agentforge-msg__cite-link` `text-align: inherit` + `white-space: normal` (button user-agent default `text-align: center` was breaking wrapped citation text)

**Modified (database — runtime data, not source-controlled, but recorded here for reproducibility):**
- `form_encounter`: stripped `[AgentForge Intake] ` prefix from 26 rows
- `form_clinical_notes`: stripped `MA intake (demo seed): ` prefix from 28 rows; stripped `\nReason for visit (schedule): X` line from 28 rows; reattributed nursing notes from `user='physician'` to `user='clinician'` (20 rows)

## Lessons / Carry-forward

1. **Prompt-side fixes for output structure are uniquely fragile.** The "don't restate proposal in prose" rule degraded structured-JSON adherence and broke unrelated queries. Behavior rules (routing, tool selection) ride along fine. Structure rules (suppression, formatting, layout) belong in deterministic code paths.
2. **Iframe hierarchy assumptions burn time.** Walking `window.top.frames` with feature detection is the right pattern for any OpenEMR-host integration where the rail's position in the iframe tree isn't guaranteed.
3. **Model defensiveness needs explicit prompt counter for destructive ops.** The model will invent its own "Y/N" chat confirmation in front of any tool call it perceives as destructive, even when the tool description says "this is the confirmation." Need explicit "the tool call IS the confirmation" prompt.
4. **Brief telegraphic dictation is normal and shouldn't trigger verification.** The model's instinct to "check" a brief statement against chart data ("A1C is low" → call get_labs) is the wrong default for clinical dictation. Capture verbatim; verification is not the goal.
5. **Display-time formatting beats raw DB values, especially when the LLM is in the middle of the pipeline.** Trailing zeros in DECIMAL columns leak through unless explicitly handled.
6. **Demo-data hygiene is a recurring task, not a one-time cleanup.** Internal markers (`[AgentForge Intake]`, `(demo seed)`) leak into clinician-visible surfaces; needs a periodic grep/sweep before any demo.
7. **Author attribution carries clinical signal.** Two notes both authored by `physician` made it impossible to tell intake (front-desk/MA) from progress (physician) at a glance. Distinct usernames per role is a small change with disproportionate readability gain.
8. **WS state staleness across API restarts is a known transient.** Symptom: `Dictation failed (not_recording)`. Cause: client iframe holds a reference to a WebSocket whose server-side bag was wiped by a `tsx watch` reload. Fix: refresh the rail. Worth a runbook entry if it recurs in prod.

## Outcomes

- AgentForge has full clinical-note CRUD: read, append-write, by-uuid update, by-uuid soft-delete. The chief_complaint write path no longer captures physician dictation by default — that legacy bug is fixed.
- The encounter view (`form_encounter.reason`, vitals, Clinical Notes Form) auto-refreshes after every confirmed write — operators no longer click the encounter Refresh tab to see what they just confirmed.
- Demo data no longer leaks internal markers into clinician-visible UI: encounter reasons read clean, MA intake notes show natural prose authored by `clinician` (not `physician`), and vitals render in clinician-friendly units (`Temp 97.8°F`, `Wt 220 lb`, `Ht 5'10"`) instead of raw DECIMAL trailing zeros.
- Commit `df39efdf0` shipped the change; this journal lives at the canonical CT-timestamped path under `process/journal/week-1/`.

## Next steps

- [ ] Add a runbook entry for the "WebSocket staleness across API restarts" transient (lesson #8): symptom, diagnosis, fix. Suggested file: `Documentation/AgentForge/runbooks/dictation-not-recording.md`.
- [ ] Decide whether `propose_clinical_note_edit` `action: 'update'` should grow a third sub-action for granular line edits (replace-substring within description) or whether the current full-description-replacement model is sufficient. Defer until a real demo case forces it.
- [ ] Add a follow-up sweep to grep for any remaining demo-only text in clinician-visible surfaces (`grep -rn 'AgentForge\|demo seed\|Intake]'` across `interface/`, `agentforge/api/src/`, `agentforge/cui/src/`).
- [ ] Decide whether the per-vital formatters in `case_presentation_format.ts` should also apply when the agent calls `get_vitals` directly (currently formatting only happens in the case-brief assembler; agent tool-call view sees raw decimals).
- [ ] Confirm push timing for `gitlab` remote (Gauntlet grading remote): branch is now 3 commits ahead.

## Links

- Commit: `df39efdf0` — `feat(agentforge): clinical notes CRUD + dictation routing rewrite + encounter auto-refresh + UX polish`
- Related prior journal: [0502-T1822-submission-docs-punch-list.md](0502-T1822-submission-docs-punch-list.md) (the parallel work on submission docs that ran alongside the early part of this session)
- Related prior journal: [0502-T0051-encounter-scope-binding-brief.md](0502-T0051-encounter-scope-binding-brief.md) (earlier encounter-binding work that the dictation routing rules build on)
- Module README: [oe-module-agentforge/README.md](../../../../../interface/modules/custom_modules/oe-module-agentforge/README.md)
