---
date: 2026-04-29
topic: Synthetic 10-patient cohort seeding (deep longitudinal records) + Visit Summary report bugfix
related_milestone: none (cohort work informs a future numbered milestone; bugfix is incidental)
---

# Cohort seed + Visit Summary fix — session journal

## Goal

Stand up a small but realistic patient cohort the AgentForge work can demo and (later) query: ~10 patients with deep, longitudinal charts spanning age-appropriate cadences and mixed provider continuity, layered on top of the existing 3-patient demo data without disturbing it. User framing: *"about ten or so patients … very deep data associated with each visit … be intentional about how we construct this medical record data."* Mid-session a UI failure surfaced — *"when I try to open an encounter, specifically encounter summaries or visit summary, it has a text underneath that says 'An error has occurred'"* — which had to be root-caused before the demo cohort was credible.

## Context

Stage 1 demo data path is `dev-reset-install-demodata` (3 patients, thin charts). [`AUDIT.md`](../../../../../AUDIT.md) `DataQuality-1` and `DataQuality-5` had already flagged the bundled demo data as too thin to support agent-context evaluation, and §6 Pre-Build Imperative #10 named "demo-data augmentation" as a Stage 4 input. No script existed to inject a richer synthetic cohort. Synthea was on the table from Stage 1 but was deferred — we wanted a curated, deterministic cohort first, since agent eval needs *known* clinical narratives to score against.

## Key decisions

### Decision: write mechanism — service layer first, targeted SQL where the service is a stub

- **Prompt:** *"We should be able to write a script or write directly to the database. I'm not sure exactly the correct way to go about this, but I want you to basically decide how that's done."*
- **Recommendation:** Use OpenEMR's PHP service layer (`PatientService::insert`, `EncounterService::insertEncounter`, `VitalsService::save`, `ClinicalNotesService::createClinicalNotesParentForm`/`saveArray`) for the primary entities so we get UUIDs, event dispatch, and validation for free. Fall back to direct SQL only for tables where the service is a stub or its insert path is overbuilt for our purposes (`lists`, `prescriptions`, `lists_medication`, `immunizations`, `procedure_order`/`_code`/`_report`/`_result`, `history_data`). Reasoning: services give us forward-compatibility with FHIR reads, but rewriting `ProcedureService::insert` is out of scope.
- **Outcome:** [`contrib/util/agentforge/seed_cohort.php`](../../../../../contrib/util/agentforge/seed_cohort.php) implements that hybrid; ~10 patients × ~5 visits each with vitals, clinical notes, problems, allergies, meds, prescriptions, labs, immunizations, and history.

### Decision: idempotency via `genericname1`/`genericval1` markers + `pubpid` cleanup

- **Recommendation:** Tag every cohort patient with `genericname1='AgentForge Cohort ID'` and `genericval1='AF-COHORT-00x'`. The cleanup pass deletes by those markers (and by `pubpid` for safety), then cascades manually across `form_encounter` / `forms` / `form_vitals` / `form_clinical_notes` / `lists` / `lists_medication` / `prescriptions` / `immunizations` / `procedure_*` / `history_data`. Required because the schema has effectively zero foreign keys (see [`AUDIT.md` Performance-6](../../../../../AUDIT.md)), so OpenEMR has no DB-level cascade to lean on.
- **Outcome:** Script can be re-run safely against a live DB without disturbing the 3 stock demo patients (pid 1–3). Verified by re-running and inspecting roster.

### Decision: hold scope — encounters only this round, defer scheduled appointments

- **Prompt:** *"The previous visits or encounters, I believe, are defined as those that have dates and times when those encounters happened … maybe we'll have a separate plan for future appointments."*
- **Recommendation:** `form_encounter` records past visits (date, provider, reason, category) and is what the Visit Summary, FHIR Encounter, and a future agent-context service will read. `openemr_postcalendar_events` is the separate scheduling table for upcoming appointments. Treat them as two different problems and finish the encounter cohort first. Future appointments — for both recurring and brand-new patients — are worth their own plan because they exercise the calendar UI and the patient-tracker flow, neither of which the cohort touches.
- **Outcome:** This session writes only `form_encounter` rows; no `openemr_postcalendar_events` scheduling. Logged as the obvious follow-up.

### Decision: UI realism — populate `phone_home`/`ss`, sequential numeric External IDs (4–13)

- **Prompt:** *"there are columns for home phone number and SSN. right now these are empty for our cohort patients … I'd like our External ID to be numbered 4-10 instead of the long string we have now."*
- **Recommendation:** Decouple the demo-facing identifier from the script's internal identifier. Set `pubpid` (the "External ID" the Finder shows) to a sequential numeric string starting at 4 (after the three demo patients), and synthesize `phone_home` and `ss` to deterministic but obviously-fake values. Keep `AF-COHORT-00x` alive as the script-internal handle in `genericname1`/`genericval1` for cleanup.
- **Outcome:** Finder displays the cohort like a real chart list; cleanup logic is unaffected because it keys on the marker columns, not `pubpid`.

### Decision: "An error has occurred" root cause — upstream OpenEMR bug, not seed data

- **Prompt:** *"the encounter summaries or visit summary … has a text underneath that says 'An error has occurred' … Did we not enter data for specific encounters?"* Then, after the AB test: *"I just did the quick AB test and opened a stock demo patient encounter, and they also have the text"*
- **Recommendation:** The phrase is OpenEMR's generic 500-page body in [`src/Core/ErrorHandler.php`](../../../../../src/Core/ErrorHandler.php), not a "missing data" message. The Visit Summary block is the rendered output of `formdir = newpatient`'s `report.php`. The PHP error log pinned the throw to `ParameterBag::getInt('inhouse_pharmacy', 0)` at [`interface/forms/newpatient/report.php:76`](../../../../../interface/forms/newpatient/report.php) — Symfony's `filter_var(false, FILTER_VALIDATE_INT)` rejects the boolean `false` that [`interface/globals.php`](../../../../../interface/globals.php) normalizes `inhouse_pharmacy` to. Affects every encounter on every patient. Introduced upstream by PR #11144 ("Hide dispensed medications section when inhouse_pharmacy is disabled").
- **Outcome:** Root cause documented, AB test confirms it is not cohort-specific, scope of fix is clear: one line in the report file.

### Decision: surgical patch — `getInt(...) === 1` → `getBoolean(...)` in `newpatient/report.php`

- **Prompt:** *"Be surgical with your patch not to break anything existing"*
- **Recommendation:** Replace the throwing `getInt` call with `getBoolean`. Considered three alternatives — wrap in try/catch, change `interface/globals.php` to store an int, raw `get()` + truthy check — and rejected each: try/catch hides the type mismatch, changing globals.php would cascade to every other call site (`usergroup_admin_add.php`, `user_admin.php`, `inventory_list.php`, `new.php`, `C_Prescription.class.php`) which all use the truthy pattern, and raw `get()` + cast violates the `CLAUDE.md` "Prefer typed getters over `get()` + cast" rule. `getBoolean` matches both the stored type and the project convention.
- **Outcome:** [`interface/forms/newpatient/report.php:82`](../../../../../interface/forms/newpatient/report.php) now uses `$globalsBag->getBoolean(...)`. Verified end-to-end via authenticated curl on the same patient/encounter the user screenshotted (Susan Underwood / encounter 8) and on a cohort patient (Olivia Tran / encounter 146): Visit Summary renders the category, reason for visit, and provider; zero new exceptions in the PHP error log post-patch.

## Trade-offs and alternatives

- **Use Synthea / `import-random-patients`** — rejected for now. Synthea generates volume but its narratives are not deterministic for an agent-eval setup; the curated cohort gives us *known* clinical content to score retrieval against. Synthea remains a future option for stress / load.
- **Implement `ImmunizationService::insert` and `ProcedureService::insert` instead of direct SQL** — rejected for scope. Both are real refactors; deferred to a future PR not gated on this cohort.
- **Promote this work to `process/milestones/week-1/10-cohort-seed.md`** — deferred. User asked to *document the chat*, not add the next milestone. The cohort + seed mechanism is durable enough to warrant a numbered file when the demo data flow is formally Stage 6 / Stage 7 work; this journal is the source-of-truth in the meantime.
- **Patch `interface/globals.php` to store `inhouse_pharmacy` as int** — rejected as the wrong end of the pipe. Every other reader expects truthy; only `newpatient/report.php` was the outlier.

## Tools, dependencies, commands

No new dependencies installed. Script runs inside the existing easy-dev container.

```bash
# Seed the cohort (idempotent; safe to re-run)
docker compose exec openemr php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_cohort.php

# Snapshot for reproducibility (each new run picks a new identifier)
docker compose exec openemr /root/devtools backup agentforge-cohort-vN

# Tail PHP error log when reproducing a UI failure
docker compose exec openemr /root/devtools php-log
```

## Files touched

- **Created:** [`contrib/util/agentforge/seed_cohort.php`](../../../../../contrib/util/agentforge/seed_cohort.php) — cohort seeder (services + targeted SQL, idempotent, generates roster on every run)
- **Created:** [`Documentation/AgentForge/cohort/roster.md`](../../../cohort/roster.md) — generated demo manifest with deep links + sanity SQL
- **Created:** `Documentation/AgentForge/process/journal/week-1/0429-T1744-cohort-seed-and-visit-summary-fix.md` (this entry)
- **Modified:** [`interface/forms/newpatient/report.php`](../../../../../interface/forms/newpatient/report.php) — one-line surgical fix (`getInt` → `getBoolean`) + 6-line explanatory comment

## Outcomes

- The deployed easy-dev stack now hosts 13 charts: 3 untouched demo patients (pid 1–3) + 10 AgentForge cohort patients (pid 4–13, External IDs 4–13, identifiable via `genericname1='AgentForge Cohort ID'`).
- Visit Summary renders cleanly across the entire app (stock + cohort), unblocking demo walkthroughs and any future agent-context flow that reads `form_encounter` / `forms` / FHIR `Encounter`.
- Process now has a reproducible cohort generator under version control — next runs of `dev-reset-install-demodata` can be followed immediately by `seed_cohort.php` to regenerate the demo state.

## Open threads preserved

- Future appointments (recurring patients + brand-new scheduled patients) on `openemr_postcalendar_events` — explicitly out of scope this session, kept as the next plan.
- Whether to send the `getInt` → `getBoolean` patch upstream as a PR. Cleanest fix, single line, consistent with every other reader; worth doing when we are next in a contribution mood.
- Synthea-backed bulk synthetic data for load/scale evaluation, layered alongside (not replacing) the curated cohort.

## Next steps

- [ ] Plan + script the appointments / scheduling layer (recurring cohort + brand-new patients with future visits) so the calendar/tracker UI is also demo-ready.
- [ ] Decide commit posture: this session leaves `seed_cohort.php`, `cohort/roster.md`, and the `report.php` patch uncommitted. The patch in particular is a clean isolated fix and a candidate for its own commit.
- [ ] If the cohort generator graduates from "session artifact" to "stage deliverable", lift the highlights into a new numbered file (e.g. `process/milestones/week-1/10-stage6-cohort-seeding.md` or similar).

## Links

- AUDIT cross-refs: [`AUDIT.md` DataQuality-1, DataQuality-5, §6 Pre-Build Imperative #10](../../../../../AUDIT.md)
- Stage 1 demo data context: [`process/milestones/week-1/04-stage1-local-dev-runbook.md`](../../milestones/week-1/04-stage1-local-dev-runbook.md)
- Upstream regression source: OpenEMR PR #11144 (introduced the `getInt(inhouse_pharmacy)` pattern)
