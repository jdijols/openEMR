# Affordance + Queue Iteration Plan

**Status:** Pre-implementation. Plan agreed; Phase 1 picks up in a fresh chat.
**Last updated:** 2026-05-10
**Owner of this plan:** AgentForge UX, post-W2-submission cleanup track.

---

## Summary

The CUI today renders proposal cards inline in the chat thread (vitals, clinical notes, etc.) plus a dashboard modal for allergies plus a bespoke `IntakeProposalCard` for ingested intake forms. That's three confirm surfaces with three different visual languages and three different code paths. This iteration unifies them behind a single **above-composer affordance** that sits pinned above the chat input, renders one proposal at a time as a **FIFO queue**, and inherits the existing proposal-card design tokens. The dashboard's `AllergyModal` becomes the canonical "rich review" surface; clicking the affordance body re-opens it. For write targets without a modal (vitals, clinical_note, chief_complaint, tobacco), the body-click navigates to the current encounter — same affordance as the CUI's "Today" button.

The end state: one queue, one set of buttons (Confirm / Reject), one design language. Inline proposal cards in the chat thread go away.

---

## Goals

1. **One action surface.** Every pending write — agent-driven or manual — is confirmed or rejected from the same UI element.
2. **Visual consistency.** The affordance uses `ProposalCardShell`'s tokens (white bg, rounded border, header pill, preview body, footer buttons). It must not read as a sent user message.
3. **Queue.** When multiple proposals are pending, they process FIFO (oldest first). After confirm/reject, the next head appears in the same slot with a smooth transition.
4. **Snooze.** X-close on the modal (or click outside it) leaves the proposal `pending` in the queue. Clicking the affordance body re-opens the modal.
5. **Confirm-all bundles.** Intake-form and lab ingestion produce a single bundled affordance. The review modal opens automatically over the dashboard with per-section confirm/reject + bundle-level Confirm All / Reject All.
6. **Voice confirm targets the head of queue** (FIFO), not the latest proposal in thread order.

## Non-goals

- Building dashboard modals for non-allergy write targets (medication, demographics, etc.). Deferred. For now, those proposals confirm directly from the affordance preview line.
- Changing the proposal-lifecycle API or the PHP write surface. The pipeline from `propose_*_write` → `pending_proposals` → `apply_pending_write.ts` → `write/<target>.php` stays as-is.
- Replacing `IntakeProposalCard` entirely. It morphs into the bundle review modal that opens over the dashboard.
- Voice reject. (Voice confirm exists; voice reject is future work.)

---

## Decisions reached in planning chat

| Topic | Decision |
| --- | --- |
| Confirm vs Save / Reject vs Cancel | **Confirm / Reject** everywhere. Modal's current Save/Cancel labels change to Confirm/Reject. |
| X-close behavior | **Snooze.** X-close (or click outside the modal) leaves the proposal `pending`. The affordance stays in the queue. |
| Affordance body click — write targets WITH a modal (allergy, future medication/demographics) | Re-opens the dashboard modal pre-populated with the proposal payload. |
| Affordance body click — write targets WITHOUT a modal (vitals, clinical_note, chief_complaint, tobacco) | Navigates to the current-day encounter view (same as the CUI's "Today" button). |
| Queue order | **FIFO** (oldest unresolved first). |
| Queue counter | Small text top-right of the affordance header reading "1 of N", visible only when N > 1. |
| Auto-advance | Yes. After confirm/reject, the next head appears automatically in the same slot. Smooth fade transition. No "Next" button. |
| Modal + queue coupling for allergies | **Option A — auto-flow.** When an allergy proposal reaches the head, the modal auto-opens. After confirm, queue advances; if the next head is also an allergy, modal re-opens automatically. |
| Disabled-button matrix | See below. Reject is hidden when no real proposal exists; Confirm requires either an in-flight proposal or a real local change. |
| Voice confirm | Targets the **head** of the queue (FIFO), not `findLatestOpenProposalId`. |
| Snooze persistence | A snoozed proposal survives a reload as long as the conversation cache (and the Postgres `pending_proposals` row) is still alive. The affordance reappears on chart reopen. |
| Bundle proposals (intake form, lab ingestion) | Single affordance ("Confirm all (N)" / "Reject all"). On reaching head of queue, a review modal auto-opens over the dashboard with per-section selectivity + bundle Confirm All / Reject All. |
| Bundle modal — meaning of "Confirm all" after some sections rejected | **Confirm the unrejected sections.** The button label updates dynamically to show the active count (e.g., "Confirm 7 of 10"). |

### Disabled-button matrix

| Mode | Confirm | Reject | X close |
| --- | --- | --- | --- |
| Manual `+` add (no agent proposal) | enabled when substance non-empty | hidden | "close" (no proposal exists, nothing to snooze) |
| Click-to-edit existing row (no agent proposal) | enabled when changes detected vs initial | hidden | "close" (no proposal exists) |
| Agent proposal in flight | always enabled | always enabled | snooze (proposal stays pending) |
| Agent proposal that user further edited | always enabled | always enabled | snooze |

### Per-target preview format spec

The affordance preview body is one line, max ~60 visible characters with truncation. Drafts:

| Write target | Preview format | Example |
| --- | --- | --- |
| `allergy` (add) | `<substance> · <reaction> · <severity>` | "Penicillin · Hives · Severe" |
| `allergy_delete` | `Remove <substance>` | "Remove Penicillin" |
| `chief_complaint` | first ~50 chars of reason text | "Cough and fever for 3 days…" |
| `chief_complaint_delete` | `Clear chief complaint` | "Clear chief complaint" |
| `vitals` | compact key vitals | "BP 120/80 · HR 72 · Wt 180lb" |
| `vitals_delete` | `Void vitals · <date>` | "Void vitals · 2026-05-10" |
| `tobacco` | `Status: <status_label>` | "Status: never smoker" |
| `clinical_note` | first ~50 chars | "Patient denies chest pain…" |
| `clinical_note_update` | `Update note · <first ~30 chars>` | "Update note · Adjust dosing…" |
| `clinical_note_delete` | `Delete note` | "Delete note" |
| `medication_add` | `<name> <dose> · <frequency>` | "Lisinopril 10mg · daily" |
| `medication_discontinue` | `Discontinue <name>` | "Discontinue Lisinopril" |
| `family_history_add` | `<relation>: <condition>` | "Father: heart attack" |
| `document_delete` | `Remove <doc title>` | "Remove Lab — CBC.pdf" |
| `demographics_update` | `Update <comma-list of changed fields>` | "Update phone, address" |
| Bundle: intake | `<section summary>` | "Demographics · 3 medications · 2 allergies · 1 family history" |
| Bundle: lab ingestion | `<panel> · <N results, M abnormal>` | "CBC · 8 results, 2 abnormal" |

Server can include the preview in the proposal `payload` (already partially does — see `propose_writes.ts:589-595`'s `preview` field on the tool result). Adding per-target formatters is small.

---

## Current architecture (as of round 20)

```
[physician dictates]
       │
       ▼
[agent calls propose_*_write tool] ──► insertPendingProposal() ──► pending_proposals row
       │
       ▼
[ChatBlock { type: 'proposal', proposal_id, write_target, preview, payload }]
       │
       ▼
[CUI MessageList renders ProposalBlock] ◄── for write_target ≠ 'allergy'
[CUI broadcasts proposal:open_modal] ───► dashboard's AllergyModal ◄── for write_target = 'allergy'

confirm paths today (three of them):
  1. POST /conversations/:id/confirm  ◄── ProposalBlock buttons (vitals, clinical_note, etc.)
  2. POST /proposals/:id/confirm      ◄── AllergyModal Save button (allergies)
  3. intake_dispatch.ts direct writes ◄── IntakeProposalCard's Confirm (intake forms)

after confirm, all three paths land in the same place:
  → confirmPendingProposal (or intake_dispatch) → POST /write/<target>.php
  → AllergyIntoleranceService::insert / VitalService::store / etc.
  → MariaDB
```

Three render branches, three confirm paths, one storage layer. The plan unifies the first two; the third (intake) becomes a bundle adapter onto path 2.

### Files in scope

CUI (`agentforge/cui/src/`):
- `App.tsx` — owns `messages` state, `findActiveProposal`, broadcasts `proposal:open_modal`, renders `<AboveComposerAffordance>`.
- `proposals/AboveComposerAffordance.tsx` — current implementation reads like a sent message bubble.
- `proposals/proposalBus.ts` — BroadcastChannel event types.
- `chat/MessageList.tsx` — renders `ProposalBlock` inline; suppresses for `allergy` (round 16).
- `chat/ProposalCardShell.tsx` — design tokens we want the affordance to inherit.
- `chat/IntakeProposalCard.tsx` — bundled proposal renderer for intake forms.
- `chat/voice_confirm_proposal.ts` — voice confirm targets `findLatestOpenProposalId`. Needs to become "head of queue."
- `chat/proposal_lookup.ts` — `findLatestOpenProposalId` helper. Becomes `findProposalQueue`.

Dashboard (`patient-dashboard/src/`):
- `cards/AllergyModal.tsx` — Save → Confirm, Cancel → Reject; X-close becomes snooze.
- `cards/AllergiesCard.tsx` — receives `proposal:open_modal` broadcasts; routes to modal.
- `proposals/proposalBus.ts` — mirror of CUI's; `proposal:resolved` event already added (round 20).
- `patient/PatientDashboardPage.tsx` — listens for `chart:updated` to invalidate FHIR cache.

API (`agentforge/api/src/`):
- `tools/propose_writes.ts` — already correct; ensures every proposal mints a `pending_proposals` row. May need a per-target preview formatter helper to populate the proposal `payload.preview`.
- `app.ts` — proposal-lifecycle routes (`POST /proposals`, `PATCH`, `GET /stream`, `POST /confirm`, `POST /reject`). All in place.
- `conversations/apply_pending_write.ts` — server-side confirm/reject. No change needed.

PHP module (`interface/modules/custom_modules/oe-module-agentforge/`):
- All `write/<target>.php` handlers — no change needed. Storage path is already unified.

---

## Target architecture

```
[physician dictates / attaches file]
       │
       ▼
[agent calls propose_*_write OR attach_and_extract]
       │
       ├── single proposal: insertPendingProposal() ──► pending_proposals row (existing)
       │
       └── bundle proposal (intake / lab): insertPendingProposal()
            with payload = { sections: [{target, payload}, ...] }  ◄── new shape

       ▼
[ChatBlock { type: 'proposal', ... }]
       │
       ▼
[MessageList: NO inline proposal card render — block shows resolved-state receipt only]
       │
       ▼
[App.tsx: findProposalQueue(messages) → { head, count, all }]
       │
       ▼
[<AboveComposerAffordance> renders head with ProposalCardShell tokens + counter]
       │
       │  Confirm  ──► POST /proposals/:id/confirm
       │  Reject   ──► POST /proposals/:id/reject
       │  Body click ──► (a) re-open modal if write_target has one
       │             ──► (b) navigate to current-day encounter otherwise
       │
       ▼
[on resolve: SSE status_changed → CUI marks block resolved → queue advances → next head fades in]

modal layer (separate concern, lives in dashboard):
  AllergyModal — listens for proposal:open_modal('allergy') → opens auto
  BundleReviewModal (new) — listens for proposal:open_modal('bundle') → opens over dashboard
```

One render branch, one confirm path, three modal shapes (allergy, bundle, generic preview).

### Bundle proposal payload shape (new)

The bundle is a single `pending_proposals` row whose payload describes the per-section writes:

```json
{
  "kind": "bundle",
  "source": "intake_form",
  "doc_ref_uuid": "...",
  "sections": [
    {
      "section_id": "demographics",
      "title": "Demographics",
      "write_target": "demographics_update",
      "payload": { ... },
      "rejected": false
    },
    {
      "section_id": "medications",
      "title": "Medications",
      "items": [
        { "item_id": "med-1", "write_target": "medication_add", "payload": { ... }, "rejected": false },
        { "item_id": "med-2", "write_target": "medication_add", "payload": { ... }, "rejected": false }
      ]
    },
    ...
  ],
  "preview": "Demographics · 3 medications · 2 allergies · 1 family history"
}
```

Per-section reject flips `rejected: true` via PATCH (the existing `/proposals/:id` PATCH endpoint, shallow-merge). On Confirm All, the server iterates the sections, dispatching to PHP writes for each unrejected one. Failures are reported per-section; the overall proposal status reflects "all confirmed", "partial", or "all rejected".

`apply_pending_write.ts` gets a new branch that detects `payload.kind === 'bundle'` and fans out to the per-section write paths. The existing PHP write handlers don't change.

---

## Phased implementation

### Phase 1 — Foundational affordance + queue

**Scope:** redesign the affordance, build the queue, smooth advance transition. Single-proposal flow only (no bundle yet).

**Files touched:**
- `agentforge/cui/src/proposals/AboveComposerAffordance.tsx` — full rewrite. Render via shared design tokens (or `ProposalCardShell` directly, if it can be repurposed cleanly outside the chat). White bg, rounded border, header with target label and counter, preview body, footer with Confirm + Reject. Drop the light-blue user-bubble look.
- `agentforge/cui/src/chat/proposal_lookup.ts` — replace `findLatestOpenProposalId` with `findProposalQueue` returning `{ head, count, all }`. FIFO order (iterate forward through messages).
- `agentforge/cui/src/App.tsx` — switch from `findActiveProposal` to `findProposalQueue`. Render single affordance for `head`, pass `count` for the "1 of N" indicator. Add CSS-only fade transition on advance (200ms out → state swap → 200ms in).
- `agentforge/cui/src/chat/voice_confirm_proposal.ts` — target `head` of queue instead of latest. One-line change.
- `agentforge/api/src/tools/propose_writes.ts` — extend `payload.preview` to follow the per-target format spec above. Add `formatPreview(target, payload)` helper.

**Acceptance:**
- Single allergy proposal: affordance shows with proposal-card aesthetic, no light-blue bubble look.
- Two allergy proposals dictated back-to-back: first appears with "1 of 2", confirming advances to the second showing "2 of 2", confirming hides the affordance. Smooth fade between.
- Voice "confirm" while two are queued resolves the FIRST (oldest), not the latest.
- All existing tests pass: `npm run typecheck`, `npm run test` (CUI + dashboard), `npm run eval` (88/88).

**Risks:** `ProposalCardShell` is currently rendered inside the chat scroll area; its CSS may assume a specific parent context. May need to extract its design tokens into a standalone `ProposalSurface` component that both the inline ProposalBlock (until Phase 2) and the affordance can consume.

### Phase 2 — Suppress in-chat proposal cards

**Scope:** stop rendering proposal cards inline in the chat thread. The chat shows agent text + a small "Saved" or "Rejected" receipt for resolved proposals; pending ones live entirely in the affordance.

**Files touched:**
- `agentforge/cui/src/chat/MessageList.tsx` — extend the `block.type === 'proposal'` branch from "skip for allergy" to "skip for all write_targets, render only resolved-state receipt". The current allergy-specific `if (block.write_target === 'allergy') return <Fragment />` becomes the universal path.
- `agentforge/cui/src/chat/ProposalBlock.tsx` (or wherever it lives) — keep the resolved-state rendering for the "✓ Saved" receipt, but drop the Confirm/Reject buttons (the affordance owns the action now).

**Acceptance:**
- Vitals dictation: affordance shows in queue. No inline proposal card in chat thread. Confirm fires from the affordance, server-side path unchanged.
- Clinical note dictation: same.
- Confirmed proposals show a small "Saved." receipt at the original spot in the chat thread (so the conversation still has a written trail of what happened).
- Existing eval categories — `no_write_without_confirm`, `unsupported_write_target_rejected`, etc. — all still pass. The check rules inspect trace context, not UI rendering, so this is safe.

**Risks:** Voice confirm is currently scoped to assistant messages with a proposal block. Confirm that the head-of-queue lookup still works without inline rendering. (Should — `findProposalQueue` reads `messages` state, not DOM.)

### Phase 3 — Modal contract refactor

**Scope:** the AllergyModal becomes the prototype for the modal contract. Save → Confirm. Cancel → Reject. X-close = snooze (proposal stays pending; modal just closes). Click outside the modal = snooze (same as X). Click on affordance body = re-opens this modal pre-populated with the proposal.

**Files touched:**
- `patient-dashboard/src/cards/AllergyModal.tsx`:
   - Rename Save → Confirm, Cancel → Reject. Both call the proposal lifecycle API (`POST /proposals/:id/confirm` or `/reject`).
   - X-close button (top-right) becomes "snooze" — closes the modal locally, leaves the proposal in `pending` status. Backdrop click does the same.
   - Implement the disabled-button matrix above. Reject hidden when in manual `+` mode or click-to-edit-with-no-changes; Confirm conditional on substance presence and/or changes-vs-initial.
- `agentforge/cui/src/proposals/AboveComposerAffordance.tsx`:
   - Add body-click handler. For write_targets with a modal (allergy now; later: medication, demographics), broadcasts `proposal:open_modal` to re-open the modal. For modal-less targets (vitals, clinical_note, chief_complaint, tobacco), emits a NAV_REQUEST envelope to `parent.window` (same mechanism the existing `requestEncounterNavigation` uses) to navigate to the current-day encounter view.
   - Stop click events from buttons (✓, ✗) bubbling to the body click handler.

**Acceptance:**
- Open an allergy modal via dictation → X-close → affordance still in queue → click affordance body → modal re-opens with same payload state.
- Click outside an open modal → modal closes → affordance still in queue. Same as X-close.
- Manual `+` add → modal opens, no Reject button. Confirm disabled until substance entered.
- Click-to-edit existing allergy → modal opens, no Reject button (no agent proposal exists). Confirm disabled until a field changes from initial.
- Vitals dictation produces an affordance → click body → CUI navigates to encounter view (same UX as clicking "Today" in the CUI header).

**Risks:**
- Voice "reject" doesn't exist yet, so the only reject path is the affordance ✗ button. Document this so demo doesn't try to reject by voice.
- "Modal contract" so far means AllergyModal. When Phase 5 adds MedicationModal / DemographicsModal, they need to follow the same Confirm / Reject / X-snooze pattern. Codify this as a `ProposalModalProps` interface to enforce.

### Phase 4 — Bundle proposals (intake form, lab ingestion)

**Scope:** intake forms and lab ingestion produce a single bundle proposal that lands in the queue. When the bundle reaches the head, a `BundleReviewModal` auto-opens over the dashboard. Modal shows per-section confirm/reject toggles + bundle-level Confirm All / Reject All. Confirm All commits the unrejected sections; "Confirm 7 of 10" updates dynamically.

**Files touched:**
- `agentforge/api/src/tools/attach_and_extract.ts` (or wherever the intake/lab flow assembles its proposal) — change from emitting an `extraction` chat block + bespoke IntakeProposalCard to inserting a `pending_proposals` row with a `kind: 'bundle'` payload (shape above) and emitting a normal `proposal` chat block.
- `agentforge/api/src/conversations/apply_pending_write.ts` — add a branch for `payload.kind === 'bundle'`. Iterates `payload.sections`, fans out to each section's `write_target` write handler, collects per-section results, returns aggregate accept/partial/reject.
- `patient-dashboard/src/cards/BundleReviewModal.tsx` (new) — opens via `proposal:open_modal` broadcast for bundle proposals. Renders per-section rows with toggle (✓ / ✗) and a footer with "Confirm <count> of <total>" + "Reject all". Per-section ✗ flips a local `rejected: true` flag and PATCHes the proposal payload via `/proposals/:id` PATCH (shallow-merge into `payload.sections`). Confirm fires `POST /proposals/:id/confirm`; server-side fans out using the same `payload.sections` it sees.
- `agentforge/cui/src/chat/IntakeProposalCard.tsx` — deleted, or kept as a fallback for non-dashboard contexts. Lean: deleted.
- `agentforge/cui/src/chat/MessageList.tsx` — drop the `extraction` block special-case rendering once the bundle migration is complete.

**Acceptance:**
- Drop an intake PDF in the composer. After `attach_and_extract` returns, the affordance shows "Confirm all (10)" with a preview like "Demographics · 3 medications · 2 allergies · 1 family history". The dashboard auto-opens the BundleReviewModal over the page.
- Toggle 2 sections to rejected. The affordance + modal Confirm button updates to "Confirm 8 of 10".
- Click Confirm All → server fans out 8 writes → all 10 sections appear as resolved (8 confirmed, 2 rejected) in the audit trail.
- Same flow for a lab PDF.
- Click the affordance body for a bundle proposal → re-opens the BundleReviewModal preserving the per-section state.

**Risks:**
- This is the biggest refactor. The existing `intake_dispatch.ts` direct-write path goes away in favor of the bundle confirm. Need to verify all the per-section write handlers still get the right payload shape.
- The IntakeProposalCard had useful per-section progress indicators ("✓ 4 of 4 applied"). The BundleReviewModal needs equivalent affordances post-confirm so the physician can see what landed and what didn't.
- Per-section reject persistence: a snoozed bundle that was partially rejected must remember the rejected sections across reload. Needs a small server-side schema decision: do we store `rejected: true` per-section in the payload (yes, per the shape above), or in a separate audit table? Payload is fine for now.

### Phase 5 — Per-target dashboard modals (deferred)

Builds `MedicationModal`, `DemographicsModal`, `FamilyHistoryModal`. Each follows the `ProposalModalProps` contract from Phase 3.

Until Phase 5 ships, the affordance for those targets confirms directly from the preview line; body-click navigates to the appropriate dashboard card section (e.g., medication body-click scrolls to MedicationsCard).

**Out of scope for the iteration this plan covers.**

---

## Test plan

Per phase, the verification steps are listed in the Acceptance section above. Cross-phase smoke checks the new chat session should run after each phase:

1. **Eval suite stays at 88/88.** `cd agentforge/api && npm run eval`. Gate breaches must remain 0. The check rules inspect trace context, not UI; they should be unaffected.
2. **Dashboard tests pass.** `cd patient-dashboard && npx vitest run`. Currently 12 tests directly exercise allergy modal + card; expect those to continue passing through Phase 3.
3. **Manual smoke**: dictate an allergy add; dictate two more in sequence; verify FIFO advance, voice confirm targets head, X-close snoozes, body-click reopens.
4. **Round-trip smoke**: confirm an allergy via affordance → MariaDB lists row appears → dashboard AllergiesCard refreshes via `chart:updated` broadcast (existing).

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| `ProposalCardShell` CSS assumes chat-scroll parent context; reusing it in the affordance breaks layout. | Extract a `ProposalSurface` lower-level component that owns the design tokens; both the affordance and the inline ProposalBlock (during Phase 1, before Phase 2 strips it) consume it. |
| Voice confirm scoped to "latest" silently breaks queue UX. | Phase 1 includes the `findProposalQueue` migration; Phase 1 acceptance test explicitly covers voice-confirm-targets-head. |
| Snoozed proposals accumulate forever (queue grows unbounded). | Server-side: existing `pending_proposals` rows have a `created_at`; can add a TTL job in a follow-up if accumulation becomes real. For tonight, ignored — physicians clear queues fast. |
| Bundle proposals have a different payload shape; PHP write handlers don't know to iterate. | Bundle fan-out lives entirely in `apply_pending_write.ts`. PHP handlers continue to receive single-write payloads. No PHP change needed. |
| Phase 2 strips ProposalBlock buttons; legacy tests that simulate clicking those buttons fail. | Phase 2 acceptance includes test updates: tests that previously asserted "Confirm button exists in proposal block" become "Confirm button exists in affordance for matching proposal_id". |

---

## Open items / future iterations

- **Voice reject.** Symmetric to voice confirm. Needs `transcriptSegmentIndicatesReject` parser + plumbing to call `postProposalReject`.
- **Per-target dashboard modals (Phase 5).** Medication, demographics, family history. Each follows the `ProposalModalProps` contract from Phase 3.
- **Snooze TTL.** If a proposal sits in `pending` for > N hours, auto-reject + audit.
- **Queue persistence across patient switch.** Today, switching patients reloads the chat thread. Pending proposals for patient A persist in `pending_proposals` but the new chart's CUI doesn't see them until the agent calls `get_proposals` (which doesn't exist yet). Decide: load all pending for the patient on chart open, or keep the "queue is per-conversation" model.
- **Conflict UX when affordance and modal disagree.** If the agent edits a proposal payload while the modal is open with stale state, an SSE PATCH event fires. The modal already has focus-protection (round 11) but might still show transient inconsistency. Worth a smoke test post-implementation.

---

## Implementation order suggestion for the next chat

1. Phase 1 — affordance redesign + queue + voice-confirm fix. ~3-4h. Foundation for everything else.
2. Phase 2 — suppress inline proposal cards. ~1h. Cleanup.
3. Phase 3 — modal contract refactor (Allergy first). ~2-3h. Establishes the modal contract.
4. Phase 4 — bundle proposals. ~4-6h. Biggest refactor; ship last.
5. Phase 5 — deferred.

If time-constrained, Phases 1-3 deliver the unified affordance UX for single-proposal flows. Phase 4 can ship as a follow-up.

---

## References

- Round-by-round implementation history of the affordance (rounds 11–20) lives in the chat transcript that produced this plan. Key decisions:
   - Round 11 — affordance introduced for allergy.
   - Round 16 — in-chat proposal card suppressed for allergy specifically; agent reaction normalized server-side.
   - Round 19 — agent prompt tightened to call `get_allergies` before proposing add.
   - Round 20 — `proposal:resolved` BroadcastChannel event so dashboard saves dismiss the affordance.
- `Documentation/AgentForge/implementation/v2-roadmap.md` — broader V2 sequencing.
- `interface/modules/custom_modules/oe-module-agentforge/public/write/` — the PHP write surface this plan does not touch.
