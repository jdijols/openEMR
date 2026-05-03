---
date: 2026-05-01
topic: Brief regression post-mortem — stale CUI bundle + missing panel.php cache-bust (G6-16 was a lie)
related_prior_journal: ./0501-T1500-brief-consistency-cache.md
related_task_list: ../../../../../TASKS.md
---

# Brief regression post-mortem — stale bundle + the cache-bust that never was

## Goal

User reported: "no brief is delivered. It doesn't even look like it's attempting to create one, so we took a step backwards. … fix this problem right now." This was an immediate regression of the brief-consistency PR1 work that had been written, tested, and "documented as shipped" earlier the same day in [`0501-T1500-brief-consistency-cache.md`](./0501-T1500-brief-consistency-cache.md). All client + server tests were green; the live behaviour was: chart loads, no `POST /present-patient` request fires, panel sits blank.

## Context

PR1 in the prior session refactored the auto-brief into a CUI-side state machine and **deleted** the host-side `postMessage(AGENTFORGE_PRESENT_PATIENT, ...)` plumbing in `rail_container.html.twig`. The trigger now lives entirely inside the CUI bundle (`App.tsx`, on `handshake.status === 'ready' && patientUuid !== null`).

Two unrelated-but-stacked failures landed the panel in "blank rail forever" territory:

1. **Stale build artifact.** The PR1 source edits were never followed by `npm run build`. `interface/modules/.../public/cui/agentforge-cui.js` was last regenerated **2026-04-30 23:09** — *before* PR1's source edits.
2. **Missing cache-bust in `panel.php`.** Even after rebuilding, the iframe would still serve the old JS to operators with warmed tabs because `panel.php` emits `<script src=".../agentforge-cui.js">` with no version query string. `TASKS.md` row G6-16 claimed `panel.php appends md5_file() hash query strings` — but the file has never had that code, and no test pinned the assertion. PR1 looked correct in source, looked correct in tests, and failed silently at runtime.

User-side smoking gun that caught it: DevTools → Application → Session storage showed three `agentforge:brief_auto_fired:<uuid>` entries with value `1`. That key name is from `brief_dedupe.ts`, which PR1 **deleted**. If the new bundle were running, the keys would be `agentforge:brief_payload:<uuid>` with a JSON value (`{blocks, citation_navigation, storedAt}`). The key shape was a fingerprint that the old bundle was still alive in the iframe.

## Key decisions

### Decision: triage path — start with the build artifact, not the React state machine

- **Prompt:** *"Right now, no brief is delivered. It doesn't even look like it's attempting to create one. … Please fix this problem right now."*
- **Recommendation:** Resist the urge to re-read the trigger `useEffect` and the `briefStatus` machine. The user's own diagnostic ("doesn't look like it's attempting") said the network request never leaves the iframe. Three plausible failure modes: (a) stale bundle on disk, (b) JS error before the trigger effect mounts, (c) something in `useHandshake` short-circuiting. Cheapest signal first: `ls -la` on the served bundle and grep for new strings. The bundle's mtime was a full session before the source edits — that single fact eliminates (b) and (c) without ever opening DevTools.
- **Outcome:** Confirmed `agentforge-cui.js` mtime was 2026-04-30 23:09; verified `Retry brief` and `brief_payload` (new strings introduced by PR1) were absent from the bundle. Ran `npm run build` from `agentforge/cui/`, regenerated bundle (mtime 2026-05-01 15:41), confirmed both strings now present. CUI vitest suite re-run: 61/61 green.

### Decision: panel.php cache-bust is a separate, real bug — fix it now, do not just rebuild and hope

- **Prompt:** *(falls out of the user's session-storage screenshot showing `agentforge:brief_auto_fired:<uuid>` keys after the rebuild — proof the *browser* was still running the old bundle even though the disk had the new one)*.
- **Recommendation:** A rebuild alone helps only operators who never opened a chart before. Anyone with a warmed tab — including the user — has the old `agentforge-cui.js` cached by URL with no version signal that anything changed. The fix has to be URL-level, not file-level. Adding `?v=<md5>` is the standard play and is what G6-16's "Done proof" already claimed. The deeper question — why did G6-16 close on a false claim — is "no test pinned the cache-bust shape." Add the test now or this rots again.
- **Outcome:** Patched [`panel.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php) to call `@md5_file()` on both `agentforge-cui.js` and `agentforge-cui-index.css`, append `?v=<hash>` to the URLs, and fall back to a literal `'missing'` string when the bundle hasn't been built yet (e.g. fresh dev clone). Browser will see a different URL on every redeploy and refetch.

### Decision: pin the cache-bust shape with a static structure test, not a build-output test

- **Prompt:** *(implicit — the lesson from this regression is "if a guarantee isn't pinned, it doesn't exist")*.
- **Recommendation:** Two test shapes were viable: (a) static-string assertions on `panel.php` source, or (b) HTTP-level test that hits the panel endpoint and parses the script tag. (b) catches more regressions but requires a Docker-bootstrapped test harness, which adds CI weight and does not run under `composer phpunit-isolated` (the host-side fast loop). (a) catches every realistic regression: someone deleting the `md5_file()` call, the `?v=` substring, or the `is_string()` fallback. (a) costs zero CI weight and runs in 50ms.
- **Outcome:** New [`PanelCacheBustStaticStructureTest.php`](../../../../../tests/Tests/Isolated/Modules/AgentForge/PanelCacheBustStaticStructureTest.php) with 5 cases: JS hash present, CSS hash present, JS URL appends `?v=$jsVersion`, CSS URL appends `?v=$cssVersion`, missing-bundle fallback present. `composer phpunit-isolated -- --filter PanelCacheBustStaticStructureTest` → 5/5 passing.

### Decision: walk the user through clearing stale `brief_auto_fired` keys instead of writing a migration

- **Prompt:** *(implicit — the user's session storage screenshot showed three stale boolean markers per patient)*.
- **Recommendation:** PR1 deleted `brief_dedupe.ts` so the new code never touches `agentforge:brief_auto_fired:*` keys. They sit inertly in sessionStorage, harmless functionally — the new `App.tsx` doesn't read them and they're scoped to the tab. Writing a one-shot migration in the new bundle adds permanent code for a one-time cleanup that the user can do in 10 seconds with `Object.keys(sessionStorage).filter(k => k.startsWith('agentforge:')).forEach(k => sessionStorage.removeItem(k))`. The disk fix (cache-bust) is the durable change; the in-tab cleanup is operator-side.
- **Outcome:** Documented the three-step user-side recovery (DevTools → clear `agentforge:` keys → hard reload) in the chat reply. No code added for stale-key cleanup.

## Trade-offs and alternatives

- **Re-read the React state machine first.** Considered, rejected. The user explicitly described "no attempt at all" — that's network-level, not state-level. Filesystem evidence (bundle mtime) is faster than DOM/state-level evidence and cheaper to refute.
- **Skip the cache-bust and trust the user's hard-refresh.** Considered, rejected. Hard refresh recovers the user's tab once; without the URL versioning every future deploy will silently fail to reach warmed tabs. This is the same class of bug we just hit.
- **HTTP-level integration test for cache-bust.** Considered, rejected for now (see Decision 3). The static structure test catches every realistic regression at 1/100th the cost. If we ever ship a panel template generator that bypasses the source string, we can add an HTTP test then.
- **Add a code migration that auto-clears `brief_auto_fired:*` on App mount.** Rejected (see Decision 4). Stale keys are inert; permanent migration code is debt.
- **Mark G6-16 as failed in the task list and re-open it.** Deferred — the cache-bust fix lands the actual G6-16 acceptance criterion, so the row's status is now defensible. Worth a quick edit to add the test reference and the journal back-link, but not blocker for this session.

## Tools, dependencies, commands

- `cd agentforge/cui && ./node_modules/.bin/tsc --noEmit` — typecheck clean.
- `cd agentforge/cui && npm run build` — regenerated `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js` + `agentforge-cui-index.css`. Build deletes the stale `index.html` from the public dir as part of the script.
- `cd agentforge/cui && ./node_modules/.bin/vitest run` — 61/61 passing (App, brief_cache, useHandshake, MessageList, citation_nav_messages, MicControl, voice_confirm_*, api/client).
- `composer phpunit-isolated -- --filter PanelCacheBustStaticStructureTest` — 5/5 passing.
- `TZ=America/Chicago date +"%m%d-T%H%M"` / `TZ=America/Chicago date +"%Y-%m-%d"` — for this journal's filename and YAML `date`.
- **No package installs** in this session.

User-side recovery commands (for the chat reply, not for CI):

- `Object.keys(sessionStorage).filter(k => k.startsWith('agentforge:')).forEach(k => sessionStorage.removeItem(k))` (run in iframe console).
- ⌘⇧R / Ctrl⇧R hard reload.

## Files touched

- **Modified:** [`interface/modules/custom_modules/oe-module-agentforge/public/panel.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php) — added `md5_file()` of JS + CSS bundles; appended `?v=<hash>` to script/style URLs; fall back to `'missing'` literal when the bundle file is absent.
- **Modified:** [`interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js) — regenerated by `vite build` (now contains the PR1 state machine, `Retry brief`, `brief_payload` cache).
- **Modified:** [`interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css) — regenerated by `vite build`.
- **Created:** [`tests/Tests/Isolated/Modules/AgentForge/PanelCacheBustStaticStructureTest.php`](../../../../../tests/Tests/Isolated/Modules/AgentForge/PanelCacheBustStaticStructureTest.php) — 5 assertions pinning the cache-bust shape.
- **Created:** this journal entry.

## Outcomes

- **Auto-brief fires reliably on every chart open.** User confirmed in their wrap-up message: *"the patient presentation automated brief loads on each patient and is now more consistent."*
- **G6-16 ("CUI build pipeline cache-busting") is now actually true.** The task row's "Done proof" matches the code on disk for the first time, and a green isolated test guarantees a future regression fails CI instead of silently in production.
- **PR1 (brief consistency state machine + payload cache + Retry button) reaches the browser end-to-end.** Session storage now uses the new `agentforge:brief_payload:<patient_uuid>` key shape with a JSON payload value; the deprecated `agentforge:brief_auto_fired:*` boolean keys are no longer written by any code path.
- **Test floor is one assertion higher than before.** Future static-asset URL changes in `panel.php` get caught by the new test; "Done proof" claims for asset-pipeline tasks now have a structural enforcement primitive.

## Next steps

- [ ] **Stage + commit the brief-consistency PR1 source + the rebuilt bundle + the cache-bust patch + the new isolated test.** Single atomic commit is the cleanest revert path. Suggested message: `fix(agentforge): make auto-brief reliable + bust CUI bundle cache via panel.php hash`.
- [ ] **Stage + commit PR2** (UC-C recap drop) as a separate commit — see [`0501-T1500-brief-consistency-cache.md`](./0501-T1500-brief-consistency-cache.md) "Next steps" for the full file list.
- [ ] **Push gitlab/master + redeploy VPS** — once committed, the prod path is the same `git push gitlab HEAD:master` + VPS pull + Compose rebuild flow used by the prior post-deploy bug fixes. The cache-bust mechanism means warmed prod tabs will pick up the new bundle on the next chart open with no operator intervention.
- [ ] **Annotate G6-16 in the task list** with a one-line note: "Cache-bust pinned by `PanelCacheBustStaticStructureTest` (added 2026-05-01 after live regression — see journal `0501-T1557`). Prior implementation claim was incorrect; current implementation is verified."
- [ ] **Server-side cache rekey to `(user_id, patient_uuid)`** is still pending despite being claimed completed in the prior session's plan summary. Today's auto-brief fires reliably (PR1 client fix is in), but each patient revisit still pays a fresh LLM call because the server cache is keyed by mutable `sessionToken`. Client `sessionStorage` payload cache hides this from the user UI but the API cost is wrong. Sequence as a separate small PR after PR1/PR2 land.

## Links

- Prior session journal (PR1 + PR2 source work): [`./0501-T1500-brief-consistency-cache.md`](./0501-T1500-brief-consistency-cache.md).
- Earlier prior session (post-deploy P1–P3): [`./0501-T1430-post-deploy-bugs-p1-p3-closed.md`](./0501-T1430-post-deploy-bugs-p1-p3-closed.md).
- Task list (G6-16, G3-11): [`TASKS.md`](../../../../../TASKS.md).
- Patched panel: [`interface/modules/custom_modules/oe-module-agentforge/public/panel.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php).
- New cache-bust test: [`tests/Tests/Isolated/Modules/AgentForge/PanelCacheBustStaticStructureTest.php`](../../../../../tests/Tests/Isolated/Modules/AgentForge/PanelCacheBustStaticStructureTest.php).
