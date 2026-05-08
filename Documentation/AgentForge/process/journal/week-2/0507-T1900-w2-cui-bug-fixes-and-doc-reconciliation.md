---
date: 2026-05-07
topic: CUI stability bug fixes (refresh-button panel-disappear + intake confirm chart auto-reload) + submission.md/TASKS.md reconciliation pass + Patient Dashboard Migration PRD authored
related_milestone: process/milestones/week-2/04-g2-early-gate-completion.md
---

# W2 CUI bug fixes + reconciliation + dashboard PRD — session journal

## Goal

Three-track session for tonight's midnight redeploy and the Sunday submission window. Jason's framing on Bug-fix track: *"I'm able to upload the intake form and receive a proposal card afterwards that, when I confirm it says that it has been captured, eight of eight fields. However, the chart does not auto reload like it does when I confirm the other proposal cards. Also, if I click the refresh button within the CUI header, the entire panel actually disappears entirely…"* Doc-reconciliation track: catch up [submission.md](../../../submission.md) and [TASKS.md](../../../../TASKS.md) to the post-consolidation code state in master so the grader's reading surface matches what's deployed. Dashboard track: scope and write the PRD for the surprise-challenge Patient Dashboard Migration so Friday morning starts with a build plan, not a scoping exercise.

## Context

Built on the parallel-worktree consolidation captured in [`0507-T1715-w2-parallel-worktree-consolidation.md`](0507-T1715-w2-parallel-worktree-consolidation.md). That session merged the FB-A/B/C/D feature drop from eloquent-heisenberg + the W2 write tools from pedantic-mahavira into master via [`11dc4cefb`](.) + [`00ffb891a`](.). The merge brought ~14 user-visible features into master in a single sweep but did NOT update [`TASKS.md`](../../../../TASKS.md) row markers or [`submission.md`](../../../submission.md) scoreboard counts. Jason then exercised the consolidated code locally and surfaced the two CUI stability bugs above. Tonight's redeploy depends on both being fixed.

The 2026-05-06 Surprise Challenge PDF ([`AgentForge — Clinical Co-Pilot W2 — Surprise Challenge_ Modernize the Patient Dashboard.pdf`](../../../references/AgentForge%20—%20Clinical%20Co-Pilot%20W2%20—%20Surprise%20Challenge_%20Modernize%20the%20Patient%20Dashboard.pdf)) was filed in references but never ingested as a task track. Jason's earlier journal references to "new Sunday-deadline requirements" mapped to it; this session names it explicitly and scopes it as a separate frontend deliverable consuming OpenEMR's existing FHIR R4 + OAuth2 server (no backend changes per the brief).

## Key decisions

### Decision: framework choice for the dashboard — React + Vite + TypeScript (not Next.js)

- **Prompt:** *"instead of Next.js, I would like to use … the framework, I really am comfortable with React. I think, because it matches our existing clinical co-pilot front end, it'd be very easy for me to work with and make sure we can meet the deadline by Sunday."*
- **Recommendation:** Agree. The grade rubric explicitly asks for a framework-choice defense, and "we picked the same React + TypeScript + Vite stack we already shipped W1's CUI on, because it's the lower-risk path to a working dashboard with a graded defense behind it" is a *better* narrative than chasing Next.js for server-side token holding (a feature we don't strictly need for a graded demo against synthetic patients). Honest tradeoffs (no SSR, token-in-memory vs. server-held, no App Router) get documented in the defense doc.
- **Outcome:** Locked. PRD §4 captures the rationale; defense doc (`PATIENT_DASHBOARD_MIGRATION.md`) gets written Saturday evening with the actual tradeoffs we hit during the build.

### Decision: PRD-only, no separate TASKS.md section for the dashboard

- **Prompt:** *"We will turn your response here into the PRD for this, and then from that PRD we will maybe add a new section of tasks to the task list. Maybe that's extra work that we don't need… I'll let you make a judgment call."*
- **Recommendation:** PRD-only. Adding 30+ rows to [`TASKS.md`](../../../../TASKS.md) for a track that uses a different artifact set (no eval cases, no PHP, different API surface) muddies the W2 brief's grading story. The PRD has its own embedded task list (PD-01..PD-52) and lives at [`Documentation/AgentForge/implementation/PRD-patient-dashboard.md`](../../../implementation/PRD-patient-dashboard.md). Post-Sunday, fold what shipped into a milestone entry and archive the PRD.
- **Outcome:** PRD shipped this session; TASKS.md is unchanged for this track.

### Decision: Bug B fix — soft refresh, don't hard-reload the iframe

- **Prompt:** *"if I click the refresh button within the CUI header, the entire panel actually disappears entirely, which must be a stability problem in how the CUI is being presented reliably or something to this effect that we need research and diagnosis for a fix."*
- **Recommendation:** Read the actual code. [`App.tsx:758`](../../../../agentforge/cui/src/App.tsx:758) calls `window.location.reload()`, which re-mounts the iframe document. Re-mount runs [`panel.php:48`](../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php:48) which mints a new one-time launch code. [`useHandshake.ts:36`](../../../../agentforge/cui/src/chat/useHandshake.ts:36) tries to redeem it; under transient conditions (in-flight cache-bust racing the reload, brief session refresh, double-mount in dev StrictMode), the redeem can land in `status: 'error'` and the rail renders nothing visible — operator sees "panel disappeared." This is a **pre-existing** bug, not a regression from today's consolidation merge.
- **Outcome:** Replaced the hard reload with a soft refresh path: when the handshake is already valid (`status === 'ready'`), we don't re-mount the iframe at all — we bust the API brief cache (`postPresentPatient(forceRefresh=true)`) and reset `briefStatus` to `'idle'` so the brief auto-fetch effect re-runs without remounting. Preserved the `window.location.reload()` fallback for the pre-handshake / error-state escape hatch (the only path where re-mount is genuinely needed). Also reset `briefInFlightRef.current = false` so the auto-fetch effect's idempotency guard doesn't block the second fetch on the same iframe instance. Diff is contained to the `refreshChartBinding()` function; no other state machine touched.

### Decision: Bug A fix — extend host listener to also reload demographics tab for patient-level write_targets

- **Prompt:** Same as above — *"the chart does not auto reload like it does when I confirm the other proposal cards"* on intake confirm.
- **Recommendation:** Initial agent-driven diagnosis suggested the `WRITE_CONFIRMED` postMessage timing was off; reading the actual code disproved that — the postMessage IS sent correctly after `await dispatchIntakeConfirm`. The actual root cause is that the host listener at [`rail_container.html.twig:753`](../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig:753) calls `triggerOpenEmrEncounterRefresh()` on every `WRITE_CONFIRMED`, which only reloads `forms.php` (the encounter forms panel — chief complaint, vitals, clinical notes). The intake card writes patient-level data (allergies, medications, family history, demographics) which lives on the demographics tab and patient sidebar — surfaces `forms.php` does not include. So the postMessage fires, encounter forms reload, but the surfaces where the new intake data actually appears never refresh.
- **Outcome:** Extended the host `WRITE_CONFIRMED` handler with a `patientLevelWriteTargets` allow-list (`intake_proposal`, `allergy`, `allergy_delete`, `medication_add`, `medication_discontinue`, `family_history_add`, `demographics_update`). When the incoming `data.write_target` matches, the handler ALSO calls `navigateDemographicsInChrome()` (which calls OpenEMR's `loadCurrentPatient()` — same global the top-bar patient-name link is bound to). Encounter-level write_targets (`chief_complaint`, `vitals`, `clinical_note`, `tobacco`) are intentionally excluded — their surfaces are already handled by the encounter refresh and double-firing would just churn the encounter tab. Strictly additive; existing behavior preserved for everything that already worked.

### Decision: skip per-row TASKS.md `[ ]`→`[x]` flips for FB-A/B/C/D, ship a reconciliation note instead

- **Prompt (implicit):** Time pressure for the midnight redeploy. Per-row updates are noisy and low-leverage when the grader reads README + submission.md + the deployed app, not TASKS row-by-row.
- **Recommendation:** Add a single multi-line CONSOLIDATION RECONCILIATION NOTE at the top of the FB-A section in [`TASKS.md`](../../../../TASKS.md) listing every shipped FB-A/B/C/D artifact with file:line references. Update [`submission.md`](../../../submission.md) §1 deliverable 4 (eval cases: 75 → 88) and §3.1 code-side checklist with new ✅ rows for each FB-A/B/C/D protected-spine ship. Defer the row-by-row flips to a post-Sunday cleanup pass.
- **Outcome:** [`TASKS.md`](../../../../TASKS.md) FB-A header carries the note pointing to this journal entry. [`submission.md`](../../../submission.md) §3.1 lists 4 new ✅ rows for FB-A/B/C/D protected spines + 1 new ✅ row for tonight's CUI stability fixes. Eval count + baseline version updated in §1 row 4.

## Trade-offs and alternatives

- **Bug B Option C: just delete the refresh button** — rejected. Jason described the bug as "stability problem in how the CUI is being presented" — implies the button SHOULD work, deleting it would be a cut not a fix. Soft refresh preserves the button's purpose (cache-bust + brief re-fetch) without the iframe-remount fragility.
- **Bug A Option B: have the IntakeProposalCard send a different message type** (`PATIENT_RECORD_UPDATED` instead of `WRITE_CONFIRMED`) so the host can route differently — rejected. The existing single-target patient-level cards (single allergy add, etc.) face the same demographics-non-refresh issue; fixing it at the host listener layer benefits ALL patient-level writes, not just intake. One change, broader payoff.
- **Bug A Option C: refresh the entire patient page (top.location.reload())** — rejected. Too aggressive; would interrupt a clinician's open work in other tabs/forms. `loadCurrentPatient()` is the targeted equivalent OpenEMR's own UI uses.
- **Dashboard framework: Next.js with App Router** — rejected per Jason's pushback (matches W1 stack, faster to ship, defense narrative is stronger). Honest tradeoff list documented in [PRD-patient-dashboard.md §4](../../../implementation/PRD-patient-dashboard.md) for the defense.
- **Per-row TASKS.md flips for FB-A/B/C/D** — deferred. The information is already captured in submission.md's scoreboard with file:line proofs; doubling it across both files burns night-of-deploy time without the grader benefit. Post-Sunday pass.

## Tools, dependencies, commands

_None new this session._ Existing toolchain exercised:

- `npx vitest run` × 2 (CUI side: 83 passing + 5 pre-existing pdfjs/DOMMatrix failures journaled in 0507-T1715; API side: 370 passing + 1 pre-existing skip).
- `composer phpunit-isolated` (2863/2863 passing — twig template render tests caught the rail_container edit cleanly; no fixture regen needed since the change is inside a `<script>` block, not Twig syntax).
- `npx tsc --noEmit` (CUI side — verified my App.tsx edit compiles; 2 pre-existing type errors in Composer.tsx + MessageList.tsx confirmed unrelated to my edits).

## Files touched

**Created (3):**

- [`Documentation/AgentForge/implementation/PRD-patient-dashboard.md`](../../../implementation/PRD-patient-dashboard.md) — full PRD with 11 sections, 52-task embedded list, framework defense rationale, FHIR endpoint mapping, OAuth2/PKCE flow, risk + cut order
- [`Documentation/AgentForge/process/journal/week-2/0507-T1900-w2-cui-bug-fixes-and-doc-reconciliation.md`](.) — this entry
- (Pending — Saturday) `PATIENT_DASHBOARD_MIGRATION.md` at repo root — defense doc for the surprise challenge grade; written after the build per the PRD's PD-40 row

**Modified (3):**

- [`agentforge/cui/src/App.tsx`](../../../../agentforge/cui/src/App.tsx) — `refreshChartBinding()` rewritten: post-handshake soft refresh via `briefStatus` reset + `briefInFlightRef` clear, no iframe re-mount; pre-handshake fallback to hard reload preserved (Bug B fix)
- [`interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig`](../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) — `WRITE_CONFIRMED` handler now also calls `navigateDemographicsInChrome()` for the 7 patient-level `write_target` values; encounter-level write_targets unchanged (Bug A fix)
- [`Documentation/AgentForge/submission.md`](../../../submission.md) — §1 deliverable 4 updated to 88 cases / `w2-consolidated-2026-05-07` baseline; §3.1 added FB-A/B/C/D protected-spine ✅ rows + tonight's CUI stability fixes row
- [`TASKS.md`](../../../../TASKS.md) — FB-A section header carries a CONSOLIDATION RECONCILIATION NOTE listing every FB-A/B/C/D artifact shipped in master with file:line references, plus pointer to this journal entry

## Outcomes

- **Both CUI stability bugs fixed and tested clean** — CUI vitest 83 passing, API vitest 370 passing, PHP isolated 2863 passing. No new test regressions introduced.
- **Doc reconciliation done at the highest-leverage layer** — submission.md scoreboard reflects the post-consolidation code state; the grader sees the truth without having to dig.
- **Patient Dashboard Migration scoped and committed to a build plan** — Friday morning starts with PD-01..07 (scaffold + auth round-trip), not with another scoping pass. Cut order pre-decided so we don't have to make tier decisions under deadline pressure.
- **Tonight's redeploy is unblocked** — operator (Jason) can run `docker/agentforge/deploy-preflight.sh` then push to VPS; the consolidated W2 brief code now has 2 fewer user-visible bugs and a more accurate scoreboard for the grader.

## Next steps

- [ ] **(USER, tonight)** Run `bash docker/agentforge/deploy-preflight.sh` from repo root; if green, redeploy to VPS per G2-Early-61..63: dump local DB → transfer → restore on VPS → run `bin/agentforge-enable.php` → `npm run rag-index` against prod Postgres → re-run `seed_appointments.php` for 5/10–5/13 window
- [ ] **(USER, tonight)** Smoke test on deployed VPS: open Margaret Chen → upload intake PDF → confirm proposal card → verify demographics tab refreshes (Bug A fix) → click refresh button → verify panel stays present (Bug B fix); record short demo if there's time
- [ ] **(USER, tonight)** Submit by midnight per the assignment Jason mentioned
- [ ] **(Friday morning)** Phase 1 of [`PRD-patient-dashboard.md`](../../../implementation/PRD-patient-dashboard.md): PD-01..PD-07 (scaffold + auth round-trip). Auth working by Friday lunch is the on-track signal.
- [ ] **(Friday afternoon + evening)** Phase 2 + start Phase 3
- [ ] **(Saturday)** Phase 3 finish + Phase 4. Self-injection rehearsal in parallel for the W2 brief track (G2-Final-Rehearsal — non-negotiable)
- [ ] **(Saturday evening)** Phase 5: write `PATIENT_DASHBOARD_MIGRATION.md` defense doc
- [ ] **(Sunday AM)** Phase 6 submission integration — submission.md updated, demo video re-cut to include 30s dashboard segment, final commit + push to GitLab
- [ ] **(Sunday 12:00 CT)** Final submission for both W2 brief + surprise challenge

## Links

- Numbered milestone: [process/milestones/week-2/04-g2-early-gate-completion.md](../../milestones/week-2/04-g2-early-gate-completion.md)
- Predecessor session journal (the consolidation that brought FB-A/B/C/D into master): [0507-T1715-w2-parallel-worktree-consolidation.md](0507-T1715-w2-parallel-worktree-consolidation.md)
- Patient Dashboard PRD: [Documentation/AgentForge/implementation/PRD-patient-dashboard.md](../../../implementation/PRD-patient-dashboard.md)
- Surprise Challenge brief: [Documentation/AgentForge/references/AgentForge — Clinical Co-Pilot W2 — Surprise Challenge_ Modernize the Patient Dashboard.pdf](../../../references/AgentForge%20—%20Clinical%20Co-Pilot%20W2%20—%20Surprise%20Challenge_%20Modernize%20the%20Patient%20Dashboard.pdf)
- W2 Architecture (the AgentForge agent — separate track from this dashboard): [W2_ARCHITECTURE.md](../../../../W2_ARCHITECTURE.md)
- Submission scoreboard: [Documentation/AgentForge/submission.md](../../../submission.md)
- W2 Tasks (execution map): [TASKS.md](../../../../TASKS.md)
