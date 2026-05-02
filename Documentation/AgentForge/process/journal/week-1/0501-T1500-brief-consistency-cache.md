---
date: 2026-05-01
topic: Brief consistency cache — auto-brief reliable + (user, patient) server cache + UC-C recap cut + Retry button (PR1 + PR2 in repo)
related_plan: ../../../../../.cursor/plans/brief_consistency_cache_7985bb4f.plan.md
related_prior_journal: ./0501-T1430-post-deploy-bugs-p1-p3-closed.md
related_bug_log: ../../../implementation/post-deploy-bug-log.md
related_cross_journal: ./0430-T2314-dictation-agent-parity.md
---

# Brief consistency cache — auto-brief is now the singular path; recap is gone

## Goal

User reported the auto-brief was inconsistent: "sometimes it shows up, sometimes it doesn't" and on patient revisit they wanted a cached brief, not a fresh LLM call. Their two requirements:

1. The brief is created **exactly once per session per patient**.
2. If the physician switches patients and returns, the panel **replays the cached brief** instead of regenerating one.

Then, mid-investigation, they pivoted scope twice: **kill the "Brief me" chat trigger entirely** (auto-fire is the only path), and **drop the UC-C "what did we capture" recap entirely** (was already meant to be implicit in the auto-brief, per [`0430-T2314-dictation-agent-parity.md`](./0430-T2314-dictation-agent-parity.md) line 39). Constraint: the recap drop must not jeopardise the auto-brief delivery on first chart open.

## Context

The prior session ([`0501-T1430-post-deploy-bugs-p1-p3-closed.md`](./0501-T1430-post-deploy-bugs-p1-p3-closed.md)) closed P1–P3 from [`post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md). The P3 fix (`a0cb1662f`) had keyed the brief cache by `(sessionToken, patientUuid, encounterId)` to plug the "blank brief" surface, and added an `isCacheable` guard against caching empty / refusal-only outputs.

That P3 fix solved the *blank* failure mode but did not solve the *consistency* failure mode — the cache key was still bound to the session token, which re-mints on every chart open. So the user's "revisit → cached brief" requirement was structurally impossible: every patient switch was a cache miss by construction.

Diagnosis surfaced four genuinely independent bugs, not one:

1. **Server cache key bound to mutable `sessionToken`** — every patient revisit is a cache miss, the cache effectively never hits in production usage.
2. **`markBriefFired` is called *before* `runPresent` succeeds** — any transient LLM / OpenEMR failure poisons the sessionStorage marker, suppressing all future auto-fires for that patient until session reset.
3. **Brief lives only in React state.** `blankPanelIframe()` unmounts React on patient switch; re-mounting hits the poisoned marker and renders nothing — there is no client-side payload to replay.
4. **200ms `postMessage` race** — `rail_container.html.twig` waited 200ms after iframe `load` before posting `AGENTFORGE_PRESENT_PATIENT`; if the CUI's `useEffect` listener attached after the post, the brief never auto-fired.

## Key decisions

### Decision: split into two PRs (PR1 brief consistency, PR2 recap drop) instead of one bundle

- **Prompt:** *(critic feedback in plan review)* — "Plan bundles two unrelated changes."
- **Recommendation:** Land brief consistency first as one self-contained commit; land recap removal as a second self-contained commit. The two share zero source files except the type union in `chat.ts`. Splitting them keeps the brief fix independently revertable if anything regresses, and keeps the recap delete a clean grep-and-confirm review.
- **Outcome:** Two atomic commits prepared in repo. PR1 = server cache rekey + client state machine + Retry button + host postMessage delete. PR2 = recap endpoint + recap chat trigger + recap block + recap CSS + recap tests, all deleted.

### Decision: cache key is `(user_id, patient_uuid)` — drop `encounter_id` from the key on purpose

- **Prompt:** *"Question encounter_in_key: Selected option(s) keep_user_patient"* (after critic flagged that the prior P3 fix had added `encounter_id` for "what changed since last visit" freshness).
- **Recommendation:** The critic correctly noted that including `encounter_id` keeps the brief encounter-fresh, which matches how clinicians read "interval since last visit." But the user's stated requirement was "physician revisits the same patient → cached brief, not a new LLM call." Adding `encounter_id` to the key means that opening a new encounter on the same patient is a cache miss every time — the opposite of what the user wants.
- **Recommendation cont:** Surface the trade-off explicitly. With `(user_id, patient_uuid)` the brief might be one encounter behind on rapid revisits within the 30-min TTL — but this is bounded (30 min) and recoverable (Refresh chart bypasses with `force_refresh: true`).
- **Outcome:** User chose `keep_user_patient` (option `keep_user_patient` in the question). Cache key + inflight key both rekeyed to `(user_id, patient_uuid)`. The 30-min TTL plus `force_refresh: true` on Refresh chart is the documented escape hatch. Reverses the encounter-key half of `a0cb1662f`; the `isCacheable` half stays intact.

### Decision: introduce a `briefStatus` state machine instead of patching the boolean flags

- **Prompt:** *(critic feedback)* — "Dropping `briefAutoFiredRef` causes a double-prepend bug under React StrictMode."
- **Recommendation:** The plan originally just removed `briefAutoFiredRef` and relied on the new sessionStorage payload cache to dedupe. But StrictMode dev-mode runs effects twice synchronously; the cache write only happens on resolve, leaving a window where two effects both fire `runPresent`. Two paths forward: (a) keep the boolean ref (still ad-hoc, easy to drift), or (b) replace all the booleans with a discriminated union state machine that any caller — effect, retry button, refresh — must walk through. Option (b) makes the dedupe property a structural invariant of the type, not a convention.
- **Outcome:** New `BriefStatus = 'idle' | 'loading' | 'cached' | 'success' | 'failed'` (discriminated union with payload variants) plus a `briefInFlightRef` belt-and-suspenders for the synchronous StrictMode race. Effect gates on `briefStatus.kind === 'idle'`; `runPresent` gates on the ref. `presenting` is now derived (`briefStatus.kind === 'loading'`) instead of a separate state. Two new tests pin the StrictMode no-double-prepend and the cache-replay-on-remount invariants.

### Decision: inline Retry button on the panel instead of keeping `BRIEF_ME_TRIGGER` as a manual fallback

- **Prompt:** *(critic feedback)* — "Failure path strands the user with no in-session recovery; either add a Retry button or keep `BRIEF_ME_TRIGGER` as a manual escape hatch."
- **Recommendation:** Retry button is strictly better for two reasons. (a) It's the same operator action whether the failure was transient (LLM 5xx) or systemic (OpenEMR unreachable) — no need to remember a magic phrase. (b) Keeping `BRIEF_ME_TRIGGER` as a manual fallback contradicts the user's explicit "kill all manual brief triggers" decision and would leave a documentation gap (when does the user know to type "Brief me"?). The button surfaces the recovery path automatically.
- **Outcome:** When `briefStatus.kind === 'failed'` the panel renders an inline `<button>Retry brief</button>` with the failure code. Clicking sets `briefStatus` back to `idle`, the trigger effect re-fires `runPresent`, and the loading hint reappears. New CSS for `.agentforge-cui__brief-failed` and `.agentforge-cui__retry-brief`. New test covers the failure → retry → success transition.

### Decision: drop UC-C recap entirely, keep the `transcripts` / `transcript_segments` tables

- **Prompt:** *"Question recap_decision: Remove the recap trigger entirely and drop it, so long as it doesn't prevent our automated brief from delivering on the first chart opening/patient active."*
- **Recommendation:** Two paths. (a) Drop the recap trigger only (keep the endpoint, type, store, tables) — minimal blast radius, but leaves dead code. (b) Drop the whole feature surface (trigger, endpoint, client, type, CSS, tests) — bigger delete, cleaner repo, but the underlying `transcripts` + `transcript_segments` tables consume STT segments for dictation (G5-01 / G5-02 / G5-03), not just recap. Need to keep those tables or break dictation.
- **Recommendation cont:** Take path (b) but explicitly preserve the schema. Document the decision in `agentforge/api/src/conversations/README.md` so future-me doesn't see "transcripts" tables and assume they're orphan recap infrastructure. The constraint "don't jeopardise the auto-brief" is satisfied because the auto-brief and recap are completely independent code paths — the only shared surface was the `MessageList` block-type union, which is the cleanup target.
- **Outcome:** PR2 deletes: `agentforge/api/src/conversations/recap.ts`, `recap.test.ts`, `http/recap.test.ts`, `cui/src/chat/recap_messages.test.tsx`. Removes: `app.ts` route registration, `client.ts.getConversationRecap`, `chat.ts` `RecapListItem` type + `recap` block kind, `MessageList.tsx` `case 'recap':` branch, `index.css` `.agentforge-msg__recap` rules, `App.tsx` `RECAP_TRIGGER` regex + handler. Keeps: `transcripts` + `transcript_segments` tables, all `conversations/store.ts` helpers (used by orchestrator turn audit), STT writes. README updated.

### Decision: kill the host-side `postMessage` ping plumbing entirely; CUI self-triggers on handshake ready

- **Prompt:** *(falls out of bug #4 in the diagnosis)*.
- **Recommendation:** The `AGENTFORGE_PRESENT_PATIENT` postMessage was always a workaround for the iframe not knowing when the parent had bound a patient. With the new `briefStatus` state machine the CUI already has the canonical signal — `handshake.status === 'ready' && patientUuid !== null` — and triggering on it eliminates the 200ms race entirely. The host-side `postPresentPatientToFrame` / `schedulePresentPatientPing` helpers + the `setInterval` ping + the `setCollapsed` ping all collapse to dead code.
- **Outcome:** `rail_container.html.twig` keeps `blankPanelIframe()`, `ensurePanelLoaded()`, and the pid-poll interval (still drives G3-12 chart sync). Deletes the three `schedulePresentPatientPing` call sites and the `postPresentPatientToFrame` helper. `RailContainerStaticStructureTest.php` flips two assertions from `assertStringContainsString` → `assertStringNotContainsString` for `AGENTFORGE_PRESENT_PATIENT` and `schedulePresentPatientPing` to lock the deletion in.

## Trade-offs and alternatives

- **`(user_id, patient_uuid, encounter_id)` cache key.** Considered and rejected — would meet the critic's "what-changed-since-last-visit" intuition but would defeat the user's explicit "revisit → cached" requirement. Documented escape hatch is the existing `force_refresh: true` on Refresh chart from the prior P3 commit.
- **Server-side stale-check (compare cached `encounter_id` against current token's `encounter_id`).** Considered as a softer middle-ground (cache by `(user, patient)` but bust on encounter mismatch). Rejected: the bust would fire on every new encounter open, which is exactly the case the user wants to keep cached. The user explicitly accepted "one encounter behind for up to 30 min" as the price for instant revisits.
- **Keep `BRIEF_ME_TRIGGER` as a hidden manual escape hatch.** Considered after the critic feedback. Rejected per the user's explicit "remove all references to Brief me" — the Retry button covers the recovery path more cleanly.
- **Drop the `transcripts` schema along with recap.** Rejected. The schema backs G5-01 (transcript writer) and G5-02 (segment append), both of which are STT/dictation infrastructure with active producers. Removing them would break the dictation flow without freeing any maintenance burden — the tables are passive storage.
- **`useReducer` instead of `useState` for `briefStatus`.** Considered for cleaner transition rules. Rejected because there are only five legal transitions and they all happen in two places (the trigger effect and `runPresent`'s body). Reducer ceremony would obscure rather than clarify.
- **Squash both PRs into one commit.** Rejected per the critic's bundle-warning. Two atomic commits matches the "each fix independently revertable" pattern from the prior P1/P2/P3 ship.

## Tools, dependencies, commands

- **Diagnosis tooling:** `Glob` / `Grep` over `agentforge/api/src/agent/*`, `agentforge/cui/src/App.tsx`, `interface/.../templates/rail_container.html.twig`. Read `case_presentation_cache.ts` line 15-18 for the `cacheKey(sha256(sessionToken), patientUuid, encounterId)` definition; read `App.tsx` lines 162-164 for the `markBriefFired` ordering bug; read `rail_container.html.twig` lines 292-312 for the postMessage timing.
- **Local checks (host, no Docker):**
  - `cd agentforge/api && npx vitest run test/agent/case_presentation.test.ts` — 12/12 pass after rekey + new cross-session-token / cross-user / inflight-coalescer cases.
  - `cd agentforge/api && npx vitest run test/security/binding-and-token.test.ts` — pass after `BoundPatientResult` shape extension.
  - `cd agentforge/api && npx vitest run` — full suite green; `recap.test.ts` and `http/recap.test.ts` are gone (file deletions, not failures).
  - `cd agentforge/cui && node_modules/.bin/vitest run --config ./vitest.config.ts --root $(pwd) src/chat/brief_cache.test.ts` — 10/10 pass (had to pin `--config` + `--root` to dodge a `node` vs `jsdom` env auto-detect bug).
  - `cd agentforge/cui && npx vitest run` — full suite green; `recap_messages.test.tsx` is gone.
  - `composer phpunit-isolated tests/Tests/Isolated/Modules/AgentForge/RailContainerStaticStructureTest.php` — pass after reworking the explanatory comment to avoid the literal string `AGENTFORGE_PRESENT_PATIENT` (which would have re-tripped the new `assertStringNotContainsString`).
  - `cd agentforge/cui && npx tsc --noEmit` — clean.
  - `cd agentforge/api && npx tsc --noEmit` — clean across files we touched (pre-existing eval/runner errors unchanged).
- **Test-fixture fix:** `sessionForPatient(...)` in `case_presentation.test.ts` learned an `iatOffsetSec` arg so two calls in quick succession produce *distinct* session tokens (without it, both `mintSessionToken()` calls land on the same `Math.floor(Date.now() / 1000)` and the cross-session-token test was a no-op). Used `-2` and `-1` (past offsets) to keep tokens valid against `verifySessionToken`'s `now < iat` check.
- **Plan file:** [`brief_consistency_cache_7985bb4f.plan.md`](../../../../../.cursor/plans/brief_consistency_cache_7985bb4f.plan.md) (local, not committed).

## Files touched

### PR1 — brief consistency

- **API (server-side cache + binding):**
  - [`agentforge/api/src/agent/case_presentation_cache.ts`](../../../../../agentforge/api/src/agent/case_presentation_cache.ts) — `cacheKey` rekeyed to `(userId, patientUuid)`; LRU via `Map.delete + set` on read; `MAX_ENTRIES = 256`; `correlationId` excluded from the cached payload.
  - [`agentforge/api/src/agent/case_presentation.ts`](../../../../../agentforge/api/src/agent/case_presentation.ts) — `inflightKey` rekeyed to `(userId, patientUuid)`; plumbs `user_id` + `facility_tz` from the new `BoundPatientResult`; removes the duplicate `verifySessionToken` call.
  - [`agentforge/api/src/tools/_binding.ts`](../../../../../agentforge/api/src/tools/_binding.ts) — `BoundPatientResult.ok` now carries `user_id`, `encounter_id`, `facility_tz` so callers don't re-verify the token.
  - [`agentforge/api/test/agent/case_presentation.test.ts`](../../../../../agentforge/api/test/agent/case_presentation.test.ts) — new cases: same user + different session tokens hits cache, same user + different encounters hits cache (the documented trade-off), different users miss, concurrent calls coalesce across session tokens.
  - [`agentforge/api/test/security/binding-and-token.test.ts`](../../../../../agentforge/api/test/security/binding-and-token.test.ts) — assertion shape updated for the extended `BoundPatientResult`.
- **CUI (client state machine + payload cache + Retry button):**
  - [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) — `briefStatus` state machine, `briefInFlightRef`, single consolidated trigger effect on `[handshake.status, patientUuid, briefStatus.kind, runPresent]`, payload-cache replay before network call, inline Retry button.
  - [`agentforge/cui/src/chat/brief_cache.ts`](../../../../../agentforge/cui/src/chat/brief_cache.ts) (new) — sessionStorage payload cache: `agentforge:brief_payload:<patient_uuid>`, 30-min TTL, 8-patient LRU index, swallows `sessionStorage` unavailability.
  - [`agentforge/cui/src/chat/brief_cache.test.ts`](../../../../../agentforge/cui/src/chat/brief_cache.test.ts) (new) — 10 cases: round-trip, no patient bleed, TTL expiry + just-inside, LRU eviction, LRU promotion on rewrite, corrupt JSON, throwing storage, swallowed write errors.
  - [`agentforge/cui/src/chat/brief_dedupe.ts`](../../../../../agentforge/cui/src/chat/brief_dedupe.ts) (deleted) and [`brief_dedupe.test.ts`](../../../../../agentforge/cui/src/chat/brief_dedupe.test.ts) (deleted) — replaced wholesale.
  - [`agentforge/cui/src/App.test.tsx`](../../../../../agentforge/cui/src/App.test.tsx) — added cases: auto-fire on ready, no double-prepend under StrictMode, cache replay without network, Retry on failure recovers, no auto-fire without bound patient.
  - [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css) — new `.agentforge-cui__brief-failed` / `.agentforge-cui__retry-brief` rules.
- **PHP host (postMessage trigger plumbing deleted):**
  - [`interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig`](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) — deleted `postPresentPatientToFrame`, `schedulePresentPatientPing`, the iframe `load` ping handler, and the ping calls in `setCollapsed` + the pid-poll interval. Kept `blankPanelIframe`, `ensurePanelLoaded`, the pid+encounter poll itself.
  - [`tests/Tests/Isolated/Modules/AgentForge/RailContainerStaticStructureTest.php`](../../../../../tests/Tests/Isolated/Modules/AgentForge/RailContainerStaticStructureTest.php) — flipped assertions to `assertStringNotContainsString` for `AGENTFORGE_PRESENT_PATIENT` + `schedulePresentPatientPing`; explanatory comment in the Twig file reworded to not contain the literal string the test guards against.

### PR2 — UC-C recap drop

- **API:**
  - [`agentforge/api/src/app.ts`](../../../../../agentforge/api/src/app.ts) — `GET /conversations/:conversationId/recap` route registration deleted; `buildRecapPayload` import removed; `fetchConversationByExternalId` / `listAssistantTurnBodies` / `listPendingProposalsForConversation` imports removed (helpers themselves stay in `store.ts`, still consumed by orchestrator turn audit).
  - [`agentforge/api/src/conversations/recap.ts`](../../../../../agentforge/api/src/conversations/recap.ts) (deleted).
  - [`agentforge/api/test/conversations/recap.test.ts`](../../../../../agentforge/api/test/conversations/recap.test.ts) (deleted).
  - [`agentforge/api/test/http/recap.test.ts`](../../../../../agentforge/api/test/http/recap.test.ts) (deleted).
  - [`agentforge/api/src/conversations/README.md`](../../../../../agentforge/api/src/conversations/README.md) — explicit note: recap cut, but `transcripts` / `transcript_segments` tables stay for STT/dictation; `store.ts` helpers stay for orchestrator turn audit.
- **CUI:**
  - [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) — `RECAP_TRIGGER` regex + `isRecap` branch deleted from `onSubmit`.
  - [`agentforge/cui/src/api/client.ts`](../../../../../agentforge/cui/src/api/client.ts) — `getConversationRecap` function + `RecapListItem` import deleted.
  - [`agentforge/cui/src/types/chat.ts`](../../../../../agentforge/cui/src/types/chat.ts) — `recap` variant deleted from the `ChatBlock` discriminated union; `RecapListItem` type definition deleted.
  - [`agentforge/cui/src/chat/MessageList.tsx`](../../../../../agentforge/cui/src/chat/MessageList.tsx) — `case 'recap':` block deleted from the `switch (block.type)` statement.
  - [`agentforge/cui/src/chat/recap_messages.test.tsx`](../../../../../agentforge/cui/src/chat/recap_messages.test.tsx) (deleted).
  - [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css) — all `.agentforge-msg__recap*` rules deleted.

### Docs sweep

- [`Documentation/AgentForge/implementation/clinical-copilot-task-list.md`](../../../implementation/clinical-copilot-task-list.md) — Gate 5 status header notes G5-06/G5-07/G5-08 cut on 2026-05-01; G5-06/G5-07/G5-08 rows marked `[-]` with cut rationale + back-reference to this journal; G3-11 row rewritten to reflect the new auto-fire-as-singular-path + `(user_id, patient_uuid)` cache + Retry button architecture; G6-14 storyboard reference to UC-C recap struck through; cut-tier matrix row 1 updated (UC-C recap polish struck, G5-07/G5-08 polish struck); cross-reference appendix Gate 5 row notes UC-C recap cut.
- [`PRD.md`](../../../../../PRD.md) — §0.3 UC-A bullet rewritten to drop "Brief me" wording and document the auto-fire-as-singular-path + Retry-on-failure surface; §5.9 UC-C recap bullet struck through with cut date and rationale (tables stay for proposal/confirmation/refusal audit); §13.2 Loom script Section 2 rewritten (no "Brief me" prompt — auto-fire) and Section 4 retitled to UC-B post-room confirm trail (recap removed).

## Outcomes

- **All four diagnosed bugs structurally addressed.** (1) Server cache rekeyed to `(user_id, patient_uuid)` — same physician + same patient = cache hit forever within 30 min, regardless of session token churn. (2) `markBriefFired` ordering bug eliminated by replacing the boolean marker with a `briefStatus` state machine that only transitions to `'success'` on resolve. (3) Brief payload now persists in `sessionStorage` keyed by `patient_uuid` — iframe re-mount replays without a network call. (4) `postMessage` race deleted at the source — CUI self-triggers on `handshake.status === 'ready' && patientUuid !== null`.
- **Auto-brief is now the singular path.** `BRIEF_ME_TRIGGER` deleted; the only ways to surface a brief are (a) opening a chart (auto-fire), (b) clicking Retry brief on failure, (c) clicking Refresh chart (force-refresh bypass).
- **UC-C recap fully removed.** No endpoint, no client, no chat trigger, no block kind, no CSS, no tests. Underlying `transcripts` + `conversations` schema stays — both have non-recap producers.
- **Tests:** API Vitest passes after rekey (12 cases on `case_presentation.test.ts`, including the cross-session-token / cross-user / inflight-coalescer assertions); CUI Vitest passes including new `brief_cache.test.ts` (10/10), new `App.test.tsx` cases (auto-fire / no-StrictMode-double-prepend / cache replay / Retry recovery / no-auto-fire-without-patient), and the rail-container static structure test now locks the postMessage deletion. PHPStan + phpcs clean against the touched files.
- **PR sequencing:** Two atomic commits ready in the working tree (PR1 brief consistency, PR2 recap drop). Each is independently revertable; if PR2's recap removal surprises anyone in QA, PR1's brief fix doesn't have to be reverted alongside it.

## Next steps

- [ ] **Stage + commit PR1** (server cache rekey + client state machine + Retry button + host postMessage delete). Suggested message: `fix(agentforge): make auto-brief reliable + cache by (user, patient) + Retry button on failure`.
- [ ] **Stage + commit PR2** (recap drop). Suggested message: `feat(agentforge): drop UC-C recap (cut per 2026-05-01 scope decision); keep transcripts schema for STT`.
- [ ] **Push to gitlab/master + deploy to VPS** following the same pattern as the prior session — `git push gitlab <branch>:master`; SSH the VPS reset and rebuild from `gitlab/master`; verify on `https://108-61-145-220.nip.io`.
- [ ] **Prod smoke per requirement:** open chart → brief auto-fires once. Switch to a different chart → switch back → brief replays from sessionStorage (DevTools Network shows zero `POST /present-patient` on the revisit). Force a transient failure (block egress for 5s) → Retry brief button appears with the failure code → click it → brief renders.
- [ ] **Reconcile with [`0430-T2314-dictation-agent-parity.md`](./0430-T2314-dictation-agent-parity.md) line 39.** That entry framed both Brief me and "what did we capture" as redundant with the auto-brief — this session formalises that read into both deletions; nothing further to reconcile in repo, but if a reader hits the older entry first they should land here for the actual outcome.
- [ ] **Out of scope, reminder:** Caddyfile path fix in `docker/agentforge/docker-compose.prod.yml` (still pending from the prior journal's Next steps).

## Links

- Plan file (this session): [`brief_consistency_cache_7985bb4f.plan.md`](../../../../../.cursor/plans/brief_consistency_cache_7985bb4f.plan.md) (local, not committed).
- Bug log: [`Documentation/AgentForge/implementation/post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md).
- Prior session journal: [`./0501-T1430-post-deploy-bugs-p1-p3-closed.md`](./0501-T1430-post-deploy-bugs-p1-p3-closed.md).
- Cross-reference journal (older "kill Brief me / what did we capture" intent): [`./0430-T2314-dictation-agent-parity.md`](./0430-T2314-dictation-agent-parity.md).
- Task list: [`Documentation/AgentForge/implementation/clinical-copilot-task-list.md`](../../../implementation/clinical-copilot-task-list.md).
- PRD: [`PRD.md`](../../../../../PRD.md) §0.3 UC-A, §5.9 UC-C, §13.2 Loom.
