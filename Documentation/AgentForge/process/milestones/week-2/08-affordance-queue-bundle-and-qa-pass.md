# 08 — Affordance + queue iteration, bundle pipeline, QA-pass hardening

> Milestone covering the work after [milestone 07](07-w2-patient-dashboard-integration.md). Spans four sessions of post-dashboard work that converged on the W2 final-submission demo: (a) hybrid agent + manual allergy modal that became the prototype for a unified Confirm/Reject contract; (b) live-routing UX polish (status pill via SSE); (c) CUI uploads landing in OpenEMR's canonical `documents` table with provenance; (d) the affordance-queue iteration plan delivered end-to-end (Phases 1–4) plus a forced QA-hardening pass once forms started landing on real patients. Phase 5 (per-target dashboard modals) explicitly deferred per the plan.

## Purpose

Where 07 ended:
- 11 dashboard cards rendering live FHIR via same-origin LocalApi.
- CUI rail integration smooth (subscribe + race-guard + smooth-swap).
- Visual upgrade through Phase 7 elevated chrome.
- Two OpenEMR-core 500s fixed in-module.
- 117/117 vitest, dashboard 115 KB gzipped, defense doc shipped.

What this milestone covers:
- **Hybrid allergy modal architecture** — single component, two modes (manual `+` vs agent-driven), proposal lifecycle API, dashboard ↔ CUI BroadcastChannel coordination, FHIR transform extension to preserve granular severity.
- **Live routing status pill** — SSE-driven worker label above the typing indicator (replaces the bare ellipsis with "Reading file" / "Searching evidence" the moment the supervisor's tool call begins).
- **CUI uploads → OpenEMR Documents** — dual-write to canonical `documents` table, "Clinical Copilot" inbox category + post-extraction reclassify, ledger-column provenance (`source_docref_uuid`).
- **Affordance + queue iteration plan, Phases 1–4** — one queue, one Confirm/Reject vocabulary, one design language across all proposal surfaces. Bundle proposals (intake form today; lab shape ready) replace the bespoke `IntakeProposalCard` browser-side fan-out with server-side fan-out via synthetic per-leaf proposal IDs. Per-section reject via dedicated `POST /proposals/:id/items/{reject,restore}` endpoint with `jsonb_set` indexed-path update — no race with concurrent agent `update_proposal` PATCHes.
- **QA-pass hardening** — model dial Haiku → Opus → Sonnet (final), prompt sharpening (table rows + NKDA negation + conservative null), demographic/allergy/family-history payload normalizations to match PHP allowlists, lab cross-check refusal removed for demo trust, custom PHP endpoint to read JSON-sidecar lab observations until proper FHIR Observation persistence ships.

## The prior-art chain (sessions feeding into this milestone)

| Session | Journal | Topic |
|---|---|---|
| Hybrid allergy modal + LLM judge + proposal API | [0510-T0132](../../journal/week-2/0510-T0132-allergy-modal-iteration-pivot.md) | Three-confirm-surface diagnosis → unified plan; proposal lifecycle API; allergy add/edit round-trip |
| Live routing status pill | [0510-T0435](../../journal/week-2/0510-T0435-live-routing-status-pill.md) | SSE `routing` event piped to status label above typing indicator |
| CUI uploads into OpenEMR Documents | [0510-T0556](../../journal/week-2/0510-T0556-cui-uploads-into-openemr-documents.md) | Dual-write to canonical `documents`, inbox category + reclassify, provenance ledger column |
| Plan delivery + QA pass | [0510-T1030](../../journal/week-2/0510-T1030-affordance-queue-bundle-qa-pass.md) | Phases 1–4 of the iteration plan; QA debugging arc; Sonnet 4.6 landing |

## Architecture decisions

### 1. Hybrid agent + manual modal architecture (foundational for the whole iteration)

Pre-existing problem: three confirm surfaces (in-chat ProposalBlock, AboveComposerAffordance, AllergyModal) with three visual languages and three confirm code paths converging on one storage layer. The unifying decision: build a single `AllergyModal` operating in two modes from one prop (`proposalId?`):
- **Manual `+` add** — no proposal until Save (lazy create + confirm in one shot).
- **Agent-driven** — proposal already exists, modal binds via GET + SSE `payload_updated` for live agent edits.

The proposal payload in Postgres is the single source of truth — both the modal and the agent's `update_proposal` tool PATCH the same row, so manual edits and agent updates merge cleanly via shallow `||` merge. Cross-iframe coordination via same-origin `BroadcastChannel('agentforge-proposals')`. Above-composer affordance pinned above the chat input — same pattern Claude Code uses for permission prompts.

Defense narrative: "the agent and the physician collaborate on one row — we show that row in two places, and they agree by construction."

This pattern became the prototype for Phase 3's modal contract and Phase 4's bundle review modal. See [0510-T0132](../../journal/week-2/0510-T0132-allergy-modal-iteration-pivot.md) for full decisions log including FHIR transform extension (`reaction[0].severity` carries the raw `severity_al` option_id alongside the spec-mandated `criticality`), substance editable in update mode, and the storage-boundary normalization layer.

### 2. CUI uploads project to OpenEMR's canonical `documents` table

Pre-session, CUI uploads only landed in `sites/default/documents/agentforge_w2/{uuid}.bin` sidecars — invisible to the chart UI, FHIR DocumentReference, drive encryption, and ACL. Decision: project every successful upload into OpenEMR's canonical `documents` table via `Document::createDocument()` as a best-effort dual-write. Sidecar gets stamped with `oe_document_id`. Failure logs and continues — the agent still has the sidecar copy.

Filename-based category inference is brittle; instead, every upload lands in a single "Clinical Copilot" inbox category, then post-extraction the file is reclassified to "Lab Report" or "Patient Information" based on the agent's parsed-content verdict. On uncertain extraction, the file stays in the inbox — safe default.

Provenance via a single `source_docref_uuid VARCHAR(64) NULL` column on the existing `agentforge_completed_write_proposal` ledger. The agent stashes the docref into the propose payload as a leading-underscore `_source_docref_uuid` metadata key; `liftMetadataKeys` in `apply_pending_write.ts` lifts it to the top-level body so PHP allowlists stay clean. **This column was missed in the live-DB migration — caught + fixed during the QA pass (see Decision 5 below).**

Full session decisions in [0510-T0556](../../journal/week-2/0510-T0556-cui-uploads-into-openemr-documents.md).

### 3. Affordance + queue iteration plan, Phases 1–4

The plan ([affordance-queue-iteration.md](../../../implementation/affordance-queue-iteration.md)) survived a critique-driven rewrite that surfaced six load-bearing technical issues in v1 and reordered the doc so the bundle payload shape + concurrency mechanism lead, with the phase plan flowing out of it. Phase deliverables:

**Phase 1 — Affordance + queue foundation.** `findProposalQueue(messages)` replaces the prior `findLatestOpenProposalId` LIFO scan with a FIFO walk that filters resolved blocks (closes a latent re-target bug for voice "confirm" after a proposal lands). Inline `useMemo` activeProposal in App.tsx swaps to a head-of-queue pull; broadcast effect rewritten to fire only on head-id transitions with an `initialHeadCheckedRef` invariant so cache-replay on chart open does NOT auto-pop the modal (user sees the affordance, clicks in deliberately). `AboveComposerAffordance` rewritten using `ProposalCardShell` tokens (amber-on-cream "decision needed" treatment); "1 of N" counter renders OUTSIDE the card, above-and-right, aligned to the card's right edge.

**Phase 2 — Persist preview + suppress in-chat cards.** `formatPreview(target, payload): string` shared helper at [agentforge/api/src/conversations/preview_formatters.ts](../../../../../agentforge/api/src/conversations/preview_formatters.ts), invoked at every `insertPendingProposal` callsite (14 of them) so `pending_proposals.payload.preview` is canonical and survives reload. `liftMetadataKeys` updated to drop `preview` before forwarding to PHP (UI-only field; PHP allowlists stay strict). `MessageList.tsx` extends the prior allergy-only suppression to ALL unresolved proposals; resolved blocks render as a single-line `ProposalReceipt` ("✓ Saved · Penicillin · Severe" / "✗ Rejected · …") instead of full card chrome.

**Phase 3 — Modal contract refactor.** Cancel button removed from AllergyModal. X-close + backdrop = snooze (universal X-as-close pattern; physicians already encounter this in every other modal). Explicit Reject button visible only when an agent proposal is bound (per disabled-button matrix). New `proposal:queue_state` BroadcastChannel event signals the AllergiesCard to disable manual `+` while a queued allergy proposal exists (prevents two open surfaces for the same intent). Affordance body-click extended: modal-bearing targets re-broadcast `proposal:open_modal`; modal-less encounter targets emit a NAV_REQUEST envelope to the bound encounter view (same mechanism as the rail's "Today" link).

**Phase 4 — Bundle proposals.** Single `pending_proposals` row with `kind: 'bundle'` payload describing N section/item leaves. Per-section reject via dedicated `POST /proposals/:id/items/reject` (and `/restore`) using `jsonb_set` on the indexed leaf path — race-safe vs concurrent agent `update_proposal` payload edits (the prior approach of PATCHing the whole `sections` array via `||` merge would last-write-wins on the entire array). `applyBundleFanOut` in `apply_pending_write.ts` walks the section tree and POSTs each non-rejected leaf to its per-target write endpoint with a **synthetic** `proposal_id` of the form `${parentBundleId}::${section_id}[::${item_id}]` so the PHP `agentforge_completed_write_proposal` ledger keeps each leaf uniquely de-duplicable. `BundleReviewModal` opens via `proposal:open_modal` for `write_target === 'intake_bundle'`, renders per-section toggles, footer counter "Confirm N of M" updates live, post-confirm shows per-leaf "✓ Wrote" / "✗ <reason>" badges from the SSE `status_changed` detail (or — race-fix — the immediate confirm response, since the SSE close races the broadcast). Auto-close path subscribes to BroadcastChannel `proposal:resolved` so the modal closes regardless of whether Confirm fired from inside the modal or from the rail affordance.

Full plan + revision-notes appendix in [affordance-queue-iteration.md](../../../implementation/affordance-queue-iteration.md). Phase-by-phase decisions in [0510-T1030](../../journal/week-2/0510-T1030-affordance-queue-bundle-qa-pass.md).

### 4. Live routing status pill via SSE

The supervisor's tool call begins → SSE `routing` event fires → CUI's `StatusLabel` swaps the bare typing-indicator dots for a worker-specific affordance ("Reading file" / "Searching evidence") *the moment* the call begins, not post-hoc. The handoff-recording path is preserved — the `agent_step` block in the chat history is the durable record; the live pill is the in-progress affordance. See [0510-T0435](../../journal/week-2/0510-T0435-live-routing-status-pill.md).

### 5. QA-pass arc — six gaps surfaced and fixed during the demo run

Once the plan delivery was complete and the user started uploading actual QA forms, six gaps surfaced that didn't show up in unit tests or eval. Each was diagnosed via a structured log (`bundle_fan_out_outcomes`, `openemr_invalid_json`) and fixed in a tight loop:

1. **Missing ledger column on the live DB.** The `source_docref_uuid VARCHAR(64) NULL` column was added to `sql/table.sql` with both an `#IfNotTable` (CREATE) and an `#IfMissingColumn` (ALTER) directive — but the upgrade flow had not been triggered against the running MariaDB. Every PHP write succeeded at the validation/business-logic layer then died on the ledger insert with `Unknown column 'source_docref_uuid'`, dumping HTML error pages instead of JSON. The API client treated HTTP 200 with HTML body as `openemr_invalid_json` → bundle marked all leaves failed. One-shot ALTER TABLE on the running MariaDB unblocked every leaf. Same `#IfMissingColumn` lives in source for fresh installs.

2. **Bundle assembler reading the wrong demographics shape.** Read `ext.demographics.name` (the compact `intake_data` shape from `types.ts`); the actual extractor emits split fields (`legal_name_first`, `legal_name_last`, `legal_name_middle`). Demographics writes silently skipped name updates. Fixed to read split fields with the combined `name` as a fallback.

3. **Allergy reactions / severities not normalized in the bundle path.** `propose_allergy_write` runs `normalizeReactionToOptionId` + `normalizeSubstance` + severity allowlist mapping. The bundle assembler bypassed those. Fix: export the normalizers from `propose_writes.ts` and apply them in the bundle builder. Family-history relations get their own natural-language map (`mom`/`dad`/`husband`/`wife` → canonical tokens; grandparents skipped — no schema slot).

4. **Diagnostic surface for failed bundle confirms was missing.** `applyBundleFanOut` now emits a structured `console.error('bundle_fan_out_outcomes', {leaves_total, leaves_ok, leaves_failed, outcomes: [{section_id, item_id, write_target, ok, reason}]})` log per confirm. Top-level `reason` summary surfaces in the affordance error pill. Both `/confirm` routes propagate `out.detail` to the client (was being dropped on the route layer). `OpenEmrCallError` captures the raw response body when JSON parse fails.

5. **MedicationsCard FHIR filter excluded the writes.** Dashboard queried `/MedicationRequest?intent=order&status=active`. `lists`-table medications surface as `intent='plan'` (community / patient-reported), not `'order'`. Drop the `intent` filter; both prescription orders and lists-table community meds flow through.

6. **Lab Observation persistence is JSON sidecars on disk, not FHIR rows.** `OpenEmrObservationWriteAdapter` writes `sites/default/documents/agentforge_w2/_obs/<sha256>.json` files — a deferred "Thursday upgrade" that never landed. Bridge with [public/context/lab_observations_for_dashboard.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/context/lab_observations_for_dashboard.php) (new): walks the sidecar dir, filters by `patient_uuid_canonical`, reshapes into a FHIR Observation Bundle. Dashboard `useAgentForgeLabs` hook + `LabsCard` merges this source with stock `/Observation?category=laboratory` (sort by `effectiveDateTime` desc). Long-term: replace the sidecar adapter with proper `procedure_result` writes so stock FHIR serves the same data; the custom endpoint retires.

### 6. Lab cross-check refusal removed for QA-pass — trust the model

S14 PDF text-layer cross-check was a strict hallucination guard: when the LLM's `quote_or_value` didn't appear verbatim in the PDF text layer, persistence refused with a red Refusal banner. False positives on scanned labs / unusual fonts / table cells PDF text extraction can't position. For demo: every extracted row persists regardless of `crossCheckStatus`; banner is gone. The `synthesizeCrossCheckFailRefusal` helper still exists but its trigger condition (`skipped_reason: 'cross_check_failed'`) is no longer set. Three test cases updated to assert the new posture; re-tighten if the trust calculus shifts back to safety-first. See [attach_and_extract.ts:367-393](../../../../../agentforge/api/src/tools/attach_and_extract.ts).

### 7. Model dial — Haiku 4.5 → Opus 4.7 → Sonnet 4.6 (final landing)

Three-way trade for the intake_extractor:
- **Haiku 4.5** — ~30 s per form. Visibly weaker on scanned tables; sometimes ignores the NKDA-empty rule (creates phantom allergy entries with substance "NKDA"); misaligns medication-table rows.
- **Opus 4.7** — best accuracy, ~2 minutes per form. Demo-disastrous latency.
- **Sonnet 4.6** — ~60 s. Vision quality close to Opus; reliably follows the sharpened prompt's CRITICAL blocks (table reading, NKDA / "no known" negation patterns mapped to empty array, conservative null preferred over guess, sex / DOB / relation form-specific patterns).

Land at Sonnet 4.6 with `max_tokens: 16384`. The prompt does the heavy lifting — Sonnet is reliable on long structured prompts where Haiku is lossy.

## Files of note

The high-impact entry points across the four sessions:

**Server-side core**
- `agentforge/api/src/agent/orchestrator.ts` — bundle producer + helpers, status pill emit, Lab Summary auto-proposal
- `agentforge/api/src/conversations/store.ts` — `setSectionRejected` via `jsonb_set`
- `agentforge/api/src/conversations/apply_pending_write.ts` — bundle fan-out branch, structured outcomes log, reason summary, `liftMetadataKeys` drops `preview`
- `agentforge/api/src/conversations/preview_formatters.ts` (new) — single source of truth for affordance preview lines
- `agentforge/api/src/tools/propose_writes.ts` — preview persisted at every callsite, normalizers exported
- `agentforge/api/src/tools/attach_and_extract.ts` — cross-check no longer gates persistence
- `agentforge/api/src/workers/intake_extractor.ts` — Sonnet 4.6 + sharpened prompt
- `agentforge/api/src/agent/select_model.ts` + `model.ts` + `cost_estimate.ts` — model swap propagation
- `agentforge/api/src/openemr/client.ts` — raw-body diagnostic on JSON parse fail
- `agentforge/api/src/app.ts` — `POST /proposals/:id/items/{reject,restore}`, `detail` propagated through both `/confirm` routes

**Module / PHP**
- `interface/modules/custom_modules/oe-module-agentforge/sql/table.sql` — `source_docref_uuid` column added (CREATE + ALTER)
- `interface/modules/custom_modules/oe-module-agentforge/src/Documents/*` — OpenEmr documents registrar, ClinicalCopilotCategoryInstaller, DocumentReclassifyPort
- `interface/modules/custom_modules/oe-module-agentforge/public/document/reclassify.php` — post-extraction file moves
- `interface/modules/custom_modules/oe-module-agentforge/public/context/lab_observations_for_dashboard.php` (new) — sidecar reader → FHIR Bundle
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/AllergyWriteAction.php` + `AllergyWritePayload.php` — `update_substance` arm + REACTION_TO_OPTION_ID + extended SEVERITY_TO_OPTION_ID

**CUI**
- `agentforge/cui/src/App.tsx` — head-only broadcast + queue_state emitter + body-click for bundle
- `agentforge/cui/src/proposals/AboveComposerAffordance.tsx` — full rewrite using `ProposalCardShell`
- `agentforge/cui/src/chat/proposal_lookup.ts` — `findProposalQueue` (FIFO + resolved-aware)
- `agentforge/cui/src/chat/MessageList.tsx` — universal in-chat suppression + `ProposalReceipt`
- `agentforge/cui/src/chat/StatusLabel.tsx` — sparkle + label live-routing affordance
- `agentforge/cui/src/index.css` — affordance amber treatment + soft-green/red equal-weight buttons
- Deletes: `IntakeProposalCard.tsx`, `intake_dispatch.ts`, plus their tests — replaced by bundle proposal flow

**Dashboard**
- `patient-dashboard/src/cards/AllergyModal.tsx` — Cancel removed, explicit Reject, Save → Confirm
- `patient-dashboard/src/cards/AllergiesCard.tsx` — `+` disabled while allergy queue head pending
- `patient-dashboard/src/cards/MedicationsCard.tsx` — drop `intent: 'order'` filter
- `patient-dashboard/src/cards/LabsCard.tsx` — merge FHIR `/Observation` + sidecar endpoint
- `patient-dashboard/src/cards/BundleReviewModal.tsx` (new) — per-section toggles, response-driven close
- `patient-dashboard/src/fhir/agentforge_labs.ts` (new) — sidecar-endpoint hook
- `patient-dashboard/src/proposals/proposalsApi.ts` — `rejectProposal`, `setSectionRejected`, `ConfirmResult.detail`
- `patient-dashboard/src/proposals/proposalBus.ts` — `proposal:queue_state` event added
- `patient-dashboard/src/patient/PatientDashboardPage.tsx` — `intake_bundle` route, `agentforge-labs` invalidator

**Documentation**
- `Documentation/AgentForge/implementation/affordance-queue-iteration.md` — plan rewrite with revision-notes appendix
- `Documentation/AgentForge/process/journal/week-2/` — four session journals (T0132, T0435, T0556, T1030)

## Outcomes

- One queue, one Confirm/Reject vocabulary, one design language across all proposal surfaces. The "three confirm surfaces with three visual languages" pre-existing problem is resolved.
- Bundle proposals (intake form today; lab shape ready) flow end-to-end through to MariaDB writes. Synthetic per-leaf proposal IDs keep PHP idempotency working per-leaf; per-section reject endpoint is race-safe vs concurrent agent payload PATCHes.
- Margaret Chen, James Whitaker, Robert Kowalski intake/lab forms produce visible chart data: medications, demographics, family history, lab observations.
- Extraction quality on Sonnet 4.6 with the sharpened prompt is meaningfully higher than the W2-baseline Haiku output on the QA-form set.
- Diagnostic surface for any future bundle-confirm failure is real-time and structured (`bundle_fan_out_outcomes`, `openemr_invalid_json`, `intake_extractor_schema_fail` logs all carry the data needed to one-line-fix specific failures).
- 427/428 vitest passing on agentforge-api, 145/145 on patient-dashboard, eval suite at 88/88 with 0 gate breaches; CUI typecheck shows only the two pre-existing W2-sweep dead-code errors.

## Next steps

- [ ] Final QA-pass on the remaining of 8 forms; capture any `bundle_fan_out_outcomes` failures for last-minute one-liners.
- [ ] Re-record demo video covering the full intake flow + lab flow + dashboard refresh.
- [ ] Commit + push + final VPS deploy: rebuild `agentforge-api` container, run `agentforge-enable.php` to refresh Manage Modules branding (per the existing memory), import the demo DB if needed.
- [ ] Long-term: replace `OpenEmrObservationWriteAdapter`'s JSON sidecar store with proper `procedure_result` row writes so the dashboard's custom lab endpoint can retire and stock FHIR `/Observation?category=laboratory` becomes the single source.
- [ ] Long-term: fix the three context endpoints that fail on `Unknown column 'patient.uuid'` (`meds.php`, `social_history.php`, `labs.php`) — agent's chart-context reads will be incomplete until then.
- [ ] Phase 5 of the iteration plan (per-target dashboard modals — Medication, Demographics, FamilyHistory) when bandwidth returns post-submission.
- [ ] Tighten lab cross-check posture again post-demo if the trust calculus shifts back to safety-first.
