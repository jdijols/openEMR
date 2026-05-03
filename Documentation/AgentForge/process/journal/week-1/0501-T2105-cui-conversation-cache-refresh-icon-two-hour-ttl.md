---
date: 2026-05-01
topic: CUI — full-thread sessionStorage cache (proposal resolution survives reload), sync-style refresh icon, 2-hour brief/conversation/server TTL
related_prior_journal: ./0501-T1500-brief-consistency-cache.md
related_cross_journal: ./0430-T2004-gate4-encounter-binding-and-json-wall.md
related_task_list: ../../../../../TASKS.md
---

# CUI conversation persistence + refresh control polish + aligned 2-hour cache TTL

## Goal

Close three product gaps raised and implemented in the same thread:

1. **Hard reload wiped the dialog.** `refreshChartBinding()` ends in `window.location.reload()`. React `messages` state was never persisted; only the auto-brief had a per-tab `sessionStorage` replay path via [`brief_cache.ts`](../../../../../agentforge/cui/src/chat/brief_cache.ts). Operators lost multi-turn chat and assistant follow-ups on every refresh.

2. **Proposal cards would have looked "pending" after reload if we had only cached `messages`.** [`ProposalBlock`](../../../../../agentforge/cui/src/chat/MessageList.tsx) stored terminal UI (`accepted`, `declined`, `openemr_denied`, `delivery_failed`) in component-local `useState`, not on the wire-shaped `ChatBlock`. Replaying cached messages alone would have re-rendered Confirm/Reject on already-finalized proposals.

3. **Polish + TTL.** Replace the verbose **"Refresh chart"** label with an icon visually aligned with OpenEMR main-tab chrome (`fa-sync` in [`tabs_template.html.twig`](../../../../../templates/interface/main/tabs/tabs_template.html.twig)); omit browser **`title`** hover text (parent UI does not tool-tip those icons); extend LRU/TTL from **30 minutes to 2 hours** on the **server** case-presentation cache and both **client** payload caches so long encounters do not expire mid-visit.

## Context

**Why the refresh control still exists.** Launch codes in [`panel.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php) embed `$_SESSION['encounter']` at mint time. If the physician saves a new encounter while the rail stays open, the iframe can retain a stale JWT until `panel.php` runs again. That is the historic reason for the escape hatch ([`0430-T2004`](./0430-T2004-gate4-encounter-binding-and-json-wall.md)). **Conversation cache removes chat-loss when using the hatch; it does not refresh encounter claims inside the token.**

**Brief vs conversation cache keys.** The server-side brief LRU ([`case_presentation_cache.ts`](../../../../../agentforge/api/src/agent/case_presentation_cache.ts)) keys by hashed session token + patient + encounter (P3 — encounter-scoped collisions). The **client** conversation cache deliberately keys **`patient_uuid` only** (mirroring the philosophy behind client `brief_cache` + the user's explicit "no encounter_id required for persistence" requirement). On remount, a **non-empty** conversation cache wins over brief-only replay because the full thread already contains the brief as an assistant message.

## Key decisions

### Decision: add `conversation_cache.ts` — mirror `brief_cache.ts` shape (TTL, LRU, fail-silent)

- **Prompt:** *Persist the full thread in sessionStorage keyed like the brief cache; same patient without encounter in the key; 2-hour TTL after we bump from 30 minutes.*
- **Recommendation:** New module with `readCachedConversation` / `writeCachedConversation`, `agentforge:conversation_payload:<patient_uuid>`, separate LRU index key, `storedAt` on write, corrupt JSON and throwing `sessionStorage` swallowed. Unit tests mirror [`brief_cache.test.ts`](../../../../../agentforge/cui/src/chat/brief_cache.test.ts) plus one case that round-trips a proposal `resolved` field.
- **Outcome:** [`conversation_cache.ts`](../../../../../agentforge/cui/src/chat/conversation_cache.ts), [`conversation_cache.test.ts`](../../../../../agentforge/cui/src/chat/conversation_cache.test.ts).

### Decision: conversation replay **before** brief-only replay in `App.tsx`

- **Prompt:** *(falls out of having two caches — which wins on mount?)*
- **Recommendation:** In the single `useEffect` gated on `briefStatus.kind === 'idle'`, call `readCachedConversation` first. If `messages.length > 0`, `setMessages([...])` and `setBriefStatus({ kind: 'cached' })` — no `/present-patient`. Otherwise fall through to existing `readCachedBrief` + `runPresent` path.
- **Outcome:** [`App.tsx`](../../../../../agentforge/cui/src/App.tsx) — avoids double-prepend and preserves proposal resolution that only lives in the conversation blob.

### Decision: lift proposal terminal state onto `ChatBlock.resolved` + `onProposalResolved` callback

- **Prompt:** *Confirmed/denied cards must cache the same way as prose; avoid server polling or "from previous session" UX hacks.*
- **Recommendation:** Introduce [`ProposalResolution`](../../../../../agentforge/cui/src/types/chat.ts) (terminal phases only). `ProposalBlock` initializes `useState` from `phaseFromResolution(block.resolved)`; on terminal transition, call `resolutionFromPhase` and `onResolve?.(proposalId, resolution)`. `App` walks `messages` and patches the matching block; the existing `[messages, patientUuid]` effect persists to `conversation_cache`. Voice-confirm path: on `tryConfirmProposalFromDictation` success, also call `onProposalResolved(..., { phase: 'accepted' })` so dictation matches button confirm after reload.
- **Outcome:** [`types/chat.ts`](../../../../../agentforge/cui/src/types/chat.ts), [`MessageList.tsx`](../../../../../agentforge/cui/src/chat/MessageList.tsx), [`App.tsx`](../../../../../agentforge/cui/src/App.tsx). Server [`confirmPendingProposal`](../../../../../agentforge/api/src/conversations/apply_pending_write.ts) already returns `not_pending` on double confirm — UI now avoids the misleading path.

### Decision: refresh header control = inline SVG (sync arrows), no `title`, keep `aria-label`

- **Prompt:** *Match OpenEMR tab refresh visually; no hover tooltips.*
- **Recommendation:** `panel.php` does not load Font Awesome for the iframe; add `IconPanelSync` — stroke `path` aligned with Heroicons / `fa-sync` metaphor (circular arrows), `currentColor`, 14×14. Remove `title`. Keep distinct `aria-label` strings for ready vs not-ready branches for screen readers and Vitest `getByRole`.
- **Outcome:** [`App.tsx`](../../../../../agentforge/cui/src/App.tsx), [`index.css`](../../../../../agentforge/cui/src/index.css) — `.agentforge-cui__refresh` becomes an icon button (`inline-flex`, min 2.25rem square for tap target).

### Decision: TTL constant `2 * 60 * 60 * 1000` on server + both client caches

- **Prompt:** *30 minutes is short for a single appointment.*
- **Recommendation:** Bump [`case_presentation_cache.ts`](../../../../../agentforge/api/src/agent/case_presentation_cache.ts) `TTL_MS`; bump [`brief_cache.ts`](../../../../../agentforge/cui/src/chat/brief_cache.ts) and [`conversation_cache.ts`](../../../../../agentforge/cui/src/chat/conversation_cache.ts) to match. Update Vitest fake-timer tests (+1 ms past TTL, −1 ms inside TTL). **Do not** change [`redeem.ts`](../../../../../agentforge/api/src/handshake/redeem.ts) `30 * 60` — that is JWT/session lifetime, unrelated to brief LRU.
- **Outcome:** Comments in [`case_presentation.ts`](../../../../../agentforge/api/src/agent/case_presentation.ts) and [`case_presentation.test.ts`](../../../../../agentforge/api/test/agent/case_presentation.test.ts) updated for wording consistency.

### Decision: document TTL semantics for operators / future readers (FAQ in chat)

- **Prompt:** *Do the two hours reset when messages are sent/received?*
- **Recommendation:** **Conversation cache:** every `messages` change runs `writeCachedConversation` with `storedAt: Date.now()` — **sliding** two hours from the **last persisted mutation** (send, receive, brief prepend, proposal resolve), not a separate idle detector. **Brief-only cache:** `writeCachedBrief` runs on successful `runPresent`, not every `/chat` turn. **Server brief cache:** TTL from server `storedAt` when an entry is stored; not advanced by chat traffic.
- **Outcome:** Captured here only; no extra user-facing docs requested.

## Trade-offs and alternatives

- **Conversation key `(patient_uuid, encounter_id)`.** Rejected — user explicitly aligned with brief-cache-style patient scoping and "revisit same patient → thread still here" without requiring a new encounter row.

- **Load Font Awesome in `panel.php` for pixel-perfect `fa-sync`.** Rejected — couples iframe to parent asset version and adds weight; inline SVG matches existing sandboxed-rail pattern ([`MessageList.tsx`](../../../../../agentforge/cui/src/chat/MessageList.tsx) already documents why icons are inlined).

- **Remove refresh control now that chat persists.** Rejected in discussion — **encounter binding** escape hatch remains valid until postMessage or host-driven re-mint exists ([`0430-T2004` next steps](./0430-T2004-gate4-encounter-binding-and-json-wall.md)).

- **Retain `title` for discoverability.** Rejected per user — OpenEMR tab icons do not use hover titles; parity over extra chrome.

## Tools, dependencies, commands

- `cd agentforge/cui && npm run typecheck` — clean after edits.
- `cd agentforge/cui && npm run test` — Vitest: `conversation_cache`, `brief_cache`, `App` (refresh control + conversation replay + proposal stamp), etc.
- `cd agentforge/api && npx vitest run test/agent/case_presentation.test.ts` — green after TTL/comment updates.
- `cd agentforge/cui && npm run build` — regenerates [`agentforge-cui.js`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js) + [`agentforge-cui-index.css`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css); `panel.php` `md5_file()` cache-bust picks up new hashes on next chart open.
- **No new package installs** for this scope.

## Files touched

### New

- [`agentforge/cui/src/chat/conversation_cache.ts`](../../../../../agentforge/cui/src/chat/conversation_cache.ts) — per-tab `ChatMessage[]` cache; 2h TTL, 8-patient LRU, `patient_uuid` key.
- [`agentforge/cui/src/chat/conversation_cache.test.ts`](../../../../../agentforge/cui/src/chat/conversation_cache.test.ts) — parity with `brief_cache.test.ts` cases + proposal `resolved` round-trip.
- **This journal:** [`0501-T2105-cui-conversation-cache-refresh-icon-two-hour-ttl.md`](./0501-T2105-cui-conversation-cache-refresh-icon-two-hour-ttl.md).

### Modified (source)

- [`agentforge/cui/src/types/chat.ts`](../../../../../agentforge/cui/src/types/chat.ts) — `ProposalResolution`; proposal block `resolved?`.
- [`agentforge/cui/src/chat/MessageList.tsx`](../../../../../agentforge/cui/src/chat/MessageList.tsx) — `phaseFromResolution` / `resolutionFromPhase`; `ProposalBlock` persistence callback; `onProposalResolved` prop.
- [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) — conversation read/write effects; `onProposalResolved`; voice-confirm stamp; `IconPanelSync`; refresh button markup + `aria-label`s; comments (2h cache).
- [`agentforge/cui/src/App.test.tsx`](../../../../../agentforge/cui/src/App.test.tsx) — conversation replay tests; refresh tests wait on `/refresh clinical copilot/i`.
- [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css) — icon-only refresh button + `.agentforge-cui__refresh-icon`.
- [`agentforge/cui/src/chat/brief_cache.ts`](../../../../../agentforge/cui/src/chat/brief_cache.ts) — 2h TTL; docblock bounds.
- [`agentforge/cui/src/chat/brief_cache.test.ts`](../../../../../agentforge/cui/src/chat/brief_cache.test.ts) — 2h timer edges; removed unused `beforeEach` import.
- [`agentforge/api/src/agent/case_presentation_cache.ts`](../../../../../agentforge/api/src/agent/case_presentation_cache.ts) — 2h TTL; docblock.
- [`agentforge/api/src/agent/case_presentation.ts`](../../../../../agentforge/api/src/agent/case_presentation.ts) — P3 comment wording (2h).
- [`agentforge/api/test/agent/case_presentation.test.ts`](../../../../../agentforge/api/test/agent/case_presentation.test.ts) — P3 empty-cache comment (2h).

### Regenerated (build output)

- [`interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js)
- [`interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css)

## Outcomes

- **Refresh / remount / pid-poll re-entry** replays the **full** `messages` array for the bound patient from `sessionStorage`, including assistant turns, user dictation/typed lines, and **resolved** proposal cards (`resolved` field round-trips).
- **Panel header** shows a **sync-style** circular-arrows icon (no hover `title`); **accessible name** via `aria-label` only.
- **Server brief LRU + client brief payload cache + client conversation cache** share a **2-hour** TTL constant; **conversation** cache **slides** with every persisted message mutation.
- **Tests:** CUI Vitest suite green including new `conversation_cache` cases and App integration cases; API `case_presentation` tests green.

## Next steps

- [ ] **Optional — docs sweep:** [`PRD.md`](../../../../../PRD.md) and [`TASKS.md`](../../../../../TASKS.md) still mention **30-min** windows in places; align copy to **2h** where it describes this cache, or add a footnote that JWT lifetime in `redeem.ts` remains separate.
- [ ] **Optional — binding automation:** postMessage (or host hook) on encounter change to re-mint launch code without operator hitting refresh ([`0430-T2004`](./0430-T2004-gate4-encounter-binding-and-json-wall.md) deferred work).
- [ ] **Commit:** suggested message: `feat(agentforge): persist CUI conversation in sessionStorage; proposal resolved state; 2h case-presentation TTL; sync refresh icon`.

## Links

- Prior brief consistency + client payload cache: [`0501-T1500-brief-consistency-cache.md`](./0501-T1500-brief-consistency-cache.md).
- Original "Refresh chart" + encounter binding decision: [`0430-T2004-gate4-encounter-binding-and-json-wall.md`](./0430-T2004-gate4-encounter-binding-and-json-wall.md).
- CUI panel polish (header / textarea): [`0501-T1838-cui-panel-polish-header-empty-textarea-buttons.md`](./0501-T1838-cui-panel-polish-header-empty-textarea-buttons.md).
- OpenEMR tab refresh markup reference: [`templates/interface/main/tabs/tabs_template.html.twig`](../../../../../templates/interface/main/tabs/tabs_template.html.twig) (`fa-sync`).
