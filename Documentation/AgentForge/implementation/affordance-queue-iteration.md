# Affordance + Queue Iteration Plan

**Status:** Pre-implementation. Plan agreed; Phase 1 picks up in a fresh chat.
**Last updated:** 2026-05-10 (revised after second-pass critique — see "Revision notes" at the bottom).
**Owner of this plan:** AgentForge UX, post-W2-submission cleanup track.

---

## Summary

The CUI today has four components that render the Confirm/Reject decision: the in-chat `ProposalBlock`, the above-composer `AboveComposerAffordance`, the dashboard `AllergyModal`, and the bespoke `IntakeProposalCard`. (Three logical "surfaces": ProposalBlock + AboveComposerAffordance render the same proposal for non-allergy targets; AllergyModal owns allergy; IntakeProposalCard owns intake bundles.) That's three different visual languages and three different code paths feeding one storage layer.

This iteration unifies them behind a single **above-composer affordance** that sits pinned above the chat input, renders one proposal at a time as a **FIFO queue**, and inherits the `ProposalCardShell` design tokens. The dashboard's `AllergyModal` becomes the canonical "rich review" surface; clicking the affordance body re-opens it. For write targets without a modal (vitals, clinical_note, chief_complaint, tobacco), the body-click navigates to the current encounter — same affordance as the CUI's "Today" button. Bundles (intake form, lab ingestion) collapse into a single bundle proposal that opens a `BundleReviewModal` on dashboard.

The end state: one queue, one set of buttons (Confirm / Reject), one design language. Inline proposal cards in the chat thread go away.

---

## Goals

1. **One action surface.** Every pending write — agent-driven or manual — is confirmed or rejected from the same UI element.
2. **Visual consistency.** The affordance uses `ProposalCardShell`'s tokens (white bg, rounded border, header pill, preview body, footer buttons). It must not read as a sent user message.
3. **Queue.** When multiple proposals are pending, they process FIFO (oldest first). After confirm/reject, the next head appears in the same slot with a smooth transition.
4. **Snooze.** X-close on the modal (or click outside it) leaves the proposal `pending` in the queue. Clicking the affordance body re-opens the modal.
5. **Confirm-all bundles.** Intake-form and lab ingestion produce a single bundled affordance. The review modal opens automatically over the dashboard with per-section confirm/reject + bundle-level Confirm All / Reject All.
6. **Voice confirm targets the head of queue** (FIFO), not the latest proposal in thread order, and is a no-op when the queue is empty.

## Non-goals

- Building dashboard modals for non-allergy targets (medication, demographics, etc.). Deferred to Phase 5. Until then, those proposals confirm directly from the affordance preview line.
- Changing the proposal-lifecycle API or the PHP write surface. The pipeline from `propose_*_write` → `pending_proposals` → `apply_pending_write.ts` → `write/<target>.php` stays as-is for **single** proposals. Bundles add a server-side fan-out branch (Phase 4) that is invisible to PHP.
- Replacing `IntakeProposalCard` entirely. It morphs into the bundle review modal that opens over the dashboard.
- Voice reject. (Voice confirm exists; voice reject is future work.)

---

## Decisions reached in planning chat

| Topic | Decision |
| --- | --- |
| Confirm vs Save / Reject vs Cancel | **Confirm / Reject everywhere.** Modal's current Save → Confirm. Cancel button is **removed** (see modal close semantics below). |
| Modal close semantics | Two operations only: **Reject** (explicit button; ends the proposal) and **Snooze** (X-close, backdrop click; leaves proposal pending). The previous Cancel button is **removed** — its current click handler `handleClose` is identical to X / backdrop, so dropping the button preserves the existing gesture under the universal X-as-close pattern that physicians already encounter in every other web app. Adding a third labeled button (Reject + Snooze + Confirm) was considered and rejected: relabeling Cancel → Reject would silently flip a familiar gesture from "dismiss" to "reject" mid-iteration (footgun); keeping Cancel as a labeled Snooze button alongside Reject and Confirm produces a three-button footer that is busier than the standard modal pattern without actually improving discoverability — X is a universal close affordance with consistent placement. The win condition is that a physician who closes the modal without acting (X / backdrop) gets exactly what every other modal in the EMR does, and Reject is the only button whose semantics are AgentForge-specific. |
| Affordance body click — write targets WITH a modal (allergy, future medication/demographics) | Re-opens the dashboard modal pre-populated with the proposal payload. |
| Affordance body click — write targets WITHOUT a modal (vitals, clinical_note, chief_complaint, tobacco) | Navigates to the current-day encounter view (same as the CUI's "Today" button). |
| Queue order | **FIFO** (oldest unresolved first). |
| Queue scope | **Conversation-scoped** for the CUI's `findProposalQueue(messages)` lookup. The server-side `pending_proposals` table filter (used by cross-session reload paths in Phase 4) gains `WHERE conversation_internal_id = ?`, so reopening a chart in a *different* conversation does not surface a queue from a stale prior conversation. |
| Queue counter | Small text top-right of the affordance header reading "1 of N", visible only when N > 1. Reuses `ProposalCardShell.targetLabel` slot. |
| Auto-advance | Yes. After confirm/reject, the next head appears automatically in the same slot. Smooth fade transition. No "Next" button. |
| Modal auto-open invariants for allergy / bundle | Auto-open fires **only** when the head transitions because the user just confirmed or rejected the previous head. Auto-open does **not** fire on (a) initial messages load / cache replay on chart open — the user should see the affordance first and click into it; (b) head advance immediately after the user explicitly snoozed the previous head — snooze means "let me come back to it" and auto-popping undoes that intent. |
| Voice confirm | Targets the **head** of the queue (FIFO), not `findLatestOpenProposalId`. No-op when queue is empty. |
| Snooze persistence | A snoozed proposal survives a reload as long as the conversation cache (and the Postgres `pending_proposals` row) is still alive. The affordance reappears on chart reopen but the modal does not auto-open. |
| Bundle proposals (intake form, lab ingestion) | Single affordance ("Confirm all (N)" / "Reject all"). On reaching head of queue, a review modal auto-opens over the dashboard with per-section selectivity + bundle Confirm All / Reject All. |
| Bundle modal — meaning of "Confirm all" after some sections rejected | **Confirm the unrejected sections.** The button label updates dynamically to show the active count (e.g., "Confirm 7 of 10"). |
| Per-section reject mechanism for bundles | **Dedicated endpoint** `POST /proposals/:id/items/reject` (and `/restore`) using `jsonb_set` on the indexed path inside `payload.sections`. **Not** a PATCH that shallow-merges the whole `sections` array — that would race with concurrent `payload_updated` SSE updates from the agent and silently drop state. (See "Per-section state transitions" below.) |
| Bundle fan-out idempotency | Server-side fan-out in `apply_pending_write.ts` mints **synthetic per-section proposal IDs** of the form `${bundleProposalId}::${sectionId}` (with a third `::${itemId}` segment for repeated rows like medications). Each synthetic ID is recorded in `agentforge_completed_write_proposal` so the PHP ledger's duplicate detection (`DuplicateProposalExecutionException`) does not collapse N writes into one. (See "Bundle fan-out idempotency" below.) |
| Bundle encounter binding | Bundles encode `encounter_id?: number` **at the section level**, not at the bundle root. A single bundle may mix encounter-bound sections (chief complaint) and patient-scoped sections (allergies, medications). The `pending_proposals.encounter_id` column on the bundle row is `null`. |
| Disabled-button matrix | See below. Reject hidden when no real proposal exists; Confirm requires either an in-flight proposal or a real local change. |

### Disabled-button matrix

| Mode | Confirm | Reject | X close / backdrop |
| --- | --- | --- | --- |
| Manual `+` add (no agent proposal) | enabled when substance non-empty | hidden (nothing to reject) | "close" — no proposal exists, nothing to snooze |
| Click-to-edit existing row (no agent proposal) | enabled when changes detected vs initial | hidden | "close" |
| Agent proposal in flight | always enabled | always enabled | snooze (proposal stays pending) |
| Agent proposal that user further edited | always enabled | always enabled | snooze |
| Manual `+` add while a queued agent proposal is pending for the *same* target type | **forbidden** — affordance must be resolved or snoozed first; manual `+` button is disabled with tooltip "Resolve the pending allergy proposal first." | n/a | n/a |
| Network failure during Confirm or Reject | affordance flips to `failed` state with retry button; the `pending_proposals` row is unchanged so the next click of Retry re-runs the same lifecycle call | retry resumes the click that failed | snooze still available |

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

Today the per-target preview string lives only on the tool-result envelope returned by `propose_*_write` (e.g. `propose_writes.ts:583, 631, 768, 865, 917, 973, 1022`). It is **not** persisted in `pending_proposals.payload`. Phase 2 fixes this with a shared `formatPreview(target, payload)` helper that runs at every `insertPendingProposal` callsite and stores the result in `payload.preview`.

The load-bearing reason this matters is the **`BundleReviewModal` direct-read path** (Phase 4): the dashboard modal reads `/proposals/:id` directly from the lifecycle API rather than walking the chat thread, so it has no chat-block envelope to fall back on. Without `payload.preview`, every bundle render would re-derive its preview from a TS mirror of `formatPreview` running over the section list — a second source of truth that drifts the moment server-side formatting changes. Persisting once, server-side, at write time keeps the preview canonical.

Secondary benefits: the CUI affordance keeps working through a tab refresh even if the conversation cache is cold, and a single shared `formatPreview` removes the risk of CUI and dashboard rendering different preview strings for the same proposal. Cross-physician / cross-session access is **not** a Week-2 driver — chat conversations remain session-scoped — but the same persistence makes that case work later when it lands.

---

## Bundle proposal payload shape

Authoritative spec — every other section refers back to this. Stored as `pending_proposals.payload` on a single row whose `write_target` is the new sentinel `bundle` (or `intake_bundle` / `lab_bundle` if we want to preserve coarse type at the row level — TBD in Phase 4, not load-bearing for the rest of the plan).

```json
{
  "kind": "bundle",
  "source": "intake_form",
  "doc_ref_uuid": "f3...",
  "preview": "Demographics · 3 medications · 2 allergies · 1 family history",
  "sections": [
    {
      "section_id": "demographics",
      "title": "Demographics",
      "write_target": "demographics_update",
      "encounter_id": null,
      "payload": { "phone": "555-...", "address": "..." },
      "rejected": false
    },
    {
      "section_id": "chief_concern",
      "title": "Chief concern",
      "write_target": "chief_complaint",
      "encounter_id": 4912,
      "payload": { "reason": "Annual physical" },
      "rejected": false
    },
    {
      "section_id": "medications",
      "title": "Medications",
      "items": [
        {
          "item_id": "med-1",
          "write_target": "medication_add",
          "encounter_id": null,
          "payload": { "name": "Lisinopril", "dose": "10mg", "frequency": "daily" },
          "rejected": false
        },
        {
          "item_id": "med-2",
          "write_target": "medication_add",
          "encounter_id": null,
          "payload": { "name": "Metformin", "dose": "500mg", "frequency": "BID" },
          "rejected": false
        }
      ]
    }
  ]
}
```

Section-level rules:

- A **section** is either a single write (has its own `write_target` + `payload` + `rejected`) or a list of **items** that share a section title (each item has its own `write_target` + `payload` + `rejected`).
- `encounter_id` lives on **whichever leaf actually performs the write** (the section itself for single-write sections, each item for list-shaped sections). The bundle row's top-level `pending_proposals.encounter_id` is `null`. This is required because intake bundles routinely mix encounter-bound `chief_complaint` with patient-scoped `allergy` / `medication` writes.
- `rejected: true` is the only mutable per-leaf field. The agent does not edit `rejected`; only the dashboard's `BundleReviewModal` does, via the dedicated reject endpoint.

### Per-section state transitions

```
POST /proposals/:id/items/reject       body: { section_id: string, item_id?: string }
POST /proposals/:id/items/restore      body: { section_id: string, item_id?: string }
```

Server resolves the section/item path inside `payload.sections`, then updates the single boolean leaf with `jsonb_set` so concurrent `payload_updated` events from the agent (e.g. the agent rewriting section 7's payload while the physician is rejecting section 3) do **not** stomp the rejection state. Implementation sketch:

```sql
UPDATE agentforge.pending_proposals
SET payload = jsonb_set(
  payload,
  ('{sections,' || $section_idx || ',items,' || $item_idx || ',rejected}')::text[],
  $rejected::jsonb
)
WHERE proposal_id = $proposal_id AND status = 'pending'
```

`section_idx` and `item_idx` are resolved server-side by scanning `payload.sections` for the supplied `section_id` / `item_id` — the URL/body keys are stable IDs, not positional indices, so the agent re-ordering sections does not break already-issued reject calls. After the `jsonb_set`, the server emits a `payload_updated` SSE event so any open `BundleReviewModal` reflects the change live.

The existing top-level PATCH endpoint (`PATCH /proposals/:id`, served by `updatePendingProposalPayload` in `store.ts:315-369`) **must not** be reused for per-section reject. Its Postgres `||` shallow-merge replaces top-level keys wholesale; PATCHing `{ sections: [...] }` would race against the agent's concurrent payload edits and last-write-wins on the entire array. The PATCH endpoint stays for the agent's `update_proposal` tool path (where the whole payload genuinely is being replaced).

### Bundle fan-out idempotency

`apply_pending_write.ts` gains a branch that detects `payload.kind === 'bundle'` and walks the section/item tree:

1. For each non-rejected leaf (section or item), build the per-leaf write body (`buildOpenEmrWriteBody` already handles encounter routing per `write_target`).
2. **Synthesize a per-leaf proposal_id** of the form:
   - `${parentBundleId}::${section_id}` for single-write sections
   - `${parentBundleId}::${section_id}::${item_id}` for items
3. POST to the existing `write/<target>.php` handler with the synthetic `proposal_id`. The PHP `MysqlCompletedWriteProposalLedger::hasSuccessfulCompletion` check will see each synthetic ID as fresh and let the write through; if the bundle is re-applied (retry), the same synthetic IDs collide on the second pass and the ledger short-circuits — exactly the per-leaf idempotency we want.
4. Collect per-leaf outcomes (`{ section_id, item_id?, ok, reason? }`) into an aggregate result.
5. Mark the bundle's `pending_proposals.status` as `confirmed` (regardless of partial failures inside — the ledger row already records which leaves succeeded). Aggregate `accepted: true` if at least one leaf succeeded; the response body carries the per-leaf detail so the BundleReviewModal can show "8 confirmed, 2 rejected, 0 failed."

Why synthetic IDs and not the bundle's own ID for every leaf: the existing PHP ledger throws `DuplicateProposalExecutionException` the second time it sees a `proposal_id` (`AllergyWriteAction.php` and the other 13 action handlers all have this check). Reusing the bundle ID would let the first leaf write succeed, then fail every subsequent leaf as a duplicate — producing a silent partial write masquerading as success.

The synthetic ID format encodes the parent. If we later need a "find all leaves of bundle X" query for audit, we can either grep proposal_ids or add a `parent_proposal_id` column to `agentforge_completed_write_proposal` — out of scope for this plan but cheap to add. Audit display logic ("the bundle was confirmed; section 3 was rejected") reads `pending_proposals.payload.sections[*].rejected` for the rejection state and the ledger for the confirmed state.

**Schema constraints on synthetic IDs.** The MariaDB `agentforge_completed_write_proposal.proposal_id` column is `VARCHAR(191)` (verified in `sql/table.sql`). With a 36-char UUID parent + `::` separators + section_id + item_id, the budget is **151 chars for `section_id` + `item_id` combined**. To stay safely inside this:

- `section_id` and `item_id` **must be slug-style identifiers** (snake_case or kebab-case ASCII, ≤ 32 chars each). Schema-validated at the bundle-construction site (`attach_and_extract.ts`).
- `section_id` and `item_id` **must not contain `::`** — that's the separator. The bundle assembler asserts this and fails loud on violation; controlled vocabularies (`demographics`, `chief_concern`, `medications`, etc.) and generated slugs (`med-1`, `alg-2`) cannot collide naturally, but the assertion catches future regressions.
- Postgres `pending_proposals.proposal_id` is `TEXT` (unbounded) — no constraint on that side.

If a future bundle source ever needs longer or composite identifiers, switch the synthetic-ID encoding to a content hash (`${parent}::${sha1(section_id, item_id).slice(0, 12)}`) and store a separate map in the bundle payload — but for the in-scope intake/lab bundles, slug IDs are well within budget.

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
[CUI App.tsx renders AboveComposerAffordance] ◄── for ANY unresolved proposal (latest, LIFO)
[CUI broadcasts proposal:open_modal] ───► dashboard's AllergyModal ◄── for write_target = 'allergy'
                                                                       (broadcasts for every
                                                                        unresolved proposal,
                                                                        not just the head)

confirm paths today (three of them):
  1. POST /conversations/:id/confirm  ◄── ProposalBlock buttons (vitals, clinical_note, etc.)
  2. POST /proposals/:id/confirm      ◄── AllergyModal Save button (allergies)
  3. intake_dispatch.ts direct writes ◄── IntakeProposalCard's Confirm (intake forms)

after confirm, all three paths land in the same place:
  → confirmPendingProposal (or intake_dispatch) → POST /write/<target>.php
  → MysqlCompletedWriteProposalLedger::hasSuccessfulCompletion (idempotency on proposal_id)
  → AllergyIntoleranceService::insert / VitalService::store / etc.
  → MariaDB
```

Three confirm paths, four render branches (ProposalBlock / AboveComposerAffordance / AllergyModal / IntakeProposalCard), one storage layer. The plan unifies the action surface (Phase 1-3) and folds intake into the same shape (Phase 4).

### Files in scope

CUI (`agentforge/cui/src/`):
- `App.tsx` — owns `messages` state. Today: inline `useMemo`'d `activeProposal` (lines 508-521) walks backwards through messages = LIFO. The broadcast `useEffect` (lines 533-560) iterates **every** unresolved allergy proposal and broadcasts `proposal:open_modal` for each, gated only by a dedup `Set` ref — so two back-to-back allergy proposals fire two events and the dashboard's `setAgentProposalId` state ends up pinned to the second one even though the first is still at the head of the queue. Phase 1 replaces both with a `findProposalQueue(messages) → { head, count, all }` helper and a head-only broadcast that fires when the head id changes (and only as a result of confirm/reject completion, per the auto-open invariants).
- `proposals/AboveComposerAffordance.tsx` — current implementation reads like a sent message bubble. Phase 1 rewrites with `ProposalCardShell` tokens.
- `proposals/proposalBus.ts` — BroadcastChannel event types (CUI ↔ dashboard, same origin). Mirror lives at `patient-dashboard/src/proposals/proposalBus.ts`.
- `chat/MessageList.tsx` — renders `ProposalBlock` inline; suppresses for `allergy` (round 16). Phase 2 universalizes the suppression.
- `chat/ProposalCardShell.tsx` — purely presentational (read confirmed: no parent context consumers, no portals, only CSS classes). Affordance can consume it directly.
- `chat/IntakeProposalCard.tsx` — bundled proposal renderer for intake forms. Phase 4 deletes it.
- `chat/voice_confirm_proposal.ts` — voice confirm targets `findLatestOpenProposalId`. Phase 1 retargets to `findProposalQueue().head`.
- `chat/proposal_lookup.ts` — `findLatestOpenProposalId` (lines 4-17) **does not filter `b.resolved`** — a latent bug where voice "confirm" can re-target an already-resolved proposal. Phase 1's `findProposalQueue` replaces it with a resolved-aware FIFO walk.

Dashboard (`patient-dashboard/src/`):
- `cards/AllergyModal.tsx` — Save → Confirm; **Cancel button removed**; X-close + backdrop = snooze (calls existing `handleClose` at line 559 unchanged in semantics, but the explicit Cancel button at line 667 goes away). New explicit Reject button rendered conditionally per the disabled-button matrix.
- `cards/AllergiesCard.tsx` — receives `proposal:open_modal` broadcasts (line 34-35); routes to modal. Phase 1's head-only broadcast change makes the `setAgentProposalId(event.proposal_id)` correct under multi-proposal queues.
- `proposals/proposalBus.ts` — mirror of CUI's; `proposal:resolved` event already added (round 20).
- `cards/BundleReviewModal.tsx` (new, Phase 4).
- `proposals/preview_formatters.ts` (new, Phase 2 — mirror of CUI/server formatters for fresh-load rendering).
- `patient/PatientDashboardPage.tsx` — listens for `chart:updated` to invalidate FHIR cache.

API (`agentforge/api/src/`):
- `tools/propose_writes.ts` — every `insertPendingProposal` callsite (14 of them, lines 320, 365, 416, 460, 517, 574, 622, 694, 752, 808, 856, 908, 963, 1013) gets `payload.preview` populated via the new shared `formatPreview` helper. The existing tool-result envelope `preview` field stays so the chat-block path is unchanged.
- `app.ts` — proposal-lifecycle routes (`POST /proposals`, `PATCH`, `GET /stream`, `POST /confirm`, `POST /reject`). **Phase 4 adds** `POST /proposals/:id/items/reject` and `POST /proposals/:id/items/restore`.
- `conversations/store.ts` — `updatePendingProposalPayload` (lines 315-369) stays for top-level PATCH (agent's `update_proposal` tool). New `setSectionRejected(proposalId, sectionId, itemId?, rejected)` function added for per-section transitions, using `jsonb_set`.
- `conversations/apply_pending_write.ts` — Phase 4 adds the `payload.kind === 'bundle'` branch; existing single-write path unchanged. `buildOpenEmrWriteBody` (lines 60-91) is reused per-leaf; the section-level `encounter_id` flows through unchanged.
- `conversations/proposal_bus.ts` — server-side SSE pub-sub (`payload_updated`, `status_changed`). Phase 4 ensures `payload_updated` fires after `setSectionRejected` so any open `BundleReviewModal` reflects live.
- `conversations/preview_formatters.ts` (new, Phase 2) — `formatPreview(target: WriteTarget | 'bundle', payload): string`.

PHP module (`interface/modules/custom_modules/oe-module-agentforge/`):
- All `write/<target>.php` handlers — no change. Storage path is already unified.
- `src/Write/MysqlCompletedWriteProposalLedger.php` — no change. The bundle fan-out works because synthetic per-leaf IDs are fresh on first apply and idempotent on retry.

---

## Target architecture

```
[physician dictates / attaches file]
       │
       ▼
[agent calls propose_*_write OR attach_and_extract]
       │
       ├── single proposal: insertPendingProposal()
       │        payload = { ..., preview: formatPreview(target, payload) }
       │
       └── bundle proposal (intake / lab): insertPendingProposal()
            payload = { kind: 'bundle', sections: [...], preview: formatPreview('bundle', ...) }
            top-level encounter_id = null (encounter is per-section)
       │
       ▼
[ChatBlock { type: 'proposal', ... }]
       │
       ▼
[MessageList: NO inline proposal card render — block shows resolved-state receipt only]
       │
       ▼
[App.tsx: findProposalQueue(messages) → { head, count, all }]   FIFO, filters b.resolved
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
       │
       ▼
[on advance THAT CAME FROM A USER CONFIRM/REJECT: emit proposal:open_modal for new head]
[on advance from cache replay or after explicit snooze: do NOT auto-open modal]

modal layer (separate concern, lives in dashboard):
  AllergyModal — listens for proposal:open_modal('allergy') → opens auto
  BundleReviewModal — listens for proposal:open_modal('bundle') → opens over dashboard
                       per-section ✗ → POST /proposals/:id/items/reject (jsonb_set, race-safe)
                       Confirm All → POST /proposals/:id/confirm → server fan-out with
                                     synthetic per-leaf proposal_ids in PHP ledger
```

One render branch in chat, one confirm path per proposal type, per-target modal contract.

---

## Phased implementation

### Phase 1 — Foundational affordance + queue + head-only broadcast

**Scope:** redesign the affordance, build the FIFO queue, fix the broadcast effect to be head-aware, fix voice confirm to filter resolved.

**Files touched:**
- `agentforge/cui/src/proposals/AboveComposerAffordance.tsx` — full rewrite. Render via `ProposalCardShell` directly (its CSS only depends on its own classes, no parent-context coupling). White bg, rounded border, header with target label + counter (using the `targetLabel` slot), preview body, footer with Confirm + Reject. Drop the light-blue user-bubble look.
- `agentforge/cui/src/chat/proposal_lookup.ts` — replace `findLatestOpenProposalId` with `findProposalQueue` returning `{ head, count, all }`. **FIFO order** (iterate forward through messages). **Filters out `b.resolved !== undefined`.** Voice confirm consumers route through the new helper.
- `agentforge/cui/src/App.tsx`:
  - Replace the inline `activeProposal` `useMemo` (lines 508-521) with `findProposalQueue(messages)`. Pass `head` to the affordance, `count` for the "1 of N" indicator.
  - Rewrite the broadcast `useEffect` (lines 533-560): instead of iterating every unresolved proposal and broadcasting per-id, watch only the head id. Track `lastBroadcastedHeadIdRef` (a `useRef<string | null>`). On head change, broadcast iff (a) the change is **not** the initial mount/replay and (b) the previous head was not just snoozed by the user (track the snooze locally via the `proposal:modal_closed` event the modal already emits).
  - CSS-only fade transition on advance (200ms out → state swap → 200ms in).
- `agentforge/cui/src/chat/voice_confirm_proposal.ts` — target `findProposalQueue(messages).head?.proposalId` instead of latest. Voice "confirm" while head is null is a no-op (existing telemetry should record `voice_confirm_no_op` so eval can assert it).
- (No server changes in Phase 1.)

**Acceptance:**
- Single allergy proposal: affordance shows with proposal-card aesthetic, no light-blue bubble look. Allergy modal auto-opens (head transition from null → first, but ONLY because this is a brand-new proposal arriving — see sub-test below).
- Two allergy proposals dictated back-to-back: first appears with "1 of 2", confirming advances to the second showing "2 of 2", confirming hides the affordance. Smooth fade between. The second proposal's modal auto-opens on advance (post-confirm head change), pre-filled with the **second** proposal's payload, not the first.
- Initial mount: chart open while a stale `pending_proposals` row exists from a prior session (Phase 4 makes this real; for Phase 1 simulate via fixture). Affordance shows but allergy modal does **not** auto-open. User clicks affordance body → modal opens.
- Explicit snooze: dashboard X-close on the modal while affordance has a queue of two → first proposal stays pending → modal closes → affordance still shows → user confirms via affordance keyboard → queue advances → second proposal's modal does **not** auto-open (snooze flag suppresses one auto-open).
- Voice "confirm" while two are queued resolves the FIRST (oldest), not the latest.
- Voice "confirm" while queue is empty is a no-op; trace records `voice_confirm_no_op`.
- All existing tests pass: `npm run typecheck`, `npm run test` (CUI + dashboard), `npm run eval` (88/88).

**Risks:** the auto-open invariant logic (don't broadcast on initial mount or post-snooze) is the trickiest piece. The cleanest implementation is to gate the broadcast on a `userInitiatedAdvanceRef` flag that's set only inside `onAffordanceConfirm` / `onAffordanceReject` (and cleared after the next head emits). Initial mount and `proposal:modal_closed` (snooze) leave the flag false.

### Phase 2 — Persist preview + suppress in-chat proposal cards

**Scope:** persist `payload.preview` server-side via a shared formatter; stop rendering proposal cards inline in the chat thread. The chat shows agent text + a small "Saved" or "Rejected" receipt for resolved proposals; pending ones live entirely in the affordance.

**Files touched:**
- `agentforge/api/src/conversations/preview_formatters.ts` (new) — `formatPreview(target, payload): string`. One switch over write target. Bundle case derives "Demographics · 3 medications · …" by counting non-rejected sections / items.
- `agentforge/api/src/tools/propose_writes.ts` — every `insertPendingProposal` call (14 sites) populates `payload.preview` from the new helper. The tool-result envelope `preview` field continues to be returned for the chat block (same value).
- `agentforge/cui/src/chat/preview_formatters.ts` (new) and `patient-dashboard/src/proposals/preview_formatters.ts` (new) — TypeScript mirrors of the server module, used by no-server-roundtrip render paths (e.g. dashboard fresh-load reading `pending_proposals` directly via the lifecycle GET, where `payload.preview` is already populated but we want a fallback for legacy rows that predate Phase 2). For now, the mirrors exist as a single shared source of truth; whether they live as a workspace package or duplicated files is a build-tooling call we can defer.
- `agentforge/cui/src/chat/MessageList.tsx` — extend the `block.type === 'proposal'` branch (line 635-672) from "skip for allergy" to "skip for all write_targets, render only resolved-state receipt". The current allergy-specific `if (block.write_target === 'allergy') return <Fragment />` becomes the universal path for `block.resolved === undefined`. Resolved blocks render a small "✓ Saved" or "✗ Rejected" receipt without action buttons.
- `agentforge/cui/src/chat/ProposalBlock.tsx` — keep the resolved-state rendering for the receipt, drop the Confirm/Reject buttons (the affordance owns the action now).

**Acceptance:**
- Vitals dictation: affordance shows in queue. No inline proposal card in chat thread. Confirm fires from the affordance, server-side path unchanged.
- Clinical note dictation: same.
- Confirmed proposals show a small "Saved." receipt at the original spot in the chat thread (so the conversation has a written trail of what happened).
- Reload chart mid-flow (new browser tab, same conversation): affordance still shows correct preview text. Verifies `payload.preview` survived persistence.
- Existing eval categories — `no_write_without_confirm`, `unsupported_write_target_rejected`, etc. — all still pass. The check rules inspect trace context, not UI rendering, so this is safe.

**Risks:** preview formatting parity between server and dashboard mirror. Mitigation: the server is the source of truth at write time; the mirror only runs when `payload.preview` is missing (legacy rows) or when the dashboard re-derives mid-flight. A snapshot test that runs the same fixture through server + mirror and asserts equality catches drift.

### Phase 3 — Modal contract refactor

**Scope:** the AllergyModal becomes the prototype for the modal contract. Save → Confirm. **Cancel button removed.** New Reject button (visible per matrix). X-close = snooze. Click outside = snooze. Click on affordance body = re-opens this modal pre-populated with the proposal.

**Files touched:**
- `patient-dashboard/src/cards/AllergyModal.tsx`:
  - Footer: drop the Cancel button (lines 662-668). Render Reject (when matrix says visible) and Confirm. Reject calls `POST /proposals/:id/reject`. Confirm renames the existing Save handler.
  - X-close button (top-right, line 585-592) becomes "snooze" — keeps existing `handleClose` flow which broadcasts `proposal:modal_closed` and calls `onClose`. Backdrop click does the same.
  - Implement the full disabled-button matrix above. Reject hidden in manual `+` and click-to-edit-no-changes; visible whenever an agent proposal is bound. Forbid manual `+` while a queued agent proposal of the same target type exists (CUI signals via the `proposal:queue_state` BroadcastChannel event — new event, fires when queue head/count changes; AllergiesCard reads it to decide the `+` button's disabled state).
  - Network failure handling: Confirm and Reject buttons each catch error → flip the affordance via `proposal:status` event to `failed` state with retry. The `pending_proposals` row stays `pending` until Postgres acknowledges the lifecycle transition, so retry is safe.
- `agentforge/cui/src/proposals/AboveComposerAffordance.tsx`:
  - Add body-click handler. For write_targets with a modal (allergy now; later: medication, demographics), broadcasts `proposal:open_modal` to re-open the modal. For modal-less targets (vitals, clinical_note, chief_complaint, tobacco), emits a NAV_REQUEST envelope to `parent.window` (same mechanism as `requestEncounterNavigation`) to navigate to the current-day encounter view.
  - `event.stopPropagation()` on Confirm/Reject button clicks so they don't bubble to the body click handler.
- `agentforge/cui/src/proposals/proposalBus.ts` — add `proposal:queue_state` event (`{ head_id: string | null, count: number, head_target: string | null }`). Mirror in dashboard.

**Acceptance:**
- Open an allergy modal via dictation → X-close → affordance still in queue → click affordance body → modal re-opens with same payload state.
- Click outside an open modal → modal closes → affordance still in queue. Same as X-close.
- Manual `+` add → modal opens, no Reject button. Confirm disabled until substance entered. No agent proposal in queue means no re-target risk.
- Click-to-edit existing allergy → modal opens, no Reject button (no agent proposal exists). Confirm disabled until a field changes from initial.
- Manual `+` button disabled (with tooltip) while an allergy proposal is in queue.
- Vitals dictation produces an affordance → click body → CUI navigates to encounter view (same UX as clicking "Today" in the CUI header).
- Network failure on Confirm: affordance flips to `failed` state with retry button; click retry → succeeds. The pending_proposals row was never advanced past pending until success.

**Risks:**
- Voice "reject" doesn't exist yet, so the only reject path is the affordance ✗ button or modal Reject. Document this so demo doesn't try to reject by voice.
- "Modal contract" so far means AllergyModal. When Phase 5 adds MedicationModal / DemographicsModal, they need to follow the same Confirm / Reject / X-snooze pattern. Codify as a `ProposalModalProps` interface to enforce.

### Phase 4 — Bundle proposals (intake form, lab ingestion)

**Scope:** intake forms and lab ingestion produce a single bundle proposal that lands in the queue. When the bundle reaches the head **as a result of user confirm/reject of the previous head** (auto-open invariants apply), a `BundleReviewModal` auto-opens over the dashboard. Modal shows per-section confirm/reject toggles + bundle-level Confirm All / Reject All. Confirm All commits the unrejected sections via server-side fan-out with synthetic per-leaf proposal_ids; "Confirm 7 of 10" updates dynamically.

**Files touched:**
- `agentforge/api/src/tools/attach_and_extract.ts` (and any sibling intake/lab assembler) — change from emitting an `extraction` chat block + bespoke IntakeProposalCard to inserting a `pending_proposals` row with the bundle payload shape (above) and emitting a normal `proposal` chat block with `write_target: 'bundle'` (or `intake_bundle`).
- `agentforge/api/src/conversations/store.ts` — new `setSectionRejected(proposalId, sectionId, itemId | null, rejected): Promise<row | null>`. Resolves the section/item index by scanning `payload.sections` for the supplied stable IDs, then runs `jsonb_set(payload, ARRAY['sections', section_idx, 'items', item_idx, 'rejected'], $rejected)` (or the section-level path when `item_id` is null). Emits `payload_updated` SSE on success.
- `agentforge/api/src/app.ts` — new routes `POST /proposals/:id/items/reject` and `POST /proposals/:id/items/restore`. Body `{ section_id, item_id? }`. Auth: same as `PATCH /proposals/:id` (session token + matching patient_uuid).
- `agentforge/api/src/conversations/apply_pending_write.ts` — add the `payload.kind === 'bundle'` branch:
  - Iterate `payload.sections`, for each non-rejected leaf:
    - Build per-leaf `OpenEmrWriteBody` with the **synthetic** `proposal_id` (`${parentBundleId}::${section_id}` or `${parentBundleId}::${section_id}::${item_id}`), the leaf's `write_target`, the leaf's `payload`, and the leaf's `encounter_id` (when applicable).
    - POST to the per-target write endpoint.
    - Collect `{ section_id, item_id?, ok, reason? }`.
  - On overall completion, mark the bundle row `confirmed` (regardless of partial failures) and broadcast `status_changed` with the per-leaf detail in the SSE event payload.
  - Reject (whole bundle) marks `rejected` without firing any leaf write, exactly like single-proposal reject.
- `patient-dashboard/src/cards/BundleReviewModal.tsx` (new):
  - Opens via `proposal:open_modal` for `write_target === 'bundle'`.
  - Renders per-section / per-item rows with toggle (✓ / ✗); ✗ calls `POST /proposals/:id/items/reject`; ✓ calls `/restore`.
  - Footer: "Confirm <unrejected count> of <total>" (calls `POST /proposals/:id/confirm`) and "Reject all" (calls `POST /proposals/:id/reject`).
  - Subscribes to SSE `payload_updated` so concurrent agent edits to non-rejected sections appear live without losing the user's local rejection state (the rejection is now in the row's payload, fetched on each SSE refresh).
  - Post-confirm, renders per-section outcome badges from the SSE `status_changed` detail payload (replaces `IntakeProposalCard`'s "✓ 4 of 4 applied" affordance).
- `agentforge/cui/src/chat/IntakeProposalCard.tsx` — deleted.
- `agentforge/cui/src/chat/MessageList.tsx` — drop the `extraction` block special-case rendering once the bundle migration is complete (line 894-926).
- `agentforge/cui/src/chat/intake_dispatch.ts` — deleted (server-side fan-out replaces it).

**Acceptance:**
- Drop an intake PDF in the composer. After `attach_and_extract` returns, the affordance shows "Confirm all (10)" with a preview like "Demographics · 3 medications · 2 allergies · 1 family history". The dashboard auto-opens the BundleReviewModal over the page **only if** the user just resolved a previous proposal; otherwise the user sees the affordance and clicks into it.
- Toggle 2 sections to rejected. The affordance + modal Confirm button updates to "Confirm 8 of 10". Reload the page: the rejection state survives (it's in `payload.sections[*].rejected`).
- Mid-toggle, simulate a concurrent agent `update_proposal` editing a *different* section's payload. The user's rejection state stays intact (jsonb_set vs `||` merge — the whole point of the dedicated endpoint).
- Click Confirm All → server fans out 8 writes → audit trail shows 8 confirmed proposal_ids of the form `${bundleId}::${sectionId}[::${itemId}]` in `agentforge_completed_write_proposal`, plus `payload.sections[*].rejected = true` for the 2 rejected → audit reconstruction can distinguish "bundle confirmed; 8 of 10 sections written; 2 rejected" from "bundle rejected wholesale" (which shows zero rows in the ledger and `pending_proposals.status = 'rejected'`).
- Same flow for a lab PDF.
- Click the affordance body for a bundle proposal → re-opens the BundleReviewModal preserving the per-section state.
- Bundle that mixes encounter-bound (chief_complaint) and patient-scoped (allergies, medications) sections — all writes succeed, encounter routing per-leaf is correct.

**Risks:**
- This is the biggest refactor. The existing `intake_dispatch.ts` direct-write path goes away in favor of the bundle confirm; the per-section progress affordance moves from CUI to dashboard. Need to verify all the per-section write handlers still get the right payload shape (the answer should be yes — `apply_pending_write.ts:60-91` already routes per `write_target`, the bundle branch just calls into the same routing N times).
- `BundleReviewModal` needs care to not flicker when SSE `payload_updated` arrives while the user is mid-toggle. Reuse the focus-protection pattern from `AllergyModal` (round 11) — apply incoming patches only to fields not currently focused.
- If `attach_and_extract` is the only producer today, deleting the `extraction` block path is safe; if anything else emits `extraction`, this needs a deprecation step. Verify with a repo-wide grep before deletion.

### Phase 5 — Per-target dashboard modals (deferred)

Builds `MedicationModal`, `DemographicsModal`, `FamilyHistoryModal`. Each follows the `ProposalModalProps` contract from Phase 3.

Until Phase 5 ships, the affordance for those targets confirms directly from the preview line; body-click navigates to the appropriate dashboard card section.

**Out of scope for the iteration this plan covers.**

---

## Test plan

Per phase, the verification steps are listed in the Acceptance section above. Cross-phase smoke checks the new chat session should run after each phase:

1. **Eval suite stays at 88/88.** `cd agentforge/api && npm run eval`. Gate breaches must remain 0. The check rules inspect trace context, not UI; they should be unaffected.
2. **Dashboard tests pass.** `cd patient-dashboard && npx vitest run`. Currently ~12-13 tests directly exercise allergy modal + card; expect those to continue passing through Phase 3 with the Cancel button removal patched in test fixtures.
3. **Manual smoke**: dictate an allergy add; dictate two more in sequence; verify FIFO advance, voice confirm targets head, X-close snoozes, body-click reopens. Modal auto-opens on confirm-driven advance, NOT on snooze-driven advance, NOT on initial mount of a chart with stale pending rows.
4. **Round-trip smoke**: confirm an allergy via affordance → MariaDB lists row appears → dashboard AllergiesCard refreshes via `chart:updated` broadcast.
5. **Bundle round-trip (Phase 4)**: drop intake PDF → BundleReviewModal opens via the auto-open path → reject 2 sections → confirm → ledger has 8 synthetic proposal_ids → dashboard cards refresh per section.
6. **Concurrency smoke (Phase 4)**: with BundleReviewModal open, simulate agent calling `update_proposal` on a non-rejected section's payload → user's rejection state on a *different* section unchanged after `payload_updated` SSE arrives.

---

## Risk register

| Risk | Mitigation |
| --- | --- |
| `ProposalCardShell` CSS assumed chat-scroll parent context. | Verified false — shell is purely presentational, no parent context coupling. Affordance can consume directly. |
| Voice confirm scoped to "latest" silently breaks queue UX, and `findLatestOpenProposalId` doesn't filter resolved (latent bug). | Phase 1 includes the `findProposalQueue` migration with the resolved filter and head-of-queue voice target; Phase 1 acceptance test explicitly covers both. |
| Snoozed proposals accumulate forever (queue grows unbounded). | Phase 1 scopes the CUI's queue lookup to the current conversation's `messages` array — accumulation across conversations is invisible to the UI. Phase 4 adds server-side `WHERE conversation_internal_id = ?` for cross-session reload paths. **TTL job remains a follow-up** (mark stale rather than auto-reject so audit stays physician-driven). Surface "1 of N" counter caps UX impact; if N exceeds 10 in real usage, revisit before bundles ship. |
| Bundle proposals have a different payload shape; PHP write handlers don't know to iterate. | Bundle fan-out lives entirely in `apply_pending_write.ts`. PHP handlers continue to receive single-write payloads with synthetic proposal_ids that the existing ledger handles correctly. |
| Bundle PATCH-style reject racing with agent payload updates. | **Resolved by design** — dedicated `POST /proposals/:id/items/reject` endpoint with `jsonb_set` on the indexed path; the top-level `PATCH /proposals/:id` is no longer used for per-section state. |
| Bundle fan-out reusing one proposal_id collides with PHP ledger. | **Resolved by design** — synthetic per-leaf proposal_ids of the form `${parentBundleId}::${sectionId}[::${itemId}]` keep the ledger's idempotency working per-leaf. |
| Auto-open broadcast misfires on cache replay or post-snooze. | Phase 1 implements the auto-open invariant via `userInitiatedAdvanceRef`; only confirm/reject completions set the flag. Initial mount and `proposal:modal_closed` (snooze) leave the flag false; the next head transition does not auto-open. |
| Phase 2 strips ProposalBlock buttons; legacy tests that simulate clicking those buttons fail. | Phase 2 acceptance includes test updates: tests that previously asserted "Confirm button exists in proposal block" become "Confirm button exists in affordance for matching proposal_id". |
| Cancel button removal surprises users who clicked Cancel as "dismiss". | Cancel collapses into Snooze (X / backdrop), which has the **same** behavior the Cancel button had today (`handleClose` is unchanged). The user-visible change is one fewer button, not a changed gesture. The new Reject button is a distinct, visually obvious primitive. |

---

## Open items / future iterations

- **Voice reject.** Symmetric to voice confirm. Needs `transcriptSegmentIndicatesReject` parser + plumbing to call `postProposalReject`.
- **Per-target dashboard modals (Phase 5).** Medication, demographics, family history. Each follows the `ProposalModalProps` contract from Phase 3.
- **Snooze TTL.** If a proposal sits in `pending` for > N hours, mark stale (not auto-reject). Audit retains physician-driven reject as the only reject signal.
- **Queue persistence across patient switch.** Today, switching patients reloads the chat thread. Pending proposals for patient A persist in `pending_proposals` but the new chart's CUI doesn't see them until the agent calls `get_proposals` (which doesn't exist yet). Decide: load all pending for the patient on chart open, or keep the "queue is per-conversation" model. Conversation-scoped is the Phase 4 default.
- **Audit query for bundle leaves.** If "find all leaves of bundle X" becomes a frequent query, add a `parent_proposal_id` column to `agentforge_completed_write_proposal`. For now the synthetic ID format encodes the parent and a `LIKE '<bundleId>::%'` query suffices.
- **Conflict UX when affordance and modal disagree.** If the agent edits a proposal payload while the modal is open with stale state, an SSE `payload_updated` event fires. The modal already has focus-protection (round 11) but might still show transient inconsistency. Worth a smoke test post-implementation.

---

## Implementation order suggestion for the next chat

1. Phase 1 — affordance redesign + queue + head-only broadcast + `findProposalQueue` (with resolved filter) + voice no-op. ~3-4h. Foundation for everything else.
2. Phase 2 — persist preview + suppress inline proposal cards. ~1.5h. Cleanup + reload-correctness.
3. Phase 3 — modal contract refactor (Allergy first; Cancel button removed). ~2-3h. Establishes the modal contract.
4. Phase 4 — bundle proposals with dedicated reject endpoint, synthetic per-leaf IDs, section-level encounter binding. ~5-7h. Biggest refactor; ship last.
5. Phase 5 — deferred.

If time-constrained, Phases 1-3 deliver the unified affordance UX for single-proposal flows. Phase 4 can ship as a follow-up.

---

## References

- Round-by-round implementation history of the affordance (rounds 11–20) lives in the chat transcript that produced this plan. Key decisions:
   - Round 11 — affordance introduced for allergy.
   - Round 16 — in-chat proposal card suppressed for allergy specifically; agent reaction normalized server-side.
   - Round 19 — agent prompt tightened to call `get_allergies` before proposing add.
   - Round 20 — `proposal:resolved` BroadcastChannel event so dashboard saves dismiss the affordance.
- `Documentation/AgentForge/process/journal/week-2/0510-T0132-allergy-modal-iteration-pivot.md` — journal entry for the session that produced the first version of this plan.
- `Documentation/AgentForge/implementation/v2-roadmap.md` — broader V2 sequencing.
- `interface/modules/custom_modules/oe-module-agentforge/public/write/` — the PHP write surface this plan does not touch.
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/MysqlCompletedWriteProposalLedger.php` — the idempotency ledger that constrains the bundle fan-out design.

---

## Revision notes (2026-05-10, second pass)

This rewrite incorporates a critique that found seven specific issues against the first draft, all verified in code:

1. **Per-section reject via top-level PATCH would race with agent updates.** Replaced with dedicated `POST /proposals/:id/items/reject` using `jsonb_set` on the indexed path. ([store.ts:332-336](agentforge/api/src/conversations/store.ts:332) confirms `||` merge is wholesale-replace at the top-level key.)
2. **Auto-open broadcast was per-proposal, not head-aware.** Phase 1 rewrite tracks `lastBroadcastedHeadIdRef` and gates on user-initiated advances. ([App.tsx:533-560](agentforge/cui/src/App.tsx:533) confirms today's effect iterates every unresolved proposal.)
3. **Bundle fan-out with one shared proposal_id collides with PHP idempotency ledger.** Synthetic per-leaf IDs of form `${parent}::${section}[::${item}]` resolve this. ([MysqlCompletedWriteProposalLedger.php:18-26](interface/modules/custom_modules/oe-module-agentforge/src/Write/MysqlCompletedWriteProposalLedger.php:18) + `AllergyWriteAction.php` confirms `DuplicateProposalExecutionException` on re-use.)
4. **`findActiveProposal` symbol misnomer; LIFO not FIFO; `findLatestOpenProposalId` doesn't filter resolved.** Plan now references the actual symbol (inline `useMemo`'d `activeProposal` at App.tsx:508-521) and Phase 1 deliverables include the resolved filter as a latent-bug fix.
5. **Cancel + X-close in AllergyModal both call `handleClose` today.** Renaming Cancel → Reject would silently flip the gesture. Plan now removes Cancel and introduces explicit Reject. ([AllergyModal.tsx:559-563, 588, 664-667](patient-dashboard/src/cards/AllergyModal.tsx:559) confirms.)
6. **`payload.preview` is on tool-result envelope only, not persisted.** Phase 2 adds shared `formatPreview` helper and persists into `pending_proposals.payload`. (All 14 `insertPendingProposal` callsites in propose_writes.ts confirm preview is not in the persisted payload.)
7. **Bundle encounter binding was at row level, but bundles mix encounter-bound and patient-scoped sections.** Section-level `encounter_id?` codified in the payload shape spec.

Plus the structural reordering the critique recommended: payload shape and concurrency mechanism now lead the document, before the phase plan, so the per-section reject design is visible at first read instead of buried inside Phase 4.
