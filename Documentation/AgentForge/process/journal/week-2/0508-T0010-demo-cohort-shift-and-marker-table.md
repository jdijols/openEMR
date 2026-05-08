---
date: 2026-05-08
topic: Demo cohort shift to Sat–Tue, pubpid renumber, sidecar marker table, Margaret reset
related_milestone: none
---

# Demo cohort shift and marker table — session journal

## Goal

Move the local demo data forward one more time so graders opening the deployed app this weekend see fresh appointments. Specifically: shift the four-day demo window from Sun–Wed (5/10–5/13) to Sat–Tue (5/9–5/12), put the four W2 multimodal-orchestrator test patients (Chen, Whitaker, Reyes, Kowalski) on Saturday as 30-min new-patient slots, and clean up two pre-existing data-hygiene issues that surfaced along the way (pubpid collision and a `genericname1`/`genericval1` leak into the OpenEMR demographics UI).

## Context

The previous shift (G2-Final-71) had only changed `DEMO_WEEKDAY_DATES` in `seed_appointments.php` and never been applied to the local DB — the actual rows were still on 5/01–5/04. seed_visit_intake.php had also never been updated for the prior move (still pointed at 5/01–5/04 with `EXPECTED_DEMO_PATIENT_COUNT=28`). All four W2 cohort patients had stale pubpids (0014–0017) that collided with the first four AF-SCHEDULED patients, and Margaret Chen's chart had accumulated extractor/retriever test artifacts (21 extra `lists` rows from three duplicate extraction runs plus a physician progress-note with the lipid-panel summary).

## Key decisions

### Decision: Saturday is a normal-mix clinic day, not a W2-only day

- **Prompt:** "Saturday should have 11 appointments: 7 that were previously loaded before this week plus the 4 new patients. Sunday, Monday, and Tuesday will have 7 patients. … realistic doctor's schedule, more or less, with some back-to-back blocks."
- **Recommendation:** Replace the four day-rotating templates with four day-specific templates: Sat=11 slots (8 new + 3 established) with the four W2 cohort patients in the first four 30-min slots back-to-back, then a small mid-morning established cluster, then more new-patient blocks. Sun/Mon/Tue stay at 7 slots each. To guarantee the four W2 patients land in those first four Saturday slots, change the new-patient pool ordering from `array_merge($scheduledPatients, $w2CohortPatients)` to `array_merge($w2CohortPatients, $scheduledPatients)`.
- **Outcome:** New templates and pool order shipped in [contrib/util/agentforge/seed_appointments.php:109](../../../../../contrib/util/agentforge/seed_appointments.php) and [contrib/util/agentforge/seed_appointments.php:730](../../../../../contrib/util/agentforge/seed_appointments.php). Seeder verified: Sat 11 / Sun 7 / Mon 7 / Tue 7 = 32 total, with Chen/Whitaker/Reyes/Kowalski at 08:00–10:00 in 30-min blocks.

### Decision: Fix latent UUID-binary bug exposed by re-running visit intake

- **Prompt:** Visit-intake seeder run failed mid-way: "encounter for pid 85 on 2026-05-10 failed: … Patient UUID is invalid"
- **Recommendation:** The helper `patientUuidString` decided "this looks like a string UUID" via `str_contains($raw, '-')`. Maya Rivers's binary UUID happens to contain byte `0x2D` (ASCII `-`), so the helper returned the raw 16-byte blob and the validator rejected it. Switch to a length-based check (string-form UUIDs are exactly 36 chars).
- **Outcome:** Fix in [contrib/util/agentforge/seed_visit_intake.php:621](../../../../../contrib/util/agentforge/seed_visit_intake.php). Pre-existing bug that only triggers when a cohort patient happens to draw a UUID containing `0x2D` — now deterministic.

### Decision: Restore original pubpid layout with a +18 special case for W2

- **Prompt:** "Regarding the pre-existing flag, we should change the IDs of our new patients. … The four new patients … should have ID numbers 29, 30, 31, and 32 in four-digit formatting … so we don't have this duplication problem."
- **Recommendation:** Change `seed_cohort.php`'s `externalIdFor()` from a single `cohortNumber + 3` formula to a special case: cohortNumber ≥ 11 maps with `+ 18` (so AF-COHORT-011..014 → 0029..0032) while W1 keeps `+ 3`. This restores the original pubpid layout documented in the W1 demo-data-vps-mirror journal (stock 0001–0003, W1 0004–0013, scheduled 0014–0028, W2 0029–0032).
- **Outcome:** [contrib/util/agentforge/seed_cohort.php:857](../../../../../contrib/util/agentforge/seed_cohort.php). Verified 32 unique pubpids, no collisions, W2 reset rebuilds the cohort patients with empty charts via the existing `clearExistingCohort` → `seedPatient` cycle.

### Decision: Move AgentForge identification into a sidecar table to stop polluting the demographics UI

- **Prompt:** Screenshots showing OpenEMR's "User Defined" line rendering "AgentForge Scheduled Patient ID  AF-SCHEDULED-003" and "AgentForge Cohort ID  AF-COHORT-011". "Nothing related to AgentForge and our internal identifications should populate on the user-facing application … just left blank."
- **Recommendation:** OpenEMR's demographics widget renders `patient_data.genericname1`/`genericval1`. Stop writing the AgentForge marker there; introduce a sidecar table `agentforge_demo_patient_markers (pid, marker_kind, marker_label)` for identification. All three seeders create the table idempotently (CREATE TABLE IF NOT EXISTS), write to it on insert, query it for cleanup/lookups, and keep a legacy fallback that also picks up rows still carrying markers in `genericname1`/`genericval1` so the first re-seed after this migration cleans both surfaces.
- **Outcome:** New table + writes/reads wired into all three seeders. Verified: 14 cohort + 15 scheduled marker rows, all 32 demo patients show blank `genericname1`/`genericval1`, demographics widget will render the empty "User Defined" line that matches stock OpenEMR patients. Files: [contrib/util/agentforge/seed_cohort.php](../../../../../contrib/util/agentforge/seed_cohort.php), [contrib/util/agentforge/seed_appointments.php](../../../../../contrib/util/agentforge/seed_appointments.php), [contrib/util/agentforge/seed_visit_intake.php](../../../../../contrib/util/agentforge/seed_visit_intake.php).

### Decision: Reset Margaret with targeted SQL, not a full re-seed

- **Prompt:** "Can you please reset Margaret Chen's data to new patient intake? I was testing extraction and retrieval workers, and now that I'm done, I want to have fresh new patient data for Margaret …"
- **Recommendation:** A full re-seed would shift every PID across the demo. Diff Margaret's chart against an AF-SCHEDULED baseline (Avery Wells) instead and target only the divergences — 21 extra `lists` rows (three duplicate extraction runs of allergies + meds at 04:29 / 04:49 / 04:52 today) and one extra `form_clinical_notes` row (the physician progress-note with the lipid panel summary). Targeted DELETEs preserve her stable PID, the Saturday appointment, and the seed_visit_intake intake encounter + MA nursing note + vitals.
- **Outcome:** Three statements via mariadb (delete `lists_medication` joined to her lists, delete `lists` for pid=151, delete `form_clinical_notes` for pid=151 with `clinical_notes_type='progress_note'`). Margaret's chart now matches the AF-SCHEDULED baseline exactly (0 lists / 0 documents / 0 procedure_orders / 0 prescriptions / 1 form_encounter / 1 form_vitals / 1 form_clinical_notes / 3 forms / 1 history_data).

## Trade-offs and alternatives

- **Saturday W2-only day** (4 appointments total) — rejected: would have made the calendar look sparse; redistributed Saturday's 7 non-W2 patients across Sun/Mon/Tue made the other days lopsided. The mixed Saturday is more demo-realistic.
- **Drop genericname1/val1 markers and identify by pubpid range** — considered as a simpler alternative to the sidecar table. Rejected because pubpid ranges are brittle: any future change to cohort/scheduled counts shifts the ranges and silently breaks queries. The sidecar table is explicit and survives counts changing.
- **Full re-seed for Margaret reset** — rejected because (a) it shifts every PID, (b) it re-runs encounter creation for 32 patients to clean one chart, and (c) the diff was small (22 rows) and surgical.

## Tools, dependencies, commands

- Seeders re-run several times during the session; canonical run order remains:
  ```bash
  docker compose -f docker/development-easy/docker-compose.yml exec openemr \
    php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_cohort.php
  docker compose -f docker/development-easy/docker-compose.yml exec openemr \
    php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_appointments.php
  docker compose -f docker/development-easy/docker-compose.yml exec openemr \
    php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_visit_intake.php
  ```
- Margaret targeted reset (one-off, baseline already cleared on local DB):
  ```sql
  DELETE lm FROM lists_medication lm JOIN lists l ON l.id = lm.list_id WHERE l.pid = 151;
  DELETE FROM lists WHERE pid = 151;
  DELETE FROM form_clinical_notes WHERE pid = 151 AND clinical_notes_type = 'progress_note';
  ```
- New DB object created by the seeders on first run: table `agentforge_demo_patient_markers (pid PK, marker_kind, marker_label)` — InnoDB, utf8mb4. Idempotent via CREATE TABLE IF NOT EXISTS in all three seeders.

## Files touched

- **Modified:** [contrib/util/agentforge/seed_appointments.php](../../../../../contrib/util/agentforge/seed_appointments.php) — DEMO_WEEKDAY_DATES 5/10–13 → 5/9–12, four day-specific templates (Sat 11 / Sun-Mon-Tue 7 each), W2 cohort moved to front of new-patient pool, manifest prose, demo-marker constants + ensureDemoMarkerTable + insertDemoMarker helpers, clearExistingSeed reads marker table with legacy fallback, createScheduledPatients no longer writes genericname1/val1, loadCohortPatients reads from marker table.
- **Modified:** [contrib/util/agentforge/seed_visit_intake.php](../../../../../contrib/util/agentforge/seed_visit_intake.php) — DEMO_WEEKDAY_DATES synced to 5/9–12, EXPECTED_DEMO_PATIENT_COUNT 28 → 32, LEGACY_DELETE range expanded to 5/01–5/13, length-based UUID-string detection in patientUuidString, ensureDemoMarkerTable defensive create, loadDemoPatientIds reads marker table with legacy fallback.
- **Modified:** [contrib/util/agentforge/seed_cohort.php](../../../../../contrib/util/agentforge/seed_cohort.php) — externalIdFor special-cases cohortNumber ≥ 11 (W2) to map to pubpid 0029–0032, demo-marker constants + ensureDemoMarkerTable + insertDemoMarker helpers, clearExistingCohort reads marker table with legacy fallback + deletes from marker table, createPatient no longer writes genericname1/val1, sanity queries (printed + written to roster.md) updated to use marker table.
- **Regenerated by seeders (auto-output):** [Documentation/AgentForge/cohort/appointments.md](../../../cohort/appointments.md), [Documentation/AgentForge/cohort/roster.md](../../../cohort/roster.md).

## Outcomes

- Local DB demo window is now Sat 2026-05-09 through Tue 2026-05-12, with 11 appointments on Saturday (the four W2 cohort patients in 30-min back-to-back morning slots) and 7 each on Sun/Mon/Tue (32 total).
- Pubpid layout is unique and matches the original W1 design intent: stock 0001–0003, W1 cohort 0004–0013, AF-SCHEDULED 0014–0028, W2 cohort 0029–0032.
- AgentForge identification now lives in a sidecar table `agentforge_demo_patient_markers`; the OpenEMR demographics widget shows a blank "User Defined" line for all 32 demo patients — matching the stock-patient look.
- Margaret Chen's chart is back to the empty new-patient baseline; she is ready for a fresh extractor/retriever run before the prod deploy.
- Pre-existing UUID-binary bug in `patientUuidString` is fixed; visit-intake re-runs are no longer dependent on which UUID bytes a cohort patient happens to draw.

## Next steps

- [ ] Commit the three seeder edits (and let the user decide commit boundaries — appointment shift / pubpid renumber / marker table / UUID fix could be one commit or four).
- [ ] When deploying to the VPS, the standard dump-and-import workflow carries everything (incl. the new `agentforge_demo_patient_markers` table) — no per-change SQL migration needed.
- [ ] Optional follow-up: drop the legacy `genericname1`/`genericval1` fallback queries from all three seeders once the prod DB has been re-imported from this clean local DB; legacy markers exist nowhere outside historical snapshots after that point.

## Links

- Prior cohort migration journal: [process/journal/week-2/0506-T1912-w2-write-tools-cut-and-final-writeups.md](./0506-T1912-w2-write-tools-cut-and-final-writeups.md) (G2-Final-71, the code-only shift to 5/10–13 that this session superseded).
- Original pubpid-layout intent: [process/journal/week-1/0429-T1844-demo-data-vps-mirror.md](../week-1/0429-T1844-demo-data-vps-mirror.md) ("Stock patients are normalized to 0001-0003, cohort patients to 0004-0013, and scheduled patients to 0014-0028").
