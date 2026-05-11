---
date: 2026-05-11
topic: W2 prod deploy + 5 post-deploy bug fixes + cohort reset for grader demo
related_milestone: process/milestones/week-3/01-prod-deploy-and-cohort-reset.md
---

# W2 deploy, bug triage, cohort reset — session journal

## Goal

Operator opened with "*okay we are good to begin our VPS deploy*". Bring
the VPS forward from the 5/8 tip (`3456a4e42`) to master carrying the
W2 patient-dashboard work + W2 final polish; then triage whatever the
browser smoke surfaced; then reset the 4-cohort patients on prod to a
fresh new-patient-intake state so graders walk into a clean demo
without test data baked in.

## Context

12 commits accumulated on master since the 5/8 HTTPS retrofit
([0508-T0111](../week-2/0508-T0111-https-retrofit-vps-deploy.md)). Notable additions: the patient-dashboard React app
(`f9441da9e` + `8fc62555b` + `8716faf6a`), hybrid allergy modal +
LLM judge (`80fbfb5c7`), CUI uploads → OpenEMR Documents (`5f62e0dce`),
affordance + queue iteration (`53cb5db69`), citation-bbox + ADODB stdout
fix (`d54201517`). Session ran from late 5/10 CT through early 5/11 CT
— rolled into week-3 territory.

## Key decisions

### Decision: Deploy `d54201517` via the established runbook + restart agentforge-api explicitly

- **Prompt:** "*okay we are good to begin our VPS deploy*"
- **Recommendation:** Standard sequence from
  [0506-T1650](../week-2/0506-T1650-w2-prod-deploy-and-cui-fix.md) + 0508-T0111 — backups → git fetch/reset (no `clean -fd`,
  preserves Caddyfile symlink) → `up -d --build` → restart agentforge-api
  → smoke. The pre-flight host `npm run build` rule from the
  [feedback memory](../../../../../.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/feedback_npm_run_build_before_deploy.md)
  stays. Critical wrinkle: compose's `up -d` did NOT recreate
  agentforge-api (no service-definition change), so the running process
  kept executing the prior `dist/` even after `git reset` updated the
  bind-mounted source. Explicit `docker compose restart agentforge-api`
  re-triggers `npm ci && npm run build && node dist/index.js`.
- **Outcome:** Prod at `d54201517`. /health green. Documented the
  agentforge-api restart caveat in the milestone for the next deploy.

### Decision: Bug #3 — three rounds; the actual root cause was idempotency-hit returning null `oe_document_id`

- **Prompt:** "*the bug with the view in documents text link is not fixed.
  in fact, the link is completely stale when i click it*"
- **Recommendation:** Round 1 (commit `311ac9ef5`) dropped the bbox-modal
  fallback. Round 2 (`5d60c1362`) plumbed `oe_document_id` + `oe_patient_pid`
  through the chat call body → server schema → orchestrator → extraction
  block so the click handler doesn't depend on `messages.find`. Link
  still hidden after round 2. Round 3 found the actual cause: every
  re-upload was hitting idempotency at `agentforge_w2/`, and
  `DocumentUploadResult::existing()` hardcoded `oeDocumentId = null`.
  Worse, the morning DB clone had wiped the documents row that the
  sidecar's stored id used to point to — so even returning the cached id
  would 404. Fix: on idempotency hit, look up the sidecar's stored id,
  verify the row still exists via a new `documentExistsForPatient()`
  port method, and re-register if stale. Idempotency at the `.bin`
  level preserved; the OpenEMR projection refreshes when stale.
- **Outcome:** Shipped in `ce88b5d0f` (4-file PHP change at
  [src/Documents/](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/)). Verified live on a non-cohort fresh patient: link
  visible, click navigated to document, content viewable. This fix also
  papers over the workflow gap that the local-→-VPS DB clone carries
  metadata rows but not the underlying `/<pid>/<uuid>` filesystem bytes.

### Decision: Bug #4 — schema gap, not extraction quality. Add `problem_list` end-to-end + drop the pre-emit pass

- **Prompt:** "*[Sofia Reyes' intake form] has listed medical problems
  ... not being surfaced in the bundle pop-up*"
- **Recommendation:** Two-part fix. (a) Tighten the prompt with a
  Demographics completeness rule (phone/email/address-parts/occupation
  enumerated explicitly) so the model captures the dense contact block
  consistently. (b) Add `medical_problem` end-to-end — `IntakeProblemSchema`
  + prompt section + bundle assembler iterator + dispatcher `'problem_add'`
  target + 5 new PHP files (Port / Adapter / Payload / Action / HTTP
  entry) writing to `lists.type='medical_problem'` + `BundleReviewModal`
  label renderer. Once landed, dropped the earlier "pre-emit completeness
  pass" the prompt added because the operator confirmed the real cause
  was the schema gap, not model under-reach — reverting it cut perceived
  latency materially.
- **Outcome:** Shipped in `311ac9ef5`. Live verified — Medical Problems
  section appears in the bundle modal for Sofia Reyes, Confirm All
  writes to chart, extraction noticeably faster on the second smoke pass.

### Decision: Cohort reset workflow — DB-clone refresh doesn't carry document files; pre-checkin encounters need separate preserve/restore

- **Prompt:** "*we need to reset the database on these four patients
  back to their new patient intake status*"
- **Recommendation:** Five-phase reset: (1) backup, (2) chart-data wipe
  scoped to `pid IN (151,152,153,154)`, (2b) sharper demographics on VPS,
  (3) postgres `pending_proposals` delete for cohort UUIDs, (4)
  filesystem sidecar wipe (`agentforge_w2/{*.bin,*.json,_obs/*.json}`).
  Discovered mid-reset that Phase 2's `form_encounter` delete also wiped
  the pre-checkin encounters Jason had seeded locally for the realistic
  "patient checked in, MA recorded vitals + reason" demo journey.
  Recovery: targeted `mariadb-dump --where="pid IN (...)"` from local
  for form_encounter / forms / form_vitals / form_clinical_notes
  (nursing_note only) → scp → import. Encounter IDs 958-961 were free
  on VPS post-delete so explicit-id INSERTs landed without conflict.
- **Outcome:** Cohort reset clean on both sides. Surfaced the workflow
  caveat: **the local-→-VPS DB clone copies `documents` metadata rows
  but NOT the underlying `/sites/.../documents/<pid>/<uuid>` filesystem
  bytes** — orphan rows look like uploads but show blank on view.
  Documented; the `ce88b5d0f` idempotency-hit fix is the durable
  counterpart so re-uploads naturally re-register fresh.

### Decision: Encounter binder fallback for non-today cohort patients

- **Prompt:** "*only patients scheduled on 5/11 have this working like
  expected ... make them all active regardless of appointment date for
  the sake of our demo*"
- **Recommendation:**
  [`AppointmentEncounterBinder::bindForCurrentPatient`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php)
  resolved a target date from the appointment-context or today, then
  matched `DATE(fe.date) = $targetDate`. Multi-day demo cohort
  (5/10-5/13) broke this — only patients scheduled "today" auto-opened
  their MA-prep encounter. Surgical add: a final `findLatestEncounter()`
  fallback that runs after both the tracker-linked and same-day lookups
  miss. Production paths preserved; only the "no match anywhere" branch
  now resolves to "queue the latest encounter you have".
- **Outcome:** Shipped in `1556a7fcf` (34-line single-file change).
  Verified by opening a 5/12-scheduled patient on a 5/11 wall-clock —
  encounter activated.

### Decision: Realistic + unique reason-for-visit across all 32 cohort-window patients

- **Prompt:** "*all patients have a realistic and relevant reason for
  visit based on the current data found across their respective patient
  chart ... no patients should have the same exact reason for visit
  verbatim*"
- **Recommendation:** Hand-curate one reason per patient grounded in
  their actual chart history. All 19 new patients prefixed with
  canonical "New patient visit: …" format. 13 returning patients reasons
  pulled from their multi-year encounter trail (Marcus Hill's ADHD
  history → "Annual physical and ADHD medication review";
  Raymond Cooper's BP/diabetes/CKD chronic care → "Chronic care
  follow-up: BP, diabetes, CKD"). Margaret + Robert agent-test data on
  local cleared in the same pass for cohort parity (3 allergies + 4
  meds + 2 docs + family history + lab summary + 5 `_obs/` lab sidecars
  for Margaret; the lab-summary progress note for Robert).
- **Outcome:** `SELECT COUNT(DISTINCT reason), COUNT(*)` for the
  5/10-5/13 window returns `32, 32`. Demo cohort coherent +
  non-repetitive in calendar overviews.

## Trade-offs and alternatives

- **Bug #2 fix path** — always-re-register on every upload (simpler,
  but accumulates duplicate documents rows for any re-upload) vs the
  freshness-checked re-register we shipped (preserves .bin idempotency
  while refreshing the OpenEMR projection only when stale).
- **Cohort reset via full re-clone vs targeted SQL** — chose targeted
  to preserve the non-cohort patients' rich appointment-day setup
  (MA nursing notes + vitals) that a full re-clone would have brought
  back wholesale alongside the agent-test data we wanted out.
- **Demographics on local** — kept rich on operator preference; only
  VPS-side got the sharper before-state in the original reset (then
  the local-→-VPS clone propagated the rich state back to VPS in the
  final step).
- **Labs persistence (deferred — Option B)** — labs currently land in
  `agentforge_w2/_obs/<sha256>.json` sidecars; dashboard reads via a
  custom PHP endpoint that reshapes them into a FHIR Observation
  Bundle. Schema-correct per the brief but not in OpenEMR's canonical
  `procedure_*` tables; the stock `/apis/default/fhir/Observation`
  endpoint won't return them. Captured as concrete Next-Step work.

## Tools, dependencies, commands

Heredoc-into-stdin pattern repeated throughout (avoids nested
single-quote escaping in bash):

```bash
cat <<'SQL' | docker exec -i development-easy-mysql-1 sh -c 'exec mariadb -uroot -p"$MYSQL_ROOT_PASSWORD" openemr'
SET autocommit=0; START TRANSACTION;
DELETE FROM lists WHERE pid IN (...) AND date >= 'X' AND date < 'Y';
-- ...
COMMIT;
SQL
```

Targeted-restore via `mariadb-dump --where`:

```bash
docker compose exec -T mysql sh -c 'exec mariadb-dump --no-create-info --complete-insert --skip-extended-insert --skip-comments --no-tablespaces -uroot -p"$MYSQL_ROOT_PASSWORD" openemr form_encounter --where="pid IN (151,152,153,154)"' > /tmp/restore.sql
```

VPS PHP-change deploy cycle:

```bash
sudo -iu linuxuser bash -lc 'cd /opt/openemr && git fetch origin && git reset --hard origin/master'
docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml -f ../agentforge/docker-compose.prod.yml restart openemr
```

For TS-change deploys, `restart agentforge-api` instead (its `command:`
re-runs `npm ci && npm run build && node dist/index.js` on each boot).

## Files touched

- **Created:**
  - `interface/modules/custom_modules/oe-module-agentforge/public/write/problem_add.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Write/{MedicalProblemAddAction,MedicalProblemAddPayload,OpenEmrPatientMedicalProblemAdapter,PatientMedicalProblemWritePort}.php`
- **Modified — agent API:**
  - `agentforge/api/src/agent/orchestrator.ts`
  - `agentforge/api/src/conversations/apply_pending_write.ts`
  - `agentforge/api/src/schemas/extraction.ts`
  - `agentforge/api/src/tools/attach_and_extract.ts`
  - `agentforge/api/src/workers/intake_extractor.ts`
  - `agentforge/api/src/app.ts`
  - `agentforge/api/src/openemr/types.ts`
- **Modified — CUI:**
  - `agentforge/cui/src/App.tsx`
  - `agentforge/cui/src/api/client.ts`
  - `agentforge/cui/src/chat/MessageList.tsx`
  - `agentforge/cui/src/types/chat.ts`
- **Modified — dashboard:**
  - `patient-dashboard/src/cards/BundleReviewModal.tsx`
- **Modified — module PHP:**
  - `interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/{DocumentUploadAction,DocumentUploadResult,OpenEmrDocumentsRegistrarAdapter,OpenEmrDocumentsRegistrarPort}.php`
- **Built dist (committed):**
  - `interface/modules/custom_modules/oe-module-agentforge/public/{cui,dashboard}/`
- **Local DB only (not in git):**
  - Cohort reset SQL + Margaret/Robert lab cleanup + 32 reasons-for-visit UPDATEs
  - Backups: `/tmp/local-openemr-pre-returning-cleanup-20260511-020810.sql.gz`,
    `/tmp/local-openemr-20260511-124751.sql.gz`
- **VPS only (in `/root/agentforge-backups/`):**
  - `vps-openemr-pre-cohort-reset-20260511-052309.sql.gz`,
    `vps-postgres-pre-cohort-reset-20260511-052309.sql.gz`,
    `cohort-checkin-restore-20260511-005343.sql`,
    `local-openemr-20260511-124751.sql.gz`

### Commits landed

```
311ac9ef5  feat(agentforge): post-deploy bug fixes + problem_list intake section
5d60c1362  fix(agentforge): demographics label values + view-in-docs plumbing + latency cut
ce88b5d0f  fix(agentforge): idempotency-hit returns valid oe_document_id
1556a7fcf  fix(agentforge): bind latest encounter when no same-day match
47e415e07  docs(agentforge): journal — W2 deploy, bug triage, cohort reset (week-2)  ← reverted, see milestone
```

(Pushed to both `gitlab/master` and `origin/master`.)

## Outcomes

- Prod at `1556a7fcf` (5 commits past 5/8). All five reported smoke bugs
  resolved + verified live.
- `problem_list` end-to-end is now a real write target through the
  intake-bundle flow.
- Cohort (Margaret / James / Sofia Reyes / Robert) present as fresh
  new-patient intakes on both local and prod, with the realistic MA
  pre-checkin encounter open and unique reasons-for-visit.
- All 32 cohort-window patients have realistic + unique reasons grounded
  in chart history.
- Encounter binder works across the multi-day cohort (5/10-5/13).
- Two architectural caveats documented: (a) DB clone doesn't carry
  document filesystem bytes — orphan-row workflow gap, mitigated by
  the idempotency-hit re-register fix; (b) labs persist to a sidecar
  read-surface, not to OpenEMR's canonical `procedure_*` tables —
  Option B follow-up captured below.

## Next steps

- [ ] **Option B (labs into procedure_***)*** — extend the scaffolded
      [`write/observation_from_extraction.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/write/observation_from_extraction.php)
      to INSERT into `procedure_order` → `procedure_report` →
      `procedure_result`. Schema map already in
      [`agentforge/api/src/schemas/extraction.ts`](../../../../../agentforge/api/src/schemas/extraction.ts).
      Point [`patient-dashboard/src/fhir/agentforge_labs.ts`](../../../../../patient-dashboard/src/fhir/agentforge_labs.ts)
      at `/apis/default/fhir/Observation` instead of the custom PHP
      endpoint. Smoke: fresh lab upload → `procedure_*` rows land →
      dashboard Labs card renders from the canonical FHIR endpoint.
- [ ] **CUI vitest infra gap** — 5 test files fail to LOAD under JSDOM
      because `pdfjs-dist` references `DOMMatrix` at module-eval time.
      Polyfill in vitest setup or lazy-import `src/citations/pdfjs.ts`.
- [ ] **Orphan-encounter cleanup caveat** — I deleted 45 form_encounter
      rows with orphan pids from local without first cross-referencing
      `openemr_postcalendar_events` for re-pid matches. Operator flagged.
      For future cleanups: check the calendar table first.
- [ ] **Node 22 bump** — pdfjs-dist@5.7.284 requires Node ≥22; container
      runs Node 20 with an EBADENGINE warning at every boot.

## Links

- Numbered milestone: [process/milestones/week-3/01-prod-deploy-and-cohort-reset.md](../../milestones/week-3/01-prod-deploy-and-cohort-reset.md)
- Predecessor deploy journal: [process/journal/week-2/0508-T0111-https-retrofit-vps-deploy.md](../week-2/0508-T0111-https-retrofit-vps-deploy.md)
- Predecessor dashboard integration: [process/journal/week-2/0509-T1747-w2-dashboard-integration.md](../week-2/0509-T1747-w2-dashboard-integration.md)
- Submission scoreboard: [Documentation/AgentForge/submission.md](../../../submission.md)
