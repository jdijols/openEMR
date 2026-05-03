---
title: AgentForge — Post-deploy bug log (prod VPS)
source: Manual smoke after 0501-T0014 deploy of `d2b8f3621` (Gates 3–5 + STT)
created: 2026-05-01
status: fixes-shipped 2026-05-01 + redeployed to prod 2026-05-02 (commit `fb9613edb`) — full P1/P2/P3 re-smoke deferred to morning
related_journal: ../process/journal/week-1/0501-T0014-prod-deploy-gates3-5-vps.md
closure_journal: ../process/journal/week-1/0501-T1430-post-deploy-bugs-p1-p3-closed.md
followup_deploy_journal: ../process/journal/week-1/0502-T0208-langfuse-observability-prod-deploy.md
---

# Post-deploy bug log — prod VPS (`108-61-145-220.nip.io`)

Surface bugs found during the manual smoke that immediately followed the prod deploy of `d2b8f3621` (close of Gates 3 → 5, including AssemblyAI STT). The deploy itself was clean (see [`process/journal/week-1/0501-T0014-prod-deploy-gates3-5-vps.md`](../process/journal/week-1/0501-T0014-prod-deploy-gates3-5-vps.md)); the user-flow bugs below are post-deploy regressions or latent dev-vs-prod gaps that did not present on the local Mac stack.

The user explicitly deferred fixes to the next session — this file is the **pickup list**, not a fix log.

---

## Triage summary

| #   | Bug                                                                | Severity | Likely surface                                | Blocks       | Status (2026-05-02)                                                                    |
| --- | ------------------------------------------------------------------ | -------- | --------------------------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| P1  | Confirmed write returns denied/failed                              | Critical | Write executor / OpenEMR S2S / pending ledger | Gate 4 demo  | **fix shipped + redeployed** (`70af8e309` + tonight's `fb9613edb`); full E2E re-smoke deferred to morning |
| P2  | Dictation often replies "no recent encounter for active patient"   | High     | Encounter binding / handshake context / cache | Gate 5 demo  | **fix shipped + redeployed** (`20dd57f32` + tonight's `fb9613edb`); full E2E re-smoke deferred to morning |
| P3  | Auto brief intermittently blank; "Refresh chart" doesn't recover   | High     | Case-presentation fetch / cache / streaming   | Gate 3 demo  | **fix shipped + redeployed** (`a0cb1662f` + tonight's `fb9613edb`); browser smoke 2026-05-02 confirms auto-brief renders against cloned MariaDB on prod |
| M1  | Meta — overall agent hardening pass needed before video capture    | High     | Cross-cutting (orchestrator, retries, logging)| G7 demo cut  | substantially closed — observability spine `20c716935` + tonight's Langfuse wiring (`ca2006f74`) gives turn-level traces, tool spans, model+tokens+cost on prod |

---

## P1 — Confirmed write proposal returns denied/failed

**What happened (operator):** Dictated information to the agent. The agent responded with the proper proposal cards. On click of **Confirm**, the rail surfaced a denied/failed message (exact wording not captured) instead of writing to the chart.

**Why it matters:** This is the Gate 4 (UC-B) golden path — the exact flow we closed in [`process/journal/week-1/0430-T2230-gate4-g410-uc-b-smoke.md`](../process/journal/week-1/0430-T2230-gate4-g410-uc-b-smoke.md) yesterday in dev. Regression between dev-on-Mac and prod-on-VPS.

**Likely culprits to investigate (in order of probability):**

1. **Encounter binding mismatch** — proposal was issued against an `encounter_id` that no longer matches the active OpenEMR session encounter at confirm time (e.g., the encounter the user opened wasn't saved, or `$_SESSION['encounter']` rebound to a different encounter mid-session). Yesterday's Gate 4 close has the same fingerprint:  see encounter `280` vs `282` discussion in the G4-10 journal.
2. **Shared-secret drift** — `OPENEMR_MODULE_SHARED_SECRET` mirrored between PHP runtime and `agentforge-api` env, but the values may have skewed when prod secrets were last touched. Easy to verify with `docker exec ... env | grep OPENEMR_MODULE_SHARED_SECRET` on both `openemr` and `agentforge-api` containers — they must match byte-for-byte.
3. **MysqlCompletedWriteProposalLedger duplicate detection** — a stale row in `mod_agentforge_proposal_ledger` (or equivalent) from a prior smoke could be triggering `DuplicateProposalExecutionException` at the OpenEMR write boundary even though the rail thinks this is a fresh confirm.
4. **`log_from='agent'` ACL gap on prod** — a permission/ACL state on the prod MariaDB that doesn't exist on dev (e.g., the user that PHP writes through doesn't have grant for the encounter table on prod).

**Reproducer (next session):**
- Open a chart for a patient with a saved encounter today.
- Speak: `BP 125 over 60`.
- Click Confirm on the vitals proposal card.
- Capture: full text of the rail error, `docker logs --tail=200 development-easy-agentforge-api-1`, and the matching row in `agentforge.pending_proposals` (status, finalized_at, payload), plus the most recent `log` row in OpenEMR with `log_from='agent'` (or absence thereof).

### Resolution (2026-05-01) — fix shipped, prod verification pending

**Approach:** P1's root-cause-on-prod step required reproducing live, and the operator had no detail beyond "denied/failed" in the rail. Two-phase fix:

1. **Observability spine** — `20c716935` (`feat(agentforge-cui): surface typed error codes + correlation IDs on confirm failures`). Refactored `postProposalConfirm` / `postProposalReject` to throw `AgentForgeDeliveryError` carrying both `serverError` (e.g. `duplicate_proposal`, `unauthenticated`) and `correlationId`, then surface that in the rail as a code-shaped string (`Confirm failed (duplicate_proposal) — corr 8e2f1c..`). Distinct `ProposalPhase` for `delivery_failed` (transport / auth / 5xx) vs. the existing `openemr_denied` (200 + accepted=false). Means the next prod operator who hits a confirm error names the actual failure mode in the bug log instead of "denied".
2. **Hardening branch (secret drift)** — `70af8e309` (`fix(agentforge-api): probe OpenEMR module shared-secret in /health for prod parity`). New `interface/.../public/health/internal_auth.php` echo endpoint + new `probeOpenEmrModule()` in `agentforge/api/src/app.ts` that runs alongside the existing Postgres probe in parallel. `/health.deps.openemr_module` now reports `"ok"` / `"secret_mismatch"` / `"unreachable"` instead of the previous hard-coded `"unknown"`, and `/health.ok` reflects the combined Postgres + module health. **Operators can now diagnose secret drift in one curl, before any operator hits a write.**

The other two root-cause branches (stale ledger row, ACL gap) were not actively triggered because we have no live prod repro to disambiguate yet — but the branched fix in the plan stays applicable. The third branch (`missing_encounter_id` from API) was punted to P2's fix where the actual cause lives.

**Tests:** Vitest in `agentforge/api/test/http/health-and-correlation.test.ts` covers all four `probeOpenEmrModule` outcomes (ok / 401 mismatch / fetch-throws / unexpected status). Vitest in `agentforge/cui/src/api/client.test.ts` covers the typed-error path (200 ok, 200 denied, 400 duplicate, 401 unauth, network unreachable). Isolated PHPUnit `InternalAuthProbeStaticStructureTest.php` enforces the probe endpoint structure.

**Verification on prod (next session):** `curl -fsS https://108-61-145-220.nip.io/health` should now report `deps.openemr_module: "ok"`. Then re-run the BP smoke; on failure, the rail message will now name the specific server error code, which directly selects the next root-cause branch (no further plan-mode work needed).

---

## P2 — Dictation says "no recent encounter for active patient" (false negative)

**What happened (operator):** Multiple dictation attempts produced a response saying the agent could not find a recent encounter for the active patient — but the operator had a saved encounter open.

**Why it matters:** The G4-10 close (yesterday) explicitly addressed encounter binding by routing through `ChartContextGate::authorizeTrustedAgentCall` → `hydrateAgentSession` (`authUser`, `authUserID`, `authProvider`). If prod is not hydrating the same way, every encounter-bound proposal is dead on arrival.

**Likely culprits to investigate:**

1. **Session not hydrated for trusted S2S call** — `hydrateAgentSession` may rely on PHP `$_SESSION['encounter']` being present *at the moment the API calls back into OpenEMR*, which may be subtly different in prod (different SAPI, different session save handler, different cookie domain when CUI iframe origin differs from OpenEMR origin).
2. **Active-chart sync (G3-12) regression** — the rail may be using the patient ID from a stale handshake rather than re-reading from `OpenEMRChartContextGate` on each turn, so the agent sees the *previous* patient and finds no encounter for them. Symptom matches: works once, breaks on the next chart switch.
3. **Encounter freshness window too tight** — the agent's "recent encounter" lookup may filter by date in UTC and the prod box's clock is ~5 hours offset from the local Mac clock, so an encounter saved "today" in dev is "yesterday" in prod for the SQL window.

**Reproducer (next session):**
- Switch between two patients in OpenEMR while the rail is open. Note when the failure first appears.
- Capture: handshake_redeem response body, `chart_context.patient_id` reported by the rail, and the encounter lookup SQL the agent emits (turn on `LOG_LEVEL=debug` in `secrets.prod.env` for one run).

### Resolution (2026-05-01) — fix shipped, prod verification pending

**Root cause (confirmed by static analysis of orchestrator + handshake):** Two compounding bugs converged on the same operator-visible refusal.

1. **UTC `server_today`.** `agentforge/api/src/agent/orchestrator.ts` and `case_presentation_fetch.ts` both formatted the model-prompt's "today" via `new Date().toISOString().slice(0, 10)`, which is UTC. On the UTC-clock VPS, an encounter saved at 8 PM Eastern lands on the next UTC date and the model (correctly per `system_prompt.ts §14.3`) refuses to write because no encounter matches `server_today`. **Likely culprit #3 in the original triage was the right one.**
2. **Stale handshake `encounter_id`.** The JWT's `encounter_id` was frozen at handshake time, so when the operator opened the rail without an encounter, then saved one mid-session, the agent kept seeing `active_encounter_id: <none>` and refused dictation until the operator clicked Refresh. **Likely culprit #2 in the original triage was the right shape (active-chart sync) but applied to encounter binding rather than patient binding.**

**Fix:** `20dd57f32` (`fix(agentforge): use facility-local "today" + re-mint launch code on encounter change`).

- *Facility-local today.* New `OEGlobalsBag::getString('gbl_time_zone')` read in `handshake_redeem.php` flows through a new `facility_tz` JWT claim (optional + nullable, backward-compatible with pre-fix tokens), and orchestrator/case-presentation format `server_today` via `Intl.DateTimeFormat('en-CA', { timeZone, ... })` in the new `agent/local_date.ts` helper. Falls back to UTC silently on null/empty/unknown tz so a misconfig never crashes a turn.
- *Encounter refresh without an S2S round-trip.* The plan's original `context/active_encounter.php` per-turn S2S call was rejected as architecturally unsound (file-based PHP `$_SESSION` is not visible from the Node container). Instead, extended the existing G3-12 rail-polling loop in `templates/rail_container.html.twig` to watch `app_view_model.application_data.patient().selectedEncounterID()` in addition to `pid`. When either changes, the rail iframe reloads → re-mints the launch code → re-handshakes → JWT now carries the current `$_SESSION['encounter']`. **Operator gets the right encounter on the very next dictation turn after saving one, no manual Refresh required.**

**Tests:** Vitest covers the timezone helper (`local_date.test.ts`, 6 cases), orchestrator prompt header round-trip (`orchestrator.test.ts`, 2 cases), and JWT round-trip (`handshake-redeem.test.ts`, 2 cases). Isolated PHPUnit covers the PHP side: `SessionTokenInteropTest` legacy-token / facility_tz / malformed (3 cases), `HandshakeRedeemFacilityTzStaticStructureTest` (3 cases), `RailContainerStaticStructureTest` extended for `selectedEncounterID` polling.

**Verification on prod (next session):** Both reproducer paths from the original bug — "encounter saved 8 PM Eastern, refused as 'yesterday'" and "encounter saved mid-session, refused until Refresh click" — should now succeed. **G5-08 unblocks** if both pass; the engineer marks it `[x]` then.

---

## P3 — Auto brief intermittently blank; "Refresh chart" doesn't recover

**What happened (operator):** Sometimes the case-presentation brief never appears after the chart loads. Clicking "Refresh chart" does not trigger a re-fetch; the brief area stays blank.

**Why it matters:** Gate 3 (auto case presentation) is the entire pre-room half of the four-click journey. A blank brief defeats the "physician is briefed before entering the room" promise in [`journey.md`](../../../journey.md).

**Likely culprits to investigate:**

1. **Cache poisoning by an early failure** — `case_presentation_cache.ts` may be storing a failed/empty result keyed by `(patient_id, encounter_id)`, and Refresh chart only re-runs the *fetch* without invalidating the cache. The brief returns the cached empty string forever for that chart.
2. **Streaming completion not signaled** — the rail waits on a `done` frame that the orchestrator may not emit if the LLM call errors mid-stream. UI sits in "loading" forever, then visually settles to blank.
3. **CORS / fetch silently failing** — DevTools console likely has the answer in one line. Worth checking `CUI_ALLOWED_ORIGINS` covers every origin the iframe actually appears under (including any port-changing redirects from OpenEMR module routing).

**Reproducer (next session):**
- Load a chart that produces a brief successfully, then load a chart that doesn't, then return to the first. If the first now also fails, suspect cache; if the first still works, suspect per-chart fetch path.
- Capture: DevTools Network panel filtered to `case_presentation` and `chat`; agentforge-api log lines tagged `phase=case_presentation`.

### Resolution (2026-05-01) — fix shipped, prod verification pending

**Root cause (confirmed by code reading):** Three independent bugs converged on the same UI symptom — exactly culprit #1 from the original triage, plus two additional gaps the original triage did not yet name.

1. **Cache key omits `encounter_id`.** `case_presentation_cache.ts` keyed entries on `(patientUuid, sha256(sessionToken))`. With the P2 rail-polling fix, the same session token can now legitimately span two encounters on the same patient (encounter saved mid-session → re-mint launch code → same Postgres-side identity binding, new `encounter_id`). Pre-fix that meant a brief generated against encounter A was silently served back for encounter B.
2. **"Refresh chart" only re-loaded the iframe.** `App.refreshChartBinding()` called `window.location.reload()` and nothing else — the rail re-mounted and re-handshook, but the agent's in-process brief cache for `(patient, encounter, sessionToken)` was untouched, so the freshly-mounted App immediately re-read the same stale entry.
3. **Empty / refusal-only briefs were cached.** `runCasePresentationUncached` unconditionally wrote whatever the LLM returned to the cache, including `blocks=[]` (transient provider hiccup, which `verifyClinicalBlocks` then transforms into a single `insufficient_evidence_after_verification` refusal) and refusal-only outputs. Combined with bugs 1+2, an operator who hit a transient empty-brief moment was pinned to a blank rail with no recovery for the full 30-minute TTL.

**Fix:** `a0cb1662f` (`fix(agentforge): scope brief cache by encounter + bust on Refresh + skip caching empty/refusal results`).

- *Cache + inflight key now include `encounterId`* (or the literal `"none"` bucket for null-encounter charts). Two encounters on the same patient under the same session token correctly produce two distinct cache entries and two LLM calls.
- *Refresh now busts the server cache.* Before reload, `refreshChartBinding()` fires-and-forgets `postPresentPatient(..., force_refresh=true)`. Failures are tolerated silently — the reload that follows is the user-visible recovery path.
- *`isCacheable(blocks)` gate.* Refuses to cache empty or refusal-only outputs. The result is still returned to the caller (so they see the refusal), but the next call automatically retries instead of pinning to the bad result.

**Tests:** 3 new Vitest cases in `agentforge/api/test/agent/case_presentation.test.ts` (cross-encounter cache miss, empty-brief not pinned, refusal-only not cached). New `agentforge/cui/src/App.test.tsx` (2 cases) covers the Refresh button: issues `force_refresh=true` then reloads, and reload still happens when the cache-bust call rejects.

**Verification on prod (next session):**
1. Load chart A (good brief, cached). Switch to chart B that exhibits the bug. Switch back to chart A — the good brief should still appear (the encounter-keyed cache makes A and B independent).
2. Click Refresh on chart B with DevTools Network open — observe a `force_refresh: true` body in the present-patient POST that fires before the reload.

---

## M1 — Meta: agent hardening pass needed

The above three bugs share a common shape: **dev-on-Mac green → prod-on-VPS broken** in a way that's not a configuration problem (env validates, all containers healthy, public TLS works, `/health: ok`). That points at agent-loop code that's tolerant of dev-only assumptions.

**Hardening targets to plan into Gate 6 / pre-G7-01 demo cut:**

- ~~**Always emit a typed error frame on every WS / chat failure path.**~~ **DONE for confirm/reject** in `20c716935` (P1). Write-confirm failures now surface `(<server_error>) — corr <id>` in the rail. Brief-fetch and dictation paths still rely on the existing CUI failure UX; carry forward into G6-19.
- **Server-side correlation id echoed back to the rail on every failure.** **DONE for confirm/reject** in `20c716935` (the rail now displays the correlation id from the API's response). WS / brief surface still pending — carry forward.
- ~~**Cache invalidation on Refresh chart**~~ — **DONE** in `a0cb1662f` (P3). Refresh now fires `force_refresh: true` to drop the server cache before reloading the iframe.
- **Encounter binding test on prod-shape stack** — partial: P2 fix (`20dd57f32`) covers the most common dev-vs-prod gap (UTC vs facility tz). Running G4-10 against the prod compose on Mac is still recommended for G6-19.
- **Structured "agent decision" log line per turn** — still pending; carry forward into G6-19 unchanged.

The rest of this hardening list (and any new items P1-P3 surface during prod re-smoke) lives in `G6-19 — agent hardening for prod parity` per the task list.

---

## Discovery context

These bugs were found during the manual smoke at the end of the prod deploy session captured in [`process/journal/week-1/0501-T0014-prod-deploy-gates3-5-vps.md`](../process/journal/week-1/0501-T0014-prod-deploy-gates3-5-vps.md). The infra side of that deploy was 100% green:

- `agentforge-api` listening on 3000 (post `npm ci` + `tsc`).
- All 7 Postgres tables (`heartbeat`, `conversations`, `pending_proposals`, `transcripts`, `transcript_segments`, `turns`, `schema_migrations`) present after applying migrations 001/002/003.
- Public `/health` returns `{"ok":true,"providers":{"llm":"anthropic","stt":"assemblyai"},"deps":{"postgres":"reachable",...}}` over verified TLS — first time this VPS has served `/health` without needing `-k`.

So these are **agent / write-path bugs**, not deploy bugs. Treat accordingly.
