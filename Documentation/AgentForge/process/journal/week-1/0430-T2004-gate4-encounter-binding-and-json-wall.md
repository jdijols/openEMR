---
date: 2026-04-30
topic: Gate 4 chat hardening — Postgres readiness, JSON-wall fix, encounter binding
related_milestone: Documentation/AgentForge/implementation/clinical-copilot-task-list.md (Gate 4)
---

# Gate 4 chat hardening — session journal

## Goal

Get **G4-08 / G4-09 / G4-11** runnable end-to-end against local OpenEMR + Postgres so that **G4-10** (manual UC-B propose → confirm → write → `log_from='agent'` audit row) becomes a clean physician-side test instead of debugging a stack of latent issues. Fix the live errors the user hit while attempting that smoke (chat send error, JSON-wall response, "I have no encounter" refusal).

## Context

- Gate 4 was code-complete but the dev rail had never been driven for chat-mode writes against a real chart.
- **G4-10** was always intended to be the human-in-the-loop step (PRD §1.4 / §14.3); we kept hitting it in dev and failing on infra/prompting plumbing instead of the actual write.
- The conversation also blew its context window once and was summarized; we resumed against a working API typecheck/test baseline (71 tests).

## Key decisions

### Decision: surface chat failures with typed `AgentForgeDeliveryError`

- **Prompt:** "Right now, the user cannot send any messages … Message could not be sent. Try again."
- **Recommendation:** Replace the catch-all red banner with a typed `AgentForgeDeliveryError(kind, correlationId)` from `client.ts`, branched in `App.tsx`. Each `kind` (`misconfigured_llm`, `network_unreachable`, `bad_request`, `backend_error`, `invalid_success_response`) gets a distinct user-visible message and surfaces the server's `correlation_id` for support.
- **Outcome:** [`agentforge/cui/src/api/client.ts`](../../../../agentforge/cui/src/api/client.ts), [`agentforge/cui/src/App.tsx`](../../../../agentforge/cui/src/App.tsx). New unit test asserts 5xx + 501 + network branches. CUI build re-emitted into the OpenEMR module's `public/cui/`.

### Decision: `/health` actually probes Postgres

- **Prompt:** Same chat-failure thread — needed an objective signal that "case presentation works but chat fails" was a Postgres readiness issue.
- **Recommendation:** Have `/health` run `SELECT 1 FROM agentforge.conversations LIMIT 1`; map success to `postgres: "reachable"`, failure to `postgres: "degraded_chat_requires_migrations_or_url"`, and reflect that into the top-level `ok` boolean.
- **Outcome:** [`agentforge/api/src/app.ts`](../../../../agentforge/api/src/app.ts), test in [`agentforge/api/test/http/health-and-correlation.test.ts`](../../../../agentforge/api/test/http/health-and-correlation.test.ts). Confirmed in dev: degraded → reachable after migrate + `dev:host`.

### Decision: add `dev:host` script for host-run API instead of mutating `secrets.dev.env`

- **Prompt:** "now what?" after `/health` showed `degraded_chat_requires_migrations_or_url` even though migrations had run.
- **Recommendation:** Root cause is `secrets.dev.env` ships `POSTGRES_URL=...@postgres:5432/...` which only resolves inside Compose. Don't change the file (containers need it). Add a script that overrides via `dotenv-cli -v POSTGRES_URL=...@127.0.0.1:15432/...` for host runs. Document in the AgentForge docker README's dev section.
- **Outcome:** `npm run dev:host` in [`agentforge/api/package.json`](../../../../agentforge/api/package.json), guidance in [`docker/agentforge/README.md`](../../../../docker/agentforge/README.md).

### Decision: split inline-claim JSON inside parsed text blocks (no more JSON wall)

- **Prompt:** "the agent responds with a wall of JSON text. I thought we hardened against this type of response coming back to the end user."
- **Recommendation:** Pre-existing hardening only handled malformed `{blocks:...}` envelopes. Add `expandEmbeddedClaimsInParsedBlocks` in `parseBlocksFromModelText` to walk every `text` block, extract balanced `{"type":"claim", ...}` objects (string-aware brace matcher), and replace them with real `claim` blocks via the same Zod schema. Tighten the system prompt: "every cite belongs as its own JSON block inside `blocks` — do not interleave with markdown."
- **Outcome:** [`agentforge/api/src/agent/orchestrator.ts`](../../../../agentforge/api/src/agent/orchestrator.ts), [`agentforge/api/src/agent/system_prompt.ts`](../../../../agentforge/api/src/agent/system_prompt.ts). New regression test in [`test/agent/orchestrator.test.ts`](../../../../agentforge/api/test/agent/orchestrator.test.ts). Initial regex used `"claim"\b` which silently never matched (no word boundary between `"` and `,`); fixed.

### Decision: pass bound `active_encounter_id` into the chat prompt

- **Prompt:** "The writing is not working because we don't have the ability to create the encounter."
- **Recommendation:** The session token already carries `encounter_id` (handshake binds `$_SESSION['encounter']` from OpenEMR). The orchestrator was only passing `patient_uuid` to the model, so the LLM had no way to know an encounter was bound and kept asking the user. Verify the session token in `runChatTurn` and prepend `patient_uuid for this turn / active_encounter_id for this turn / server_today` to the prompt; add explicit encounter-binding rules to the system prompt.
- **Outcome:** [`agentforge/api/src/agent/orchestrator.ts`](../../../../agentforge/api/src/agent/orchestrator.ts), [`agentforge/api/src/agent/system_prompt.ts`](../../../../agentforge/api/src/agent/system_prompt.ts).

### Decision: tobacco / allergy schemas are patient-scoped

- **Prompt:** Same encounter thread — discovered while wiring active_encounter_id that `tobaccoSchema` / `allergySchema` still required `encounter_id` even though the PHP module ignores it (per README: "tobacco; patient-level, no encounter_id").
- **Recommendation:** Remove `encounter_id` from both Zod schemas (tobacco / allergy proposals). Keep `chiefSchema` and `vitalsSchema` requiring it. Update the G4-05 schema test accordingly.
- **Outcome:** [`agentforge/api/src/tools/propose_writes.ts`](../../../../agentforge/api/src/tools/propose_writes.ts), [`agentforge/api/test/tools/propose_writes_schema.test.ts`](../../../../agentforge/api/test/tools/propose_writes_schema.test.ts).

### Decision: `Refresh chart` button + clearer "no encounter" guidance

- **Prompt:** "I'm looking at the new encounter form right now … so you should be able to write what I just dictated to you" (followed by the agent still saying `<none>`).
- **Recommendation:** Two real causes: (a) the new-encounter **form** is not a saved encounter — `$_SESSION['encounter']` stays unset until the physician clicks **Save Encounter**; (b) even after save, the rail iframe is sticky and still has the old launch code. Add a `Refresh chart` button in `App.tsx` that does `window.location.reload()` to force `panel.php` to mint a fresh launch code with the now-current encounter. Rewrite the system prompt's no-encounter branch to spell out the exact save-then-refresh sequence and to include the encounter id in proposal previews.
- **Outcome:** [`agentforge/cui/src/App.tsx`](../../../../agentforge/cui/src/App.tsx) + header CSS in [`agentforge/cui/src/index.css`](../../../../agentforge/cui/src/index.css); proposal previews now read `Chief complaint (encounter #N)` / `Vitals (encounter #N) — bp, weight_lb`. CUI bundle rebuilt.

## Trade-offs and alternatives

- **Auto-create encounter inside the agent** — Rejected. Would violate PRD §10.3 / S9 (V1 write enum is fixed: chief_complaint, vitals, tobacco, allergy). Encounter creation stays a clinician action in OpenEMR.
- **Polling parent for encounter changes** — Rejected for now. The "Refresh chart" button is a 1-line, deterministic UX; postMessage-based auto-refresh can come later if needed.
- **Fall back to most-recent encounter when none bound** — Allowed in the system prompt only when get_encounters returns one dated **today** (server_today header). Stale-encounter fallback was rejected because writing today's chief complaint to a 2-month-old encounter is a real safety hazard.

## Tools, dependencies, commands

```bash
# 1. Bring local OpenEMR + Postgres up
cd docker/development-easy
docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml up -d

# 2. Apply Agent Postgres migrations on the host (port 15432 published by override)
cd agentforge/api
POSTGRES_URL_MIGRATE='postgresql://agentforge:agentforge@127.0.0.1:15432/agentforge' npm run db:migrate

# 3. Run the API on the host with a host-resolvable POSTGRES_URL
npm run dev:host

# 4. Sanity health
curl -s http://localhost:3000/health | python3 -m json.tool   # expect ok:true, postgres:"reachable"
```

## Files touched

- **Created:** `Documentation/AgentForge/process/journal/week-1/0430-T2004-gate4-encounter-binding-and-json-wall.md`
- **Modified:**
  - `agentforge/api/src/app.ts` — `/health` Postgres probe; status code cast for openemr_error
  - `agentforge/api/src/agent/orchestrator.ts` — embedded-claim splitter + active_encounter_id / server_today turn header
  - `agentforge/api/src/agent/system_prompt.ts` — encounter-binding rules + JSON-wall guard
  - `agentforge/api/src/tools/propose_writes.ts` — tobacco/allergy patient-scoped; encounter id in previews
  - `agentforge/api/src/conversations/apply_pending_write.ts` — narrowed write-target row before `buildOpenEmrWriteBody`
  - `agentforge/api/src/agent/vitals_parser.ts` — strict-typed maps + capture guards (clearing `tsc` baseline)
  - `agentforge/api/package.json` — `dev:host` script
  - `agentforge/api/test/http/health-and-correlation.test.ts` — assert Postgres readiness in /health
  - `agentforge/api/test/agent/orchestrator.test.ts` — JSON-wall regression + claim block extraction
  - `agentforge/api/test/tools/propose_writes_schema.test.ts` — patient-scoped tobacco/allergy
  - `agentforge/api/test/conversations/apply_pending_write.test.ts` — Vitest mock factory arity
  - `agentforge/cui/src/api/client.ts` — `AgentForgeDeliveryError`; network-unreachable branch
  - `agentforge/cui/src/App.tsx` — typed delivery failure UX, Refresh chart button
  - `agentforge/cui/src/index.css` — header layout + `agentforge-cui__refresh` styles
  - `agentforge/cui/src/api/client.test.ts` — typed delivery error coverage
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js` — built bundle
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css` — built bundle
  - `docker/agentforge/README.md` — `dev:host` guidance + `/health` postgres readiness note
  - `Documentation/AgentForge/implementation/clinical-copilot-task-list.md` — Gate 4 rows G4-04 .. G4-11 marked `[x]` except G4-10 (manual)

## Outcomes

- API + CUI typecheck clean; **71 API tests** + **29 CUI tests** green.
- `/health` is now a useful readiness signal (`postgres: reachable` vs `degraded_chat_requires_migrations_or_url`).
- The chat error banner distinguishes misconfigured LLM, unreachable network, malformed response, and 5xx — and surfaces a correlation id.
- The agent no longer dumps inline `{"type":"claim", …}` JSON into prose; embedded blobs are split into real `claim` blocks.
- The agent reads the bound `active_encounter_id` from the session token and uses it directly for chief-complaint and vitals proposals; tobacco/allergy proposals are correctly patient-scoped.
- New **Refresh chart** button in the rail re-runs the handshake so the agent sees encounters created mid-session.
- All in-repo Gate 4 rows are `[x]`; only **G4-10** (clinician-side journal entry with `log_from='agent'`) remains.

## Next steps

- [ ] **G4-10** — drive the propose → confirm → write → audit loop on a storyboard patient (Raymond Cooper) using the Refresh-chart workflow; capture screenshots and the `log_from='agent'` audit row in a follow-up journal entry.
- [ ] If proposals still don't appear in the rail after Refresh chart + saved encounter, dump `select * from agentforge.pending_proposals order by created_at desc limit 5;` and the API console output for the offending correlation id.
- [ ] After G4-10 is captured, write `process/14-gate4-complete.md` and flip the README trail row.
- [ ] Optional follow-up: postMessage-driven auto-refresh of the rail when OpenEMR's parent page changes encounters (avoids the manual Refresh button).

## Links

- Numbered milestone (when G4-10 lands): `process/14-gate4-complete.md`
- PRD references: §4.7 (write paths), §5.4 (propose tools), §5.7 (orchestrator), §5.9 (conversation/turn store), §6.5 (proposal cards), §10.2 (no write without confirm), §14.3 (UC-B storyboard).
