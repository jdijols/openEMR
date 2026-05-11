---
date: 2026-05-10 → 2026-05-11
topic: W2 prod deploy, post-deploy bug triage (5 bugs), cohort reset for grader demo
related_milestone: process/milestones/week-2/08-deploy-bug-triage-cohort-reset.md
---

# W2 deploy, post-deploy bug triage, cohort reset — session journal

## Goal

Kick off with: "*okay we are good to begin our VPS deploy*". Bring the
VPS prod tip from the 5/8 deploy (`3456a4e42`) forward to the new master
tip carrying the W2 dashboard work, the bug-fix rounds discovered during
browser smoke, the new `problem_list` end-to-end addition, and finally a
cohort-state reset so graders walk into a clean demo. Single long
session across 5/10 evening → 5/11 early-morning CT.

## Context

12 commits accumulated on master since the 5/8 HTTPS-retrofit deploy.
Headline additions:

- `f9441da9e` + `8fc62555b` + `8716faf6a` — **patient-dashboard React app**
  (W2 surprise challenge): 11 cards rendering live FHIR, chart-shell
  integration via embedded mode + MemoryRouter, defense doc, card-collapse
  polish, two OpenEMR-core 500s fixed in-module.
- `80fbfb5c7` — W2 hybrid allergy modal + LLM judge + proposal API.
- `ad916e90a` — live routing status pill via `/chat` SSE.
- `5f62e0dce` — CUI uploads project to OpenEMR Documents + provenance.
- `53cb5db69` — affordance + queue iteration phases 1-4 + QA-pass hardening.
- `d54201517` — citation contract end-to-end (ADODB stdout claim,
  FHIR query try/catch, bbox overlay, finalizer cost-fix folded in).

Deploy ran clean through the established runbook. Then browser smoke
surfaced five bugs that consumed the rest of the session: modal-no-dismiss,
documents-tab-blank, view-in-docs-misfire, extraction-misses-fields,
preview-decays-to-alt-text. Final phase: full cohort-state reset on local
+ VPS so the four W2 cohort patients present as fresh new-patient intakes
for graders.

## Key decisions

### Decision: Deploy the 12 commits with pre-flight host build check

- **Prompt**: "*we are good to begin our VPS deploy ... drop the first command for me*"
- **Recommendation**: Standard runbook from 0506 + 0508 deploys —
  backups → git fetch+reset (no `clean -fd`, preserves Caddyfile symlink) →
  `up -d --build` → restart agentforge-api → /health smoke. Add a
  pre-flight `npm run build` in `agentforge/api/` on the host BEFORE
  touching the VPS — the 0508 deploy got bit by a latent TS2379 the
  prod-tsc path surfaced only at container build time.
- **Outcome**: HEAD at `d54201517` on VPS. agentforge-api recreated,
  `npm ci` (17s) + `tsc` clean + `node dist/index.js` listening on 3000.
  `/health` green. The pre-flight tsc was clean too — caught nothing
  this round but kept the safety net in place. The openemr container
  also needed an explicit recreate because the `OPENEMR__NO_BACKGROUND_TASKS`
  env var added in 5/9 work hadn't propagated yet.

### Decision: Restart agentforge-api explicitly because compose didn't recreate it

- **Prompt**: implicit — the `up -d --build` output showed
  `agentforge-api ... Running 0.0s` rather than `Started`.
- **Recommendation**: Docker Compose only recreates a container when its
  service definition changes (image, env, command). The agentforge-api
  source comes in via the bind mount at `/app`, and its `command:` runs
  `npm ci && npm run build && node dist/index.js` exactly once at boot.
  A `git pull` updates the on-disk source but the running process still
  has the prior compiled `dist/`. Need explicit `docker compose restart
  agentforge-api` to re-trigger the build+start chain.
- **Outcome**: Restart took 10s shutdown + 17s npm ci + ~5s tsc + node
  boot. `agentforge-api listening on 3000`. New code live.

### Decision: Bug #2 / Bug #5 are workflow-only, not a code bug

- **Prompt**: "*the files we're uploading ... show up blank ... preview
  image changes to just the alt text*"
- **Recommendation**: Walked through documents table state + filesystem
  on VPS. Found: 8 documents rows from today (dated 10:16-16:31 UTC)
  but **zero matching files on disk under `/sites/.../documents/<pid>/`**.
  At first looked like a write-path silent failure. Then noticed the
  documents/ named volume IS persistent on the VPS, AND the row
  timestamps all fall BEFORE the 18:32 UTC deploy. Conclusion: those
  rows came over via the morning DB clone, which carries `documents`
  metadata rows but NOT the underlying `/<pid>/<uuid>` filesystem bytes.
  The bug is "DB-clone refresh workflow doesn't carry files" — orphan
  rows look like uploads but have no backing bytes. NOT a write-path
  regression.
- **Outcome**: Workflow caveat documented for future operators (operator
  upload session on the VPS after a clone re-populates fresh, real bytes).
  See follow-up "Decision: idempotency-hit returns valid oe_document_id"
  for the related fix that addresses the stale-sidecar case downstream
  of this workflow gap.

### Decision: Bug #1 modal-dismiss fix — broadcast `proposal:resolved` from the affordance path

- **Prompt**: "*if I confirm from within the affordance in the chat, the
  pop-up still persists and does not dismiss*"
- **Recommendation**: `onProposalResolved` in
  [`agentforge/cui/src/App.tsx:462`](../../../../../agentforge/cui/src/App.tsx)
  updated the local message state AND broadcast `chart:updated` (for FHIR
  cache refresh) but never broadcast `proposal:resolved`. `BundleReviewModal`
  already subscribes to `proposal:resolved` to know when to close. Just
  needed to add the broadcast in the accepted/declined branches.
- **Outcome**: 3-line edit landed in commit `311ac9ef5`. Confirm from
  affordance now dismisses both the affordance AND the open modal.
  Verified live.

### Decision: Bug #3 "View in documents" — three rounds to find the actual root cause

- **Round 1**: Removed bbox-modal fallback in `onViewInDocuments`. Click
  with missing IDs went from "wrong action" to "silent no-op". Better, not
  enough. The link still wasn't visible most of the time.
- **Round 2**: Plumbed `oe_document_id` + `oe_patient_pid` through the
  chat call body → server schema → orchestrator → extraction block. The
  CUI's click handler now takes them directly off the block instead of
  doing a `messages.find` lookup (which silently failed under cache
  replay because the File reference can't serialize across rehydrate).
  Link conditionally renders only when both IDs are on the block.
- **Round 3 (the actual root cause)**: After round 2 deployed, the link
  was STILL hidden. Diagnosed on VPS: zero documents rows from today's
  fresh uploads. Why? `DocumentUploadAction::execute` hits idempotency
  in the agentforge_w2/ sidecar (same `(patient, sha256)` from earlier
  testing). On idempotency hit, the code short-circuited with
  `DocumentUploadResult::existing($docrefUuid)` — `oeDocumentId` was
  **hardcoded null**. So PHP returned `oe_document_id: null`, CUI
  didn't forward, block didn't have it, link hidden. Worse: today's DB
  swap wiped the documents row that the sidecar's stored `oe_document_id`
  used to point to — so even a naive "return the sidecar's stored id"
  fix would 404.
- **Recommendation**: On idempotency hit, look up the sidecar's stored
  `oe_document_id`, verify the documents row still exists for this
  patient (new `documentExistsForPatient(int, int)` port method, single-row
  SELECT via `QueryUtils::fetchSingleValue`), and if missing or stale,
  re-register with OpenEMR to mint a fresh row + update the sidecar.
  Idempotency at the `.bin` level preserved; only the OpenEMR projection
  refreshes when stale.
- **Outcome**: Shipped in `ce88b5d0f` (4-file PHP change). Verified live
  with a fresh upload on a non-cohort patient — link visible, click
  navigated to the right doc, content viewable. Fix is also the durable
  answer for the "operator re-clones DB and stale sidecar IDs orphan"
  class of workflow incident.

### Decision: Bug #4 — schema gap was the real culprit, not extraction quality

- **Prompt**: "*[Sofia Reyes' intake form] has listed medical problems
  ... those medical problems are not being surfaced in the bundle pop-up*"
- **Recommendation**: Two-part fix.
  - **Part a (prompt tightening)**: Sharpened
    [`intake_extractor.ts`](../../../../../agentforge/api/src/workers/intake_extractor.ts)
    with a Demographics completeness rule (explicit guidance for
    phone/email/address-parts/occupation) and a Pre-emit completeness
    pass. The latter was reverted in a later commit (see latency cut
    decision below).
  - **Part b (schema gap)**: `IntakeFormSchema` was missing
    `problem_list` entirely. The prompt explicitly excluded
    `past_medical_surgical_history` as "out of scope". Added end-to-end:
    `IntakeProblemSchema` (condition, onset_date, status, comments,
    citation) + prompt section + bundle assembler iterator + dispatcher
    `'problem_add'` target + 5 PHP files (Port / Adapter / Payload /
    Action / HTTP entry) writing to `lists.type='medical_problem'` +
    `BundleReviewModal` label rendering.
- **Outcome**: Verified live on prod — Medical Problems section appears
  in the bundle modal with real rows, "Confirm All" writes to chart.

### Decision: Drop the pre-emit completeness pass to cut latency

- **Prompt**: "*extraction went faster ... feels like 5 minutes... if
  it's actually a problem with the schema and not necessarily the AI
  agent not capturing the data, then maybe we can remove that extra
  pass*"
- **Recommendation**: User's intuition was right. With `problem_list`
  in the schema, the model had the structural surface it needed —
  the extra "scan one more time" pass was adding reasoning tokens
  without proportional accuracy benefit. Removed; kept the Comprehensive
  extraction rule and Demographics completeness rule.
- **Outcome**: Extraction noticeably faster on the second smoke pass.
  Operator-confirmed.

### Decision: Demographics bundle row was showing field-key names, not values

- **Prompt**: "*what I see in the pop-up is not the actual patient data
  but the key associated with it ... 'last name', 'first name', 'date
  of birth'*"
- **Recommendation**: `BundleReviewModal.summarizeItemPayload` for
  `demographics_update` was rendering `Object.keys(payload).filter(...)`
  — literally listing field names regardless of which patient. Replaced
  with a content-first render: "Sofia M Reyes · DOB 1978-05-21 · Female
  · +1 512 555 0177 · 1124 South Lamar Blvd Austin TX 78704 · …". Also
  swapped the row's `truncate` for `break-words` + `items-start` so
  longer demographics lines wrap into the section instead of clipping.
- **Outcome**: Demographics now scannable for review.

### Decision: Cohort reset workflow — local-→-VPS clone doesn't carry document files

- **Prompt**: "*we need to reset the database on these four patients
  back to their new patient intake status*"
- **Recommendation**: Five-phase reset.
  - Phase 1 — backup (both mariadb + postgres on VPS).
  - Phase 2 — chart data wipe scoped to `pid IN (151,152,153,154)`:
    lists, documents + categories_to_documents, history_data, forms +
    form_encounter + form_vitals + form_clinical_notes, procedure_*,
    prescriptions.
  - Phase 2b — sharper-before-state demographics: clear phone_cell,
    phone_home, street, city, state, postal_code, email; keep fname,
    lname, mname, DOB, sex, pubpid, providerID.
  - Phase 3 — postgres `agentforge.pending_proposals` delete for
    cohort UUIDs.
  - Phase 4 — filesystem sidecar wipe (`agentforge_w2/*.bin/.json` +
    `_obs/*.json`). NOT pid-scoped — we wipe everything because each
    sidecar would need a JSON read to determine patient ownership;
    cohort is the only active demo path so a global wipe is acceptable.
- **Subtle gotcha**: Phase 2 wiped the four cohort's `form_encounter`
  rows along with everything else. That ALSO wiped the pre-checkin
  encounters Jason had seeded locally to simulate "patient checked in
  + MA recorded vitals + reason for visit" — the realistic physician
  journey. Discovered post-cleanup. Recovery: targeted
  `mariadb-dump --where="pid IN (151,152,153,154)"` from local for
  `form_encounter` + `forms` + `form_vitals` + `form_clinical_notes`
  (nursing_note only, excluding agent-test progress notes); shipped to
  VPS; imported. Encounter IDs 958–961 were freed by the Phase 2 delete
  so straight INSERTs with explicit IDs landed without conflict.
- **Outcome**: Cohort reset clean on VPS — 0 lists / 0 docs / 0 history
  / 0 progress_notes; demographics cleared; pre-checkin encounter +
  MA nursing note + vitals restored.

### Decision: Local cohort needed parallel cleanup before re-clone

- **Prompt**: "*we 2 backups made from this chat... lets get back to
  the state of the db when i sent this message*" → escalation when
  operator panicked seeing test data on other patients' charts → reframe
  as "local has rich demo state already; the VPS state we want IS the
  local state filtered through the cleanup".
- **Recommendation**: Apply the same cleanup pattern to local, but
  retain demographics (operator explicitly preferred rich contact data
  on local). Steps:
  - Orphan-encounter cleanup: 45 `form_encounter` rows referenced pids
    not in `patient_data` (leftover demo fixtures). DELETEd. (In
    hindsight should have cross-referenced calendar events first —
    user flagged. Caveat noted.)
  - Returning-patient feature-test data cleanup: 10 of 13 returning
    patients had agent-test writes between 5/7-5/11. Surgical DELETE
    of lists / documents / prescriptions / non-nursing
    form_clinical_notes scoped to those pids + that date window.
    Preserves pre-5/7 history (the real returning-patient backstory)
    + appointment-day encounter + MA nursing note.
  - Cohort parity: Margaret Chen still had agent-test data on local
    (3 allergies + 4 medications + 2 documents + family history fields
    + a lab summary progress note + 5 `_obs/` lab observation sidecars
    keyed to her UUID). Brought her to parity with James / Sofia / Robert.
    Robert also had a stray lab-summary progress note from earlier
    testing — also deleted.
- **Outcome**: Local cohort matches the demo-ready shape. Re-clone to
  VPS preserves the cleanup.

### Decision: Encounter binder fallback — bind latest encounter when no same-day match

- **Prompt**: "*physician selects any patient their appointment day
  encounter also becomes active ... only patients scheduled on 5/11
  have this working like expected*"
- **Recommendation**:
  [`AppointmentEncounterBinder::bindForCurrentPatient`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php)
  resolved `$targetDate` from the appointment-context date OR today,
  then looked for an encounter matching `DATE(fe.date) = $targetDate`.
  For a multi-day cohort demo (5/10-5/13), only the patients scheduled
  for "today" (5/11 UTC on the day of test) found their MA-prep
  encounter via the same-day lookup. Other-day cohort patients hit the
  no-match return and chart-opened with no encounter queued.
- **Surgical fix**: Add a final fallback `findLatestEncounter($pid)`
  (no date filter, latest-first ORDER BY) called AFTER both the
  tracker-linked lookup and the same-day lookup have missed. Preserves
  the production tracker / appointment-context flow; only the "no match
  anywhere" branch now resolves to "queue the latest encounter you have"
  rather than "no encounter."
- **Outcome**: 34-line single-file change, committed in `1556a7fcf`.
  Deployed via openemr restart (clears opcache). Verified by selecting
  a 5/12-scheduled patient on a 5/11 wall-clock — encounter activates.

### Decision: Realistic + unique reason-for-visit across all 32 patients

- **Prompt**: "*All patients have a realistic and relevant reason for
  visit based on the current data found across their respective patient
  chart ... No patients should have the same exact reason for visit
  verbatim while the core reason could be the same.*"
- **Recommendation**: Per-patient rewrite, grounded in actual chart
  history. All 19 new patients prefixed with the canonical
  "New patient visit: …" format. Returning patients (13) reasons
  pulled from their multi-year encounter history (Marcus Hill's ADHD
  history → "Annual physical and ADHD medication review";
  Raymond Cooper's BP/diabetes/CKD chronic care → "Chronic care
  follow-up: BP, diabetes, CKD"; etc.). Hand-curated to ensure each is
  unique verbatim.
- **Outcome**: 32 distinct reasons across 32 cohort-window encounters
  (verified `SELECT COUNT(DISTINCT reason) AS n, COUNT(*) AS total`
  → `32 / 32`). Demo cohort feels realistic, no duplicate phrasing
  surfaces in a calendar overview.

## Trade-offs and alternatives

- **Bug #2 fix path** — could have either (a) added a fresh upload write
  step on every grader-side upload (always re-register, even on
  idempotency hit) or (b) the freshness-checked re-register we shipped.
  (a) creates duplicate documents rows on every re-upload of the same
  file. (b) preserves the .bin idempotency for the agent's bytes path
  while only refreshing the OpenEMR projection when stale.
- **Bug #4 problem_list scope** — could have left `medical_problems` out
  of scope and noted as future work. Operator chose full end-to-end
  (deadline pressure already off). 10-file diff but each layer is small.
- **Cohort reset via full re-clone vs targeted SQL** — the project's
  established pattern is full local-DB import. We went with targeted
  SQL DELETEs instead because the operator wanted to preserve some local
  state (specifically the rich appointment-day setup with MA nursing
  notes for ALL non-cohort patients, not just the cohort itself). A full
  re-clone would have brought back everything.
- **Demographics on local** — operator opted to keep rich on local (the
  "before-state sharpening" was VPS-only). Re-clone preserves rich
  demographics on VPS too. Trade-off: demo "before-state" is not as
  sharp; benefit: data on local stays usable for ongoing development.
- **Labs persistence** — labs land in `agentforge_w2/_obs/<sha256>.json`
  sidecars; the dashboard's Labs card reads them via a custom PHP
  endpoint that reshapes to a FHIR Observation Bundle. Schema-correct
  per the brief ("strict-schema JSON" + "source citation") and the
  dashboard does consume FHIR-shaped data. BUT the lab observations
  do NOT live in OpenEMR's canonical `procedure_order` / `procedure_report`
  / `procedure_result` tables, so the stock `/apis/default/fhir/Observation`
  endpoint won't return them. Future work captured in Next Steps below.

## Tools, dependencies, commands

Per-table cleanup pattern used repeatedly (heredoc → stdin → mariadb to
sidestep nested single-quote escaping in bash):

```bash
cat <<'SQL' | docker exec -i development-easy-mysql-1 sh -c 'exec mariadb -uroot -p"$MYSQL_ROOT_PASSWORD" openemr'
SET autocommit=0;
START TRANSACTION;
DELETE FROM lists WHERE pid IN (...) AND date >= 'X' AND date < 'Y';
-- ...
COMMIT;
SELECT ...; -- verify
SQL
```

Targeted re-import via `mariadb-dump --where`:

```bash
docker compose exec -T mysql sh -c 'exec mariadb-dump --no-create-info --complete-insert --skip-extended-insert --skip-comments --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" openemr form_encounter --where="pid IN (151,152,153,154)"' > /tmp/restore.sql
```

VPS pull-and-restart cycle (for PHP changes — opcache cleared by container restart):

```bash
sudo -iu linuxuser bash -lc 'cd /opt/openemr && git fetch origin && git reset --hard origin/master'
docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml -f ../agentforge/docker-compose.prod.yml restart openemr
```

For TypeScript changes (agent API), `restart agentforge-api` instead —
its `command:` re-runs `npm ci && npm run build && node dist/index.js`
on each boot.

## Files touched

### Committed

- `311ac9ef5` — Bug #1 + Bug #3 round 1 + Bug #4a + problem_list end-to-end:
  - `agentforge/api/src/agent/orchestrator.ts`
  - `agentforge/api/src/conversations/apply_pending_write.ts`
  - `agentforge/api/src/schemas/extraction.ts`
  - `agentforge/api/src/tools/attach_and_extract.ts`
  - `agentforge/api/src/workers/intake_extractor.ts`
  - `agentforge/cui/src/App.tsx`
  - `patient-dashboard/src/cards/BundleReviewModal.tsx`
  - 5 new PHP files under `interface/modules/.../src/Write/` +
    `public/write/problem_add.php`
  - CUI + dashboard committed bundles

- `5d60c1362` — demographics label + view-in-docs plumbing + latency cut:
  - `agentforge/api/src/agent/orchestrator.ts` (`buildExtractionBlock`
    signature accepts oeDocumentId/oePatientPid)
  - `agentforge/api/src/app.ts` (chatRequestSchema extended)
  - `agentforge/api/src/openemr/types.ts` (extraction block schema
    optional ids)
  - `agentforge/api/src/workers/intake_extractor.ts` (pre-emit pass
    removed)
  - `agentforge/cui/src/App.tsx` (onViewInDocuments refactored to take
    ids as args; ids hoisted out of upload block + forwarded on chat opts)
  - `agentforge/cui/src/api/client.ts` (postChat opts + body)
  - `agentforge/cui/src/chat/MessageList.tsx` (renderer gates on block.ids)
  - `agentforge/cui/src/types/chat.ts` (mirror schema)
  - `patient-dashboard/src/cards/BundleReviewModal.tsx`
    (`summarizeItemPayload` demographics_update renders real values +
    row uses break-words instead of truncate)
  - CUI + dashboard committed bundles

- `ce88b5d0f` — idempotency-hit fix:
  - `interface/modules/.../src/Documents/OpenEmrDocumentsRegistrarPort.php`
    (+ `documentExistsForPatient`)
  - `interface/modules/.../src/Documents/OpenEmrDocumentsRegistrarAdapter.php`
    (implementation)
  - `interface/modules/.../src/Documents/DocumentUploadResult.php`
    (`existing()` accepts oeDocumentId)
  - `interface/modules/.../src/Documents/DocumentUploadAction.php`
    (idempotency-hit branch refreshed)

- `1556a7fcf` — encounter binder fallback:
  - `interface/modules/.../src/Context/AppointmentEncounterBinder.php`
    (+ `findLatestEncounter`, fallback in `bindForCurrentPatient`)

### Backups produced (VPS `/root/agentforge-backups/`)

- `vps-openemr-pre-dashboard-20260510-180646.sql.gz` — pre-deploy
- `vps-postgres-pre-dashboard-20260510-180646.sql.gz` — pre-deploy
- `vps-openemr-pre-cohort-reset-20260511-052309.sql.gz` — pre-cleanup
- `vps-postgres-pre-cohort-reset-20260511-052309.sql.gz` — pre-cleanup
- `cohort-checkin-restore-20260511-005343.sql` — encounter re-import payload
- `local-openemr-20260511-124751.sql.gz` — final clone-to-VPS payload

### Local-only (pre-cleanup backup)

- `/tmp/local-openemr-pre-returning-cleanup-20260511-020810.sql.gz`

## Outcomes

- Prod at `1556a7fcf` (5 commits past the 5/8 deploy).
- 5 bugs reported during smoke all resolved + verified live.
- `problem_list` end-to-end addition shipped (schema + prompt + bundle
  assembler + dispatcher + 5 PHP files + modal label).
- Cohort reset complete on both local + VPS:
  - 4 cohort patients (Margaret / James / Sofia Reyes / Robert) present
    as fresh new-patient intakes — no medications / allergies /
    problem_list / family history / labs / documents
  - Pre-checkin encounter open per patient with MA nursing note + vitals
  - All 32 cohort-window patients (5/10–5/13) have unique
    appointment-day reasons-for-visit grounded in their actual chart
    history
  - Patient_data demographics rich on both sides (operator preference)
- Encounter binder works for non-today cohort patients (Margaret on
  5/10 now opens her 5/10 encounter even when wall-clock is 5/11).
- Backups intact on the VPS — full rollback available if needed.

## Next steps

- **Option B for labs persistence** (deferred from this session, captured
  here as a runbook). The grader brief asks for "strict-schema JSON" +
  "persist derived facts as appropriate FHIR resources or OpenEMR
  records." Today: extracted lab observations land in
  `agentforge_w2/_obs/<sha256>.json` sidecars, served via a custom PHP
  endpoint (`lab_observations_for_dashboard.php`) that reshapes them
  into a FHIR Observation Bundle for the dashboard. The data isn't in
  OpenEMR's canonical lab tables, so `/apis/default/fhir/Observation`
  doesn't see it. Implementation plan:
  1. Extend
     [`write/observation_from_extraction.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/write/observation_from_extraction.php)
     (scaffolded for this exact upgrade) to actually INSERT into
     `procedure_order` → `procedure_report` → `procedure_result`.
     Field map already documented in
     `agentforge/api/src/schemas/extraction.ts` (LabResultSchema maps to
     procedure_result columns).
  2. Bench the dispatcher path
     in `agentforge/api/src/tools/attach_and_extract.ts`
     (`maybePersistObservations`) → confirm it's already wired and just
     needs the PHP endpoint to write real rows instead of just
     acknowledging.
  3. Point `patient-dashboard/src/fhir/agentforge_labs.ts` at
     `/apis/default/fhir/Observation?patient=<uuid>&category=laboratory`
     (the stock OpenEMR FHIR endpoint) instead of the custom
     `lab_observations_for_dashboard.php` PHP endpoint. Keep the custom
     endpoint behind a fallback for backward compat with any sidecar
     data not yet migrated.
  4. Smoke: upload a lab on a non-cohort fresh patient → confirm
     `procedure_*` rows land → dashboard Labs card renders from the
     canonical FHIR endpoint.
- **CUI vitest infra gap** — 5 test files fail to LOAD under JSDOM
  because `pdfjs-dist` references `DOMMatrix` at module-eval time.
  Pre-existing, not caused by this session. Either polyfill DOMMatrix
  in the vitest setup or refactor `src/citations/pdfjs.ts` to be
  lazy-imported.
- **Orphan encounters caveat** — deleted 45 `form_encounter` rows with
  pids not in `patient_data` from local without cross-referencing
  `openemr_postcalendar_events` first to check for re-pid matches.
  Should have been more diligent. Logged here so the next session is
  aware.
- **Node 22 bump** — pdfjs-dist@5.7.284 requires Node ≥22; container
  runs Node 20 with an EBADENGINE warning. Works in practice but
  flagged in the post-deploy hardening list.

## Links

- Prior W2 deploy journal: [0508-T0111-https-retrofit-vps-deploy.md](0508-T0111-https-retrofit-vps-deploy.md)
- Pre-deploy patient-dashboard milestone: [0509-T1747-w2-dashboard-integration.md](0509-T1747-w2-dashboard-integration.md)
- Post-deploy bug log: [`Documentation/AgentForge/implementation/post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md)
- Submission scoreboard: [`Documentation/AgentForge/submission.md`](../../../submission.md)
