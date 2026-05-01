---
date: 2026-04-30
topic: Mic-enabled-on-load, WS hardening, and AssemblyAI STT for demo cut
related_milestone: process/14-gate4-complete.md
---

# Mic-enabled-on-load + AssemblyAI STT — session journal

## Goal

Turn Gate 5 dictation into something demoable inside an hour: make the mic clickable the instant the chart loads (no chat-first), surface the actual reason any failure occurred, and swap Deepgram (waiting on vendor approval) for AssemblyAI without losing PRD §5.8 retention posture.

## Context

Gate 5 had closed earlier today for engineering (G5-01..G5-07) with G5-08 left for manual smoke. First attempt at the smoke surfaced two distinct problems: (a) the mic button stayed disabled until a chat round-trip created `conversation_id`, and (b) clicking it produced "Dictation authentication failed" with no further signal. The user has a demo-video deadline tonight, so the bar was "ship the path, log everything that fails next time."

## Key decisions

### Decision: diagnose "Dictation authentication failed" as three failures stacked

- **Prompt:** "Also investigate why, when I try to start dictation, it gives me an error text that says 'dictation authentication failed'. What's missing here as well? Is it something on my end or something that is not wired up correctly by you?"
- **Recommendation:** Terminal log showed `relation "agentforge.transcripts" does not exist` — the `003_gate5_transcripts.sql` migration was never applied locally. Worse, the unhandled rejection inside `onMessage` killed the API process, and the CUI's auth waiter only matched `{type:'authed'}`, ignoring `{type:'error'}` frames. So one operational gap was masked by two real code bugs.
- **Outcome:** Plan [`mic-enabled-on-load_d6277ee1.plan.md`](../../../../../.cursor/plans/mic-enabled-on-load_d6277ee1.plan.md) updated with the three-fix scope: user-side migration, WS try/catch shield, CUI typed-error surfacing.

### Decision: mint conversation UUID at handshake-ready, server upserts on first use

- **Prompt:** "Right now, when I open the CUI panel, I'm not able to hit the button to start dictation… it should be able to start dictating immediately upon opening the chart."
- **Recommendation:** Decouple UC-B (chat) from UC-C (dictation). `App.tsx` mints `crypto.randomUUID()` on `handshake.status === 'ready'`; `ws_route.ts` swaps `fetchConversationByExternalId` for `insertConversationRow` (upsert), preserving PRD §5.5 patient binding via the existing `conversation_patient_mismatch` throw inside the store layer.
- **Outcome:** [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) (UUID effect + drop `setConversationExternalId(null)` in present-patient/brief-me paths); [`agentforge/api/src/stt/ws_route.ts`](../../../../../agentforge/api/src/stt/ws_route.ts) refactored into `handleAuth` / `handleStart` / `handleStop` / `handleEndSession` with a top-level shield in `onMessage` and transcript insert moved **before** sending `authed` (no half-authed clients).

### Decision: drop `presenting` from the chat composer too, prepend brief instead of overwriting

- **Prompt:** "It's still not allowing me to click… text input field [during] the automated brief… maybe these two are linked together."
- **Recommendation:** The mic was decoupled, but the textarea and Send button still gated on `presenting`. Drop the gate from both. The brief's `setMessages([msg])` would have wiped any user-typed message that landed during the wait — switch to `setMessages(prev => [msg, ...prev])` so the brief sits at the top of any in-flight chat.
- **Outcome:** Same `App.tsx` — composer disabled state now keyed only on `sending`, `runPresent` prepends.

### Decision: switch dev STT default to `mock`, then implement AssemblyAI when Deepgram timeline slipped

- **Prompt:** "Deepgram has an approval process that's going to take way too long, so I'm using Assembly AI for speech-to-text. I added my API keys into both… secrets files."
- **Recommendation:** First pass: flip `secrets.dev.env` default from the `STT_PROVIDER=deepgram + STT_API_KEY=replace-me` trap to `STT_PROVIDER=mock` so the pipeline works without an external account. When the user pivoted to AssemblyAI, implement their prerecorded flow (POST /v2/upload → POST /v2/transcript → poll GET /v2/transcript/{id} → best-effort DELETE) in the existing `transcribeInMemoryAudio` switch. Keep audio in-memory only (PRD §5.8 / S3) and cap the poll loop at 30s so a stuck job can't hang `onMessage`.
- **Outcome:** [`agentforge/api/src/stt/transcribe.ts`](../../../../../agentforge/api/src/stt/transcribe.ts) implements AssemblyAI; [`agentforge/api/test/stt/transcribe.assemblyai.test.ts`](../../../../../agentforge/api/test/stt/transcribe.assemblyai.test.ts) covers happy poll + error status. Discovered AssemblyAI now requires `speech_models: ['universal-2']` (per upstream 400 message) — captured inline in code.

### Decision: log the upstream provider response verbatim instead of swallowing

- **Prompt:** "I'm still getting a dictation failed error… Dictation failed (stt_provider_error). Try again."
- **Recommendation:** The CUI now surfaces the error code, but the server only emitted the code — no upstream body. Add `console.error(JSON.stringify({phase:'stt_finalize_failed', code, message}))` in `handleStop` and inline the AssemblyAI 4xx response body into the thrown `Error.message` (truncated to 200 chars). Cost: one log line. Benefit: every future dictation failure lands a self-explanatory line in the API log.
- **Outcome:** First time exercised, surfaced the missing `speech_models` parameter in seconds; iterated to fix in the next message round-trip.

## Trade-offs and alternatives

- **Add a CUI toast on every server `error` frame** — rejected; the existing inline banner already shows the code, and a toast layer is gold-plating against the demo deadline.
- **Persist a server-side correlation id back to the CUI for failed dictations** — rejected for now; the API log line is enough for this session, and PRD already specifies `X-Correlation-Id` plumbing for HTTP. Worth a small follow-up to plumb correlation ids through WS frames.
- **Implement Deepgram + AssemblyAI in parallel under a runtime selector** — accepted as already-built (env switch); no need to deprecate Deepgram, just no longer the default.

## Tools, dependencies, commands

- One-time host migration step (script already supported `POSTGRES_URL_MIGRATE` for this exact scenario):

  ```bash
  cd agentforge/api
  POSTGRES_URL_MIGRATE='postgresql://agentforge:agentforge@127.0.0.1:15432/agentforge' npm run db:migrate
  ```

- CUI bundle rebuild (required after every `agentforge/cui/src/**` edit because the OpenEMR module serves the static bundle):

  ```bash
  cd agentforge/cui && npm run build
  # outputs: interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js
  ```

- API dev loop (`tsx watch` hot-reloads source changes; env-file changes still need a process restart).

## Files touched

- **Created:**
  - `agentforge/api/test/stt/ws_route.handle-message.test.ts` — 5 cases covering happy upsert, transcript-insert failure, patient mismatch, bad token, session-token / auth-frame patient disagreement.
  - `agentforge/api/test/stt/transcribe.assemblyai.test.ts` — 2 cases covering upload→submit→poll→delete and `error` status surfacing.

- **Modified:**
  - `agentforge/cui/src/App.tsx` — UUID-on-handshake effect; drop `presenting` from composer; prepend brief.
  - `agentforge/cui/src/recording/MicControl.tsx` — `waitAuthResult` helper resolves on `authed` and rejects with code on `error`; banner surfaces the code; updated disabled-hint copy.
  - `agentforge/cui/src/recording/MicControl.test.tsx` — added 4 cases (enabled-on-load, disabled-when-null, error-code surface, lifecycle toggle).
  - `agentforge/api/src/stt/ws_route.ts` — refactored to handler functions; top-level `onMessage` shield; upsert in `handleAuth`; preserve upstream code in `handleStop`; stderr log on finalize failure.
  - `agentforge/api/src/stt/transcribe.ts` — AssemblyAI provider (upload, submit with `speech_models`, poll, best-effort DELETE); inline upstream 4xx body into thrown error message.
  - `docker/agentforge/secrets.dev.env` — `STT_PROVIDER` default note + comment cleanup.
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js` and `agentforge-cui-index.css` — rebuilt bundle (committed asset).
  - `Documentation/AgentForge/process/journal/week-1/0430-T2145-gate5-stt-uc-c-manual-smoke.md` — refreshed checklist to reflect mic-enabled-on-load + AssemblyAI default.
  - `Documentation/AgentForge/implementation/dev-spend-log.md` — Gate 5 polish row.
  - `.cursor/plans/mic-enabled-on-load_d6277ee1.plan.md` — added "Update — 2026-04-30" diagnosis section + new code-fix todos.

## Outcomes

- Tap **Start dictation** the instant the panel renders — no chat-first, no waiting on the brief, and the textarea / Send button are also usable during brief generation. Brief now prepends so anything typed mid-brief survives.
- Real STT works end-to-end via AssemblyAI; verified locally with the user's spoken `BP 125 over 60` round-trip showing as a `[dictation] …` user line.
- Every WS-side dictation failure now returns a typed error code to the CUI **and** logs an upstream-body-rich line to the API stderr. The CUI banner reads `Dictation init failed (<code>)` or `Dictation failed (<code>)` instead of the generic catch-all.
- API process can no longer be killed by an unhandled async rejection inside `onMessage`. 88/88 API tests pass; 39/39 CUI tests pass.

## Next steps

- [ ] **VPS deploy:** push to `origin/master`, then on the VPS run the playbook from [`0430-T0213-prod-deploy-vps-smoke.md`](./0430-T0213-prod-deploy-vps-smoke.md), including `npm run db:migrate` against the prod Postgres so `003_gate5_transcripts.sql` lands.
- [ ] **G5-08 mark `[x]`** in [`clinical-copilot-task-list.md`](../../../implementation/clinical-copilot-task-list.md) once the VPS dictation smoke is green.
- [ ] **Plumb correlation id over WS** so dictation failures echo a server-side id the user can paste back.
- [x] **Vitals parser pass on AssemblyAI output** — resolved next session ([`0430-T2314-dictation-agent-parity.md`](./0430-T2314-dictation-agent-parity.md)). Root cause was not the parser — `onDictationFinal` wasn't calling `postChat` at all, so the orchestrator never ran. Fix routes dictation through the full `/chat` pipeline, so `BP 125 over 60` now produces a proposal identically to typed input.
- [x] Drop the `[dictation]` prefix or move it to a non-text affordance — done in the same follow-up: prefix removed, `Dictation` badge added via `ChatMessage.source === 'dictation'`.

## Links

- Plan: [`.cursor/plans/mic-enabled-on-load_d6277ee1.plan.md`](../../../../../.cursor/plans/mic-enabled-on-load_d6277ee1.plan.md)
- Earlier same-day journals: [`0430-T2145-gate5-stt-uc-c-manual-smoke.md`](./0430-T2145-gate5-stt-uc-c-manual-smoke.md), [`0430-T2230-gate4-g410-uc-b-smoke.md`](./0430-T2230-gate4-g410-uc-b-smoke.md).
- Gate 4 milestone: [`process/14-gate4-complete.md`](../../14-gate4-complete.md).
