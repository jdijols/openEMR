---
date: 2026-05-02
topic: Open encounter binds to appointment day; automated brief vitals scoped to current encounter
related_milestone: process/17-encounter-scoped-chart-bind-and-brief.md
---

# Encounter-scoped chart binding and brief vitals — session journal

## Goal

When a clinician opens a patient **from a specific appointment day** (calendar or flow board), OpenEMR’s **open encounter**, AgentForge launch/JWT, and host chrome should align with **that visit’s date**, not the server’s literal “today.” Separately, the **automated case brief** must show vitals for the **current open encounter**, not vitals filtered by calendar “today,” and the section title should read **“Recorded most recently”** with copy that matches visit scope.

## Context

Prior `AppointmentEncounterBinder` logic anchored “same day” to `DateTimeImmutable('today')`, so opening a May 1 appointment while the clock said May 2 failed to bind/show the right encounter. The simplified three-section brief (`Recorded today`) matched vitals to `bundleForLlm.today`, causing the same class of bug in the rail UI.

## Key decisions

### Decision: Carry appointment context on chart navigation

- **Prompt:** “If the physician is opening a patient from a specific appointment day, … make that encounter … the current open encounter” regardless of system date; implement as discussed.
- **Recommendation:** Thread **`pc_eid`** and appointment date into `demographics.php` via query params, persist in session keys `agentforge_appointment_context_*`, and have the binder resolve tracker / same-day encounter / create path against **that** context (with **today** fallback when no context).
- **Outcome:** Calendar **`goPid`** (day/week/month), patient tracker **`topatient`**, and **`demographics.php`** (`af_appointment_id`, `af_appointment_date`) store context; [`AppointmentEncounterBinder`](../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php) consumes it.

### Decision: Encounter-first vitals in the brief

- **Prompt:** Rename “Recorded today” to “Recorded most recently”; pull vitals for the **current open encounter**, not literal today.
- **Recommendation:** Filter vitals by **`encounter_id`** (and date fallback when id missing); expose **`encounter_id`** from Context Service **`vitals.php`** so rows align with `form_encounter`; rename headings/empty strings; extend prior-visit vitals input to the same encounter/date rule.
- **Outcome:** [`case_presentation_format.ts`](../../../../agentforge/api/src/agent/case_presentation_format.ts); [`vitals.php`](../../../../interface/modules/custom_modules/oe-module-agentforge/public/context/vitals.php); Vitest in [`case_presentation.test.ts`](../../../../agentforge/api/test/agent/case_presentation.test.ts).

### Decision: Tracker-linked encounter lookup by appointment

- **Prompt:** (Implied from binder design) Prefer precise match when **`pc_eid`** + date/time are known.
- **Recommendation:** Add **`findTrackerLinkedEncounterForAppointment`** joining `patient_tracker` on **`eid`**, **`apptdate`**, **`appttime`** before falling back to date-only tracker query.
- **Outcome:** Implemented in [`AppointmentEncounterBinder.php`](../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php).

## Trade-offs and alternatives

- **Infer “last appointment” without URL/session context** — Rejected: ambiguous when multiple visits exist; requires explicit click context.
- **Brief vitals by encounter date only (no `encounter_id` on API)** — Rejected for primary path: same calendar day could host multiple encounters; **`encounter_id`** on vitals rows is the reliable join.

## Tools, dependencies, commands

- `composer phpunit-isolated -- --filter 'AppointmentEncounterBinderStaticStructureTest|RailContainerStaticStructureTest'` (host; appointment binding guards).
- `cd agentforge/api && npm test -- --run test/agent/case_presentation.test.ts` (brief + vitals logic).
- `php -l` on touched PHP endpoints.

## Files touched

- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php`
- **Modified:** `interface/patient_file/summary/demographics.php`
- **Modified:** `interface/main/calendar/modules/PostCalendar/pntemplates/default/views/day/ajax_template.html`
- **Modified:** `interface/main/calendar/modules/PostCalendar/pntemplates/default/views/week/ajax_template.html`
- **Modified:** `interface/main/calendar/modules/PostCalendar/pntemplates/default/views/month/ajax_template.html`
- **Modified:** `interface/patient_tracker/patient_tracker.php`
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/public/context/vitals.php`
- **Modified:** `agentforge/api/src/agent/case_presentation_format.ts`
- **Modified:** `agentforge/api/test/agent/case_presentation.test.ts`
- **Modified:** `tests/Tests/Isolated/Modules/AgentForge/AppointmentEncounterBinderStaticStructureTest.php`
- **Modified:** `tests/Tests/Isolated/Modules/AgentForge/RailContainerStaticStructureTest.php`

## Outcomes

Chart opens from calendar/tracker now pass appointment identity into session; AgentForge binds the encounter for that **appointment day** (not server midnight “today”). The automated brief shows **### Recorded most recently** with vitals tied to the **open encounter**, backed by **`encounter_id`** on context vitals rows where the join exists.

## Next steps

- [ ] Manual QA: open chart from May 1 / May 3 / May 4 cells and confirm header + brief + AgentForge encounter id match.
- [ ] Rebuild/deploy **`agentforge-api`** (and refresh rail) where Docker/production does not auto-sync TypeScript output.

## Links

- Numbered milestone: [process/17-encounter-scoped-chart-bind-and-brief.md](../../17-encounter-scoped-chart-bind-and-brief.md)
