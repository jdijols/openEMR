---
date: 2026-05-10
topic: Affordance + queue iteration plan delivery (Phases 1–4) + QA-hardening pass
related_milestone: process/milestones/week-2/08-affordance-queue-bundle-and-qa-pass.md
---

# Affordance + queue iteration delivery + QA hardening — session journal

## Goal

Two-phase session. **Phase A** — execute the affordance-queue iteration plan ([affordance-queue-iteration.md](../../../implementation/affordance-queue-iteration.md)) end-to-end through Phase 4 (bundle proposals), shipping a unified action surface + bundle review modal. **Phase B (forced by reality)** — QA hardening once forms started landing on real patients: make extraction accurate enough to demo and make sure extracted data actually surfaces in the dashboard cards. Submission deadline 2026-05-10 noon CT.

## Context

Plan v1 came out of [0510-T0132](0510-T0132-allergy-modal-iteration-pivot.md) but had factual gaps a second-pass critique surfaced (`||` PATCH races on bundle sections, single proposal_id collides with PHP idempotency ledger, encounter binding at row level breaks mixed bundles, preview not persisted, etc.). Session opened with that critique pasted in and a directive to verify each point against code before editing.

## Key decisions

### Decision: Critique-driven plan rewrite — every load-bearing point verified in code, not deferred

- **Prompt:** *"How confident are you the new plan is better than the old plan? Were you very critical of their own critique before just assuming everything they said was right, or did you verify it yourself before making edits to your plan and making this new one?"*
- **Recommendation:** Verify each of the 11 critique points by reading actual code (line numbers cited), then incorporate only what holds up — but separate "factually correct" from "good recommendation." On reflection: factual claims rigorously checked, but recommendations downstream of those facts taken too quickly. Tightened three spots (synthetic-ID `VARCHAR(191)` budget made explicit, Cancel-button removal rationale rewritten as positive UX argument, preview persistence reframed as `BundleReviewModal` direct-read driver, not "cross-session cross-physician"). Reordered the doc so payload shape + concurrency mechanism lead, phase plan flows out of it.
- **Outcome:** [affordance-queue-iteration.md](../../../implementation/affordance-queue-iteration.md) revised; "Revision notes" appendix at bottom cites each fix with line-numbered code evidence.

### Decision: Phases 1–4 shipped as specced; bundle modal auto-opens AND closes through both surfaces

- **Prompt:** *"Alright, I think it's time that we kick off the first phase of the plan… keep executing until it's complete. I mean the entire plan phase over phase, only stopping when you need something from me, like a manual view in the browser."*
- **Recommendation:** Sequence phases with manual-smoke checkpoints between each (Phase 1 visual, Phase 3 modal contract, Phase 4 bundle review). Treat the plan's payload-shape spec as the contract — write tests against it before wiring UI. Phase 5 (per-target dashboard modals) explicitly out of scope per plan.
- **Outcome:** Phase 1 — `findProposalQueue` (FIFO, resolved-aware) replaces inline LIFO `useMemo` in [App.tsx:524](../../../../../agentforge/cui/src/App.tsx); head-only broadcast with `lastBroadcastedHeadIdRef` + `initialHeadCheckedRef` invariant; affordance rewritten over `ProposalCardShell` with "1 of N" counter outside the card. Phase 2 — `formatPreview(target, payload)` shared helper persists at all 14 `insertPendingProposal` callsites; `liftMetadataKeys` in [apply_pending_write.ts:60-91](../../../../../agentforge/api/src/conversations/apply_pending_write.ts) drops `preview` before forwarding to PHP; in-chat proposal cards collapse to a small `✓ Saved` / `✗ Rejected` receipt. Phase 3 — Cancel button removed from [AllergyModal.tsx](../../../../../patient-dashboard/src/cards/AllergyModal.tsx), explicit Reject button per disabled-button matrix, X = snooze, new `proposal:queue_state` event blocks manual `+` while a queued agent proposal exists. Phase 4 — bundle producer `maybeBuildIntakeBundleProposal` in [orchestrator.ts](../../../../../agentforge/api/src/agent/orchestrator.ts), `setSectionRejected` with `jsonb_set` indexed-path update in [store.ts](../../../../../agentforge/api/src/conversations/store.ts), `POST /proposals/:id/items/{reject,restore}` routes, `applyBundleFanOut` with synthetic per-leaf IDs `${parent}::${section}[::${item}]`, [BundleReviewModal.tsx](../../../../../patient-dashboard/src/cards/BundleReviewModal.tsx) auto-opens on `proposal:open_modal` for `intake_bundle`. Mid-flight bug: the auto-open broadcast guard `if (headTarget !== 'allergy') return` excluded bundles — fixed to allow both targets.

### Decision: Bundle confirm rejected by OpenEMR with no useful UX hint → propagate per-leaf detail end-to-end

- **Prompt:** *"When I try to upload and extract Robert Kowalski's lab… we never set up the BundleReviewModal popup… Why is he hitting me with some red alert that seems negative?"*
- **Recommendation:** Build a diagnostic surface BEFORE chasing fixes — `applyBundleFanOut` emits a structured `console.error('bundle_fan_out_outcomes', {...})` per confirm, `/proposals/:id/confirm` propagates `out.detail` (was being dropped on the route layer), and `OpenEmrCallError` captures the raw response body when `res.json()` parse-fails. With those in place, three bugs surface clearly: (1) PHP returning HTTP 200 with HTML error body — `Unknown column 'source_docref_uuid'` from a recent ledger schema migration that never ran against the live DB; (2) demographics writes silently skipping because the bundle assembler read `ext.demographics.name` (compact shape) when the extractor emits `legal_name_first`/`legal_name_last`; (3) allergy reactions / severities not normalized in the bundle path the way `propose_allergy_write` normalizes them.
- **Outcome:** One-shot `ALTER TABLE agentforge_completed_write_proposal ADD COLUMN source_docref_uuid VARCHAR(64) DEFAULT NULL` unblocks all leaf writes. Bundle assembler reads `legal_name_*`, capitalizes sex via case-mapped allowlist, validates DOB regex `^\d{4}-\d{2}-\d{2}$`, applies `normalizeSubstance` + `normalizeReactionToOptionId` to allergy items, maps `husband`/`wife`/`mom`/`dad` → canonical relation tokens, drops grandparents (no schema slot). Bundle fan-out `reason` summary surfaces in the affordance pill so future failures are self-diagnosing.

### Decision: Dashboard MedicationsCard filter excluded the writes — drop `intent: 'order'` filter

- **Prompt:** *"You say everything wrote successfully, but when I opened the dashboard tab, none of the data is inside of the new dashboard.php React app."*
- **Recommendation:** Trace the read path. FHIR `/MedicationRequest` UNIONs two sources via `PrescriptionService::getBaseSql` (line 156-212): `prescriptions` table → `intent='order'` (clinical orders), `lists` table → `intent='plan'` (community / patient-reported). Agentforge `medication_add.php` writes to `lists`, so the dashboard's `intent: 'order'` filter excluded everything we shipped.
- **Outcome:** [MedicationsCard.tsx](../../../../../patient-dashboard/src/cards/MedicationsCard.tsx) drops the `intent` filter, keeps `status: 'active'`. Card now surfaces both prescription-table orders AND lists-table community meds.

### Decision: Lab Observation persistence is JSON sidecars on disk, not FHIR rows — bridge with a custom PHP endpoint

- **Prompt:** *"It also still doesn't dismiss… LABS is working great. Thank you for fixing this."* (after) *"nothing populated in the labs card"*
- **Recommendation:** [OpenEmrObservationWriteAdapter.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/OpenEmrObservationWriteAdapter.php) header literally says *"Filesystem here keeps the MVP demo end-to-end without inventing a new `agentforge_w2_observations` table. Thursday upgrade: persist as proper FHIR Observation rows."* The Thursday upgrade was deferred. For demo, build a read-only PHP endpoint that walks `sites/default/documents/agentforge_w2/_obs/`, filters by `patient_uuid_canonical`, reshapes each row into a FHIR Observation, returns a Bundle. LabsCard merges this source with `/Observation?category=laboratory` (which still works for stock data). chart:updated invalidates both query keys.
- **Outcome:** [public/context/lab_observations_for_dashboard.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/context/lab_observations_for_dashboard.php) (new, ~150 lines), [agentforge_labs.ts](../../../../../patient-dashboard/src/fhir/agentforge_labs.ts) hook, [LabsCard.tsx](../../../../../patient-dashboard/src/cards/LabsCard.tsx) renders both sources sorted by `effectiveDateTime`. Long-term fix is still to write proper FHIR Observation rows; for the demo this surfaces the data.

### Decision: Model dial — Haiku 4.5 → Opus 4.7 → Sonnet 4.6 (final landing)

- **Prompt:** *"the extractor is trash. It is so bad. It is not picking up all the information accurately."* (after Sonnet) *"should we switch back to Haiku to get some speed back? It is taking so long to finish the extraction process? It's not going to look good to wait two minutes on my demo."*
- **Recommendation:** Three-way trade: Haiku ~30s but bad on NKDA / table rows / scanned tables; Opus best accuracy but ~2 minutes per form is demo-disastrous; Sonnet ~60s and reliably follows the sharpened prompt. Land at Sonnet 4.6 with `max_tokens: 16384`. The prompt does the heavy lifting (table-reading rules, NKDA/"no known" negation patterns mapped to empty array, conservative null preferred over guess, sex/DOB/relation form-specific patterns); the model just needs to follow long structured prompts crisply, which Sonnet does.
- **Outcome:** [select_model.ts](../../../../../agentforge/api/src/agent/select_model.ts) `intake_extractor: 'claude-sonnet-4-6'`, [intake_extractor.ts:120](../../../../../agentforge/api/src/workers/intake_extractor.ts) hardcoded model match, [cost_estimate.ts](../../../../../agentforge/api/src/agent/cost_estimate.ts) rate table updated to Sonnet's $3/$15 per Mtok. Prompt sharpening in [intake_extractor.ts:268-376](../../../../../agentforge/api/src/workers/intake_extractor.ts) adds three CRITICAL blocks: table reading, negation patterns, conservative extraction, plus form-specific patterns (sex assigned-at-birth, DOB strict format, relation natural-language map).

### Decision: Lab cross-check refusal banner removed for QA-pass — trust the model

- **Prompt:** *"I really don't like this refusal notification that populates, especially if it's able to extract data. Why is he hitting me with some red alert that seems negative?"*
- **Recommendation:** S14 PDF text-layer cross-check is a strict hallucination guard — when the LLM's `quote_or_value` doesn't appear in the PDF text layer, persistence refuses. For scanned labs / unusual fonts / table cells PDF text extraction can't position, the cross-check fires false positives. For demo, remove the gate: every extracted row persists regardless of `crossCheckStatus`. Re-tighten posture later if the trust calculus changes.
- **Outcome:** [attach_and_extract.ts:367-393](../../../../../agentforge/api/src/tools/attach_and_extract.ts) — `unverified` and `partial` no longer block persistence; the `synthesizeCrossCheckFailRefusal` helper still exists but its trigger (`skipped_reason: 'cross_check_failed'`) is never set. Three test cases (`unverified`, `partial`, `partial-no-rows`) updated to assert the new trust posture.

## Trade-offs and alternatives

- **Bundle reject endpoint via `PATCH /proposals/:id`** — rejected. Top-level `||` JSON merge would race with concurrent agent `update_proposal` PATCHes on the `sections` array. Dedicated `POST /items/reject` with `jsonb_set` on the indexed leaf path is race-safe.
- **Single shared `proposal_id` for bundle leaves** — rejected. PHP `agentforge_completed_write_proposal` ledger throws `DuplicateProposalExecutionException` on second use of the same ID; bundle would partial-write silently. Synthetic per-leaf IDs `${parent}::${section}[::${item}]` keep ledger idempotency working per-leaf.
- **Cancel button kept as a labeled Snooze in the modal footer** — rejected. Universal X-as-close is what physicians encounter in every other modal; adding a third labeled button (Reject + Snooze + Confirm) is busier without improving discoverability. Renaming Cancel → Reject would silently flip a familiar gesture from "dismiss" to "reject" for users mid-iteration (footgun).
- **Auto-open BundleReviewModal on initial mount with cached pending proposal** — rejected. Auto-open invariants restrict pop-up to user-driven head advances (post-confirm/reject), not cache replay. The user clicking the affordance body re-opens the modal deliberately.
- **Fix `combined_prescriptions` view** to surface lab Observations through stock FHIR — deferred. The view exists as an inline subquery alias, not a missing table — but the underlying issue is the JSON-sidecar adapter never writing to MariaDB at all. Custom PHP endpoint is faster to demo than refactoring the persistence path.

## Tools, dependencies, commands

- One-shot DB repair on the running MariaDB to add the missing ledger column (the module's `#IfMissingColumn` directive in `sql/table.sql` exists but the upgrade flow hadn't been triggered against the live DB):
  ```bash
  docker exec development-easy-mysql-1 mariadb -uroot -proot openemr -e \
    "ALTER TABLE agentforge_completed_write_proposal ADD COLUMN source_docref_uuid VARCHAR(64) DEFAULT NULL, ADD KEY idx_source_docref (source_docref_uuid);"
  ```
- API hot-reload: `npm run dev:host` (tsx watch) in `agentforge/api`. CUI + dashboard rebuilt via `npm run build` after each TS/TSX change.

## Files touched

- **Created:**
  - `agentforge/api/src/conversations/preview_formatters.ts` — shared `formatPreview(target, payload)` helper
  - `agentforge/api/test/conversations/preview_formatters.test.ts` — 32 cases, target-by-target format spec
  - `agentforge/cui/src/chat/proposal_lookup.test.ts` — 10 cases pinning FIFO + resolved-aware queue
  - `patient-dashboard/src/cards/BundleReviewModal.tsx` — bundle review with per-section toggles + Confirm All / Reject All
  - `patient-dashboard/src/proposals/proposalBus.test.ts` — `proposal:queue_state` validator round-trip
  - `interface/modules/custom_modules/oe-module-agentforge/public/context/lab_observations_for_dashboard.php` — sidecar reader → FHIR Bundle
  - `patient-dashboard/src/fhir/agentforge_labs.ts` — `useAgentForgeLabs(patientUuid)` hook
- **Modified (high-signal):**
  - `Documentation/AgentForge/implementation/affordance-queue-iteration.md` — full rewrite + revision-notes appendix
  - `agentforge/cui/src/App.tsx` — `findProposalQueue` swap, head-only broadcast w/ initial-mount invariant, body-click for bundle, queue_state emitter
  - `agentforge/cui/src/proposals/AboveComposerAffordance.tsx` — full rewrite using `ProposalCardShell` tokens, counter outside, fade-in keyframe
  - `agentforge/cui/src/chat/proposal_lookup.ts` — `findLatestOpenProposalId` → `findProposalQueue`
  - `agentforge/cui/src/chat/MessageList.tsx` — universal in-chat proposal-card suppression + `ProposalReceipt` for resolved
  - `agentforge/cui/src/index.css` — affordance amber treatment + soft-green/red equal-weight buttons + counter pill
  - `agentforge/cui/src/proposals/proposalBus.ts` — `proposal:queue_state` event added
  - `patient-dashboard/src/proposals/proposalBus.ts` (mirror) — same event + validator
  - `patient-dashboard/src/proposals/proposalsApi.ts` — `rejectProposal`, `setSectionRejected`, `ConfirmResult.detail`
  - `patient-dashboard/src/cards/AllergyModal.tsx` — Cancel removed, explicit Reject, Save → Confirm
  - `patient-dashboard/src/cards/AllergiesCard.tsx` — `+` button disabled while allergy queue head pending
  - `patient-dashboard/src/cards/MedicationsCard.tsx` — drop `intent: 'order'` filter
  - `patient-dashboard/src/cards/LabsCard.tsx` — merge FHIR `/Observation` + `useAgentForgeLabs` results
  - `patient-dashboard/src/cards/BundleReviewModal.tsx` — close on `proposal:resolved` BroadcastChannel (race-free vs SSE)
  - `patient-dashboard/src/patient/PatientDashboardPage.tsx` — listen for `intake_bundle` open_modal, invalidate `agentforge-labs` on `chart:updated`
  - `agentforge/api/src/conversations/store.ts` — `setSectionRejected(proposalId, sectionId, itemId, rejected)` via `jsonb_set`
  - `agentforge/api/src/conversations/apply_pending_write.ts` — bundle fan-out branch with synthetic IDs + structured log + reason summary
  - `agentforge/api/src/agent/orchestrator.ts` — `maybeBuildIntakeBundleProposal` + `buildIntakeBundleSections` w/ section-level encounter binding
  - `agentforge/api/src/agent/select_model.ts` — `intake_extractor: 'claude-sonnet-4-6'`
  - `agentforge/api/src/agent/model.ts` — `ANTHROPIC_DEFAULT_MODEL_ID = 'claude-sonnet-4-6'`
  - `agentforge/api/src/agent/cost_estimate.ts` — anthropic rate $3/$15 (Sonnet)
  - `agentforge/api/src/workers/intake_extractor.ts` — Sonnet 4.6, max_tokens 16384, sharpened prompt (table reading, negation, conservative null, form-specific)
  - `agentforge/api/src/tools/attach_and_extract.ts` — cross-check no longer gates persistence
  - `agentforge/api/src/tools/propose_writes.ts` — exported `normalizeSubstance` + `normalizeReactionToOptionId`, persisted `preview` at every callsite, allergy preview format
  - `agentforge/api/src/openemr/client.ts` — capture raw body on JSON parse fail; structured `openemr_invalid_json` log
  - `agentforge/api/src/app.ts` — propagate `out.detail` through both `/confirm` routes; `POST /proposals/:id/items/{reject,restore}`
  - `agentforge/api/test/agent/select_model.test.ts` — Sonnet 4.6 fixture
  - `agentforge/api/test/agent/orchestrator.test.ts` — model name in event-list assertion
  - `agentforge/api/test/tools/attach_and_extract.test.ts` — three tests rewritten for relaxed cross-check
  - `agentforge/cui/src/chat/voice_confirm_proposal.test.ts` — head-of-queue + empty-queue no-op
  - `agentforge/cui/src/chat/w2_components.test.tsx` — IntakeProposalCard describe block removed
- **Deleted:**
  - `agentforge/cui/src/chat/IntakeProposalCard.tsx` — replaced by bundle proposal flow
  - `agentforge/cui/src/chat/intake_dispatch.ts` — server-side fan-out replaces browser-side
  - `agentforge/cui/src/chat/intake_dispatch.test.ts` — companion test deleted

## Outcomes

What is now true that was not true at session start:

- The affordance + queue iteration plan is delivered through Phase 4. One queue, one Confirm/Reject vocabulary, one design language across CUI and dashboard surfaces.
- Bundle proposals (intake forms today; lab ingestion shape ready) flow end-to-end: agent extraction → server-side bundle row → CUI affordance → BundleReviewModal auto-opens on dashboard → per-section toggles + Confirm All → server fan-out with synthetic per-leaf IDs → PHP write endpoints write to MariaDB → dashboard cards refresh via `chart:updated`.
- Margaret Chen, James Whitaker, and Robert Kowalski intake/lab forms produce visible chart data (medications, demographics, family history, lab observations). Labs surface via the sidecar-reading PHP endpoint until proper FHIR Observation persistence ships.
- Extraction quality is meaningfully higher with Sonnet 4.6 + sharpened prompt: NKDA → empty allergies (not phantom entries), table rows align across columns, blank cells emit null instead of guesses.
- Diagnostic surface for failed bundle confirms is real-time: `bundle_fan_out_outcomes` log per leaf with `reason`, top-level `reason` summary on the affordance pill, `openemr_invalid_json` log captures raw HTML error bodies when PHP responds non-JSON.
- 427/428 vitest pass on agentforge-api; 145/145 on patient-dashboard; eval suite at 88/88 with 0 gate breaches; CUI typecheck shows only the two pre-existing W2-sweep errors in `Composer.tsx` + `MessageList.tsx` dead `ProposalBlock`.

## Next steps

- [ ] Run remaining QA forms (8 total: intake + lab) on fresh patients; capture `bundle_fan_out_outcomes` for any that fail.
- [ ] Re-record demo video showing the full intake-form flow (upload → BundleReviewModal → Confirm All → dashboard cards refresh) and the lab flow (upload → LabsCard populates).
- [ ] Long-term: replace `OpenEmrObservationWriteAdapter`'s JSON sidecar store with proper FHIR Observation row writes (the deferred "Thursday upgrade") so the custom dashboard endpoint can be retired.
- [ ] Long-term: fix the three context endpoints (`meds.php`, `social_history.php`, `labs.php`) that fail on `Unknown column 'patient.uuid'` — agent's chart-context reads will be incomplete until then.
- [ ] Phase 5 of the iteration plan (per-target dashboard modals: Medication, Demographics, FamilyHistory) when bandwidth returns.
- [ ] Tighten the lab cross-check posture again post-demo if the trust calculus shifts back to safety-first.

## Links

- Numbered milestone: [process/milestones/week-2/08-affordance-queue-bundle-and-qa-pass.md](../../milestones/week-2/08-affordance-queue-bundle-and-qa-pass.md)
- Iteration plan: [Documentation/AgentForge/implementation/affordance-queue-iteration.md](../../../implementation/affordance-queue-iteration.md)
- Prior journals consumed by this work: [0510-T0132](0510-T0132-allergy-modal-iteration-pivot.md), [0510-T0556](0510-T0556-cui-uploads-into-openemr-documents.md)
