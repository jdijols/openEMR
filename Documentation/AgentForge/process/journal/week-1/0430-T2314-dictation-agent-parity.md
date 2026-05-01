---
date: 2026-04-30
topic: Dictation ↔ typed parity — route dictation through /chat so proposals fire
related_milestone: process/14-gate4-complete.md
---

# Dictation ↔ typed parity — session journal

## Goal

Close the Gate 5 follow-up noted in [`0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md`](./0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md) line 103: dictated "BP 125 over 60" produced no vitals proposal while typing the same string did. User framing: "We need to treat dictation messages the same as typed messages that were sent." Target: end-to-end parity on Gate 4 / Gate 5 write proposals (vitals, allergies, tobacco, chief complaint) regardless of input modality, while preserving PRD §6.5.1 voice-confirm.

## Context

Gate 4 (UC-B) + Gate 5 (STT) engineering closed earlier today. Manual smoke exposed that the CUI's dictation final-transcript handler short-circuited before the orchestrator ran — it only painted a `[dictation] …` bubble and attempted voice-confirm against an already-open proposal. The Agent API never saw the dictated text, so the vitals parser / propose-writes tools never fired, so no proposal card appeared. Typed messages worked because `onSubmit` calls `postChat`.

## Key decisions

### Decision: route dictation through the exact `/chat` pipeline as typed

- **Prompt:** "We need to treat dictation messages the same as typed messages that were sent. Just because it has a dictation label in the front, we should treat it the exact same way…"
- **Recommendation:** Rewire `onDictationFinal` in [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) to call `postChat` with clean text (no prefix), mirroring the typed path — same `conversation_id` handoff, same `sending` lifecycle, same `sendFailure` surfacing. The orchestrator is where vitals parsing and propose-writes live, so nothing else needs to move to achieve parity.
- **Outcome:** [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) L191–L253. Dictation now fires the full orchestrator loop identically to typed input.

### Decision: keep voice-confirm in parallel (not "either/or") when a proposal is open

- **Prompt:** Clarifying question — when a dictation arrives AND an open proposal exists AND the text is a confirm phrase, what should happen? User: **both**.
- **Recommendation:** Fire `tryConfirmProposalFromDictation` **and** `postChat` in parallel. Rationale: if the physician dictates "yes, confirm" while a card is open, accept the card (PRD §6.5.1 / G5-04) AND still let the agent see the turn so a follow-up vitals/allergy line in the same dictation isn't dropped. The voice path is best-effort (try/catch swallow); the `/chat` path drives UI state.
- **Outcome:** Parallel execution in [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) L191–L253 via a deferred `voicePromise`. Existing `voice_confirm_proposal.test.ts` behavior preserved.

### Decision: send clean text to the agent; mark origin as a UI badge, not a text prefix

- **Prompt:** Clarifying question — what should `/chat` actually receive, and how should the user turn render? User: clean text + `Dictation` badge (drop `[dictation]` prefix entirely).
- **Recommendation:** Add `source?: 'typed' | 'dictation'` to [`ChatMessage`](../../../../../agentforge/cui/src/types/chat.ts). The Agent API receives identical input regardless of modality, so parsing is deterministic. Render a blue pill badge above the bubble for dictated turns, set `aria-label="You (dictation)"` for assistive tech. One typed test regression guard + one positive test in [`MessageList.test.tsx`](../../../../../agentforge/cui/src/chat/MessageList.test.tsx): no `[dictation]` string leaks into the rendered bubble.
- **Outcome:** Type extension in [`agentforge/cui/src/types/chat.ts`](../../../../../agentforge/cui/src/types/chat.ts); renderer change in [`agentforge/cui/src/chat/MessageList.tsx`](../../../../../agentforge/cui/src/chat/MessageList.tsx); style in [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css) (`.agentforge-msg__dictation-badge`).

### Decision: do not re-run `BRIEF_ME_TRIGGER` / `RECAP_TRIGGER` inside the dictation path

- **Prompt:** "We can eliminate the 'Brief me or what did we capture?' trigger because that's automatically sent at the beginning of every chart opening."
- **Recommendation:** Dictation goes straight to `/chat` — no trigger dispatch in `onDictationFinal`. Brief auto-fires on handshake-ready via `runPresent()`, so the typed `BRIEF_ME_TRIGGER` short-circuit is dead weight from the dictation surface. Typed path left unchanged in this session to keep scope tight; a future cleanup can drop the trigger entirely from `onSubmit` if desired.
- **Outcome:** `onDictationFinal` is a straight pass-through to `postChat`; no regex match on dictated text.

## Trade-offs and alternatives

- **Pass `source: 'dictation'` on the API wire (new `/chat` field)** — rejected. Would force an API/type change for a purely cosmetic signal; the orchestrator has no reason to branch on modality, and PRD §6.4 treats dictation as a physician-authored turn.
- **Keep `[dictation]` text prefix as a fallback** — rejected per user: badge-only keeps the chat log visually honest without polluting the parsed text.
- **Mark G5-08 `[x]` now** — not taken: G5-08 requires a user-observed VPS end-to-end smoke; this session shipped code but the green-check belongs to the next live run.

## Tools, dependencies, commands

- CUI tests and bundle rebuild (OpenEMR module serves the static bundle, so rebuild is mandatory after any `agentforge/cui/src/**` edit):

  ```bash
  cd agentforge/cui
  npm test            # vitest run — 46/46 passing
  npm run build       # outputs interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.{js,css}
  ```

- Pre-existing typecheck debt noted: `agentforge/cui/src/api/client.ts` has uncommitted modifications (from a prior session) that dropped `ChatBlock` / `ChatResponse` imports while still using them. Out of scope here; vite build + vitest both pass.

## Files touched

- **Modified:**
  - `agentforge/cui/src/types/chat.ts` — `ChatMessage.source?: 'typed' | 'dictation'`.
  - `agentforge/cui/src/App.tsx` — `onDictationFinal` rewired to clean text + `postChat` + parallel voice-confirm; drops `[dictation]` prefix.
  - `agentforge/cui/src/chat/MessageList.tsx` — renders `Dictation` badge when `source === 'dictation'`; updated `aria-label`.
  - `agentforge/cui/src/chat/MessageList.test.tsx` — 2 new tests: badge present for dictation, absent for typed; clean text (no prefix leak).
  - `agentforge/cui/src/index.css` — `.agentforge-msg__dictation-badge` blue pill style.
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js` and `agentforge-cui-index.css` — rebuilt bundle (committed asset).

- **Created:**
  - `Documentation/AgentForge/process/journal/week-1/0430-T2314-dictation-agent-parity.md` (this file).

## Outcomes

- Dictation now takes the same code path as a typed send: same orchestrator run, same proposal tools, same UI state transitions. Speaking "BP 125 over 60" produces the vitals proposal card just like typing it.
- Voice-confirm shortcut from Gate 5 (G5-04 / PRD §6.5.1) preserved — when an open proposal card is visible, a dictated "yes, confirm" accepts the card **and** the agent still sees the turn.
- `[dictation]` text prefix is gone from user bubbles; a small non-text `Dictation` badge replaces it (WCAG label updated). No string-matching code anywhere in the app or server depends on the literal prefix (verified by repo-wide grep — only docs referenced it).
- CUI test suite: **46/46 passing** (was 44/44 before; +2 new badge tests).

## Next steps

- [ ] **G5-08 live smoke on VPS:** redo the checklist in [`0430-T2145-gate5-stt-uc-c-manual-smoke.md`](./0430-T2145-gate5-stt-uc-c-manual-smoke.md) with the new build. Expected: dictated "BP 125 over 60" produces the vitals proposal card; dictated "yes, confirm" accepts it; recap lists it confirmed. Mark `[x]` G5-08 in [`clinical-copilot-task-list.md`](../../../implementation/clinical-copilot-task-list.md) when green.
- [ ] **Pre-existing typecheck debt** in `agentforge/cui/src/api/client.ts` (lost `ChatBlock` / `ChatResponse` imports) — fold into the next CUI touch.
- [ ] **Optional cleanup:** drop `BRIEF_ME_TRIGGER` from `onSubmit` in `App.tsx` since the brief auto-fires on chart open (user's observation this session).

## Links

- Previous journal: [`0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md`](./0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md) — flagged this exact follow-up.
- Gate 5 manual checklist: [`0430-T2145-gate5-stt-uc-c-manual-smoke.md`](./0430-T2145-gate5-stt-uc-c-manual-smoke.md).
- Gate 4 milestone: [`process/14-gate4-complete.md`](../../14-gate4-complete.md).
- Task list: [`clinical-copilot-task-list.md`](../../../implementation/clinical-copilot-task-list.md) (G5-08 row).
