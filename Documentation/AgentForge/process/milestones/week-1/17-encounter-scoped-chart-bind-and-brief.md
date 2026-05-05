---
date: 2026-05-02
topic: Encounter-scoped chart open + automated brief vitals
related_journal: process/journal/week-1/0502-T0051-encounter-scope-binding-brief.md
---

# Encounter-scoped chart binding and brief vitals — process milestone

## Purpose

Anchor product behavior where **the chart open path carries the appointment the clinician clicked**, so **session encounter**, **AgentForge JWT encounter**, and **host “Open Encounter”** stay consistent **across calendar days**, not PHP `today` alone. Extend the **simplified case brief** so **“Recorded most recently”** lists vitals for the **current open encounter**, with Context Service vitals rows carrying **`encounter_id`** for a reliable join.

Session pivot history: [0502-T0051-encounter-scope-binding-brief.md](../../journal/week-1/0502-T0051-encounter-scope-binding-brief.md).

---

## Decisions (summary)

1. **Navigation context** — Calendar (`goPid`) and patient tracker (`topatient`) append `af_appointment_id` / `af_appointment_date`; `demographics.php` on `set_pid` writes or clears `agentforge_appointment_context_*` session keys.
2. **Binder** — Resolves tracker-linked and same-day encounter / appointment using that context; prefers tracker join on **`eid` + apptdate + appttime`** when the full appointment row is known; falls back to calendar **today** only when no context is present.
3. **Brief** — Replace calendar-today vitals filter with **open-encounter** filter (`encounter_id` / `eid`, then encounter **date** fallback); prior-visit LLM input vitals use the same rule.
4. **Context API** — `vitals.php` includes **`encounter_id`** from VitalsService `eid`.

---

## Code pointers

| Area | Path |
| ---- | ---- |
| Binder | [`interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php) |
| Session + query | [`interface/patient_file/summary/demographics.php`](../../../../../interface/patient_file/summary/demographics.php) |
| Calendar | [`interface/main/calendar/modules/PostCalendar/pntemplates/default/views/day/ajax_template.html`](../../../../../interface/main/calendar/modules/PostCalendar/pntemplates/default/views/day/ajax_template.html) (and `week` / `month` siblings) |
| Tracker | [`interface/patient_tracker/patient_tracker.php`](../../../../../interface/patient_tracker/patient_tracker.php) |
| Brief | [`agentforge/api/src/agent/case_presentation_format.ts`](../../../../../agentforge/api/src/agent/case_presentation_format.ts) |
| Vitals context | [`interface/modules/custom_modules/oe-module-agentforge/public/context/vitals.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/context/vitals.php) |
| Tests (API) | [`agentforge/api/test/agent/case_presentation.test.ts`](../../../../../agentforge/api/test/agent/case_presentation.test.ts) |
| Tests (PHP isolated) | [`tests/Tests/Isolated/Modules/AgentForge/AppointmentEncounterBinderStaticStructureTest.php`](../../../../../tests/Tests/Isolated/Modules/AgentForge/AppointmentEncounterBinderStaticStructureTest.php) |

---

## Verification

- Isolated PHPUnit: `AppointmentEncounterBinderStaticStructureTest`, `RailContainerStaticStructureTest` (structure guards).
- Vitest: `agentforge/api` — `case_presentation.test.ts` (including visit date ≠ calendar today).

---

## Follow-ups

- End-to-end click tests across off-today appointments in a running dev stack (see journal **Next steps**).
