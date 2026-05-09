# Appointments Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 1   |   **Dispatch pattern:** A — Direct Twig

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:2007–2030` — gates on `!disable_calendar AND aclCheckCore('patients', 'appt')`, then renders `templates/patient/card/appointments.html.twig`.
- **Twig template:** `templates/patient/card/appointments.html.twig` (101 LoC) — has three sections (Future, Recurring, Past), each conditionally rendered.
- **PHP card class:** N/A
- **Backing helpers:** `library/appointments.inc.php`:
  - `fetchNextXAppts($current_date, $pid, $apptNum2 + $extraAppts, true)` (called at `demographics.php:1782`) — returns `$events` (future appts)
  - `fetchXPastAppts($pid, $showpast, $direction)` (called at `demographics.php:1971`) — returns `$past_appts`
  - Recurring appointments collected separately into `$recurr` (built upstream from `openemr_postcalendar_events` where `pc_recurrtype != 0`)
- **Underlying SQL:** `library/appointments.inc.php:462` queries `openemr_postcalendar_events WHERE pc_pid = ? AND pc_eventDate < ? ORDER BY pc_eventDate ASC`. The fetchAppointments helper joins `openemr_postcalendar_events` with `openemr_postcalendar_categories` and `users` for category + provider names.

## 2. Rendered fields

From `templates/patient/card/appointments.html.twig` macros:

**Future / Past appointment row** (`appointmentDetail` macro at `:3–33`):
- `pc_catname` — appointment category title (e.g., "Office Visit")
- `pc_eventDate` — the date (rendered with `shortDate` filter)
- `pc_eventTime` + `displayMeridiem` — formatted time + AM/PM
- `dayName` — day-of-week label
- `uname` — provider's name (`ufname` + `ulname` from the `users` join, see `demographics.php:1999`)
- `pc_status` — generated via `generate_plaintext_field(['data_type'=>'1', 'list_id'=>'apptstat'], pc_apptstatus)` (`demographics.php:1994`); status string (e.g., "Arrived", "Cancelled")
- `pc_hometext` — comment marker (renders a chat-bubble icon if non-empty, `:13`)
- `pc_recurrtype` — recurrence marker (renders a retweet icon if non-zero, `:13`)
- `pc_catid` — category id (used to suppress the click-link for therapy-group categories at `:9, 14`)
- `bgColor` — per-row background color (passed through inline style)
- `groupName` — for therapy-group appointments only (`:29`)

**Recurring appointment row** (`:78–82`): `pc_title`, `pc_recurrspec`, `pc_endDate`

**Section headers** + **noItems** + **additionalAppointment** macros provide the "+more" indicator and the section dividers.

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckCore('patients', 'appt')` at `demographics.php:2007`
- **Write gate:** `AclMain::aclCheckCore('patients', 'appt', '', 'write')` OR `aclCheckCore('patients', 'appt', '', 'addonly')` (`demographics.php:2025`) — controls Add button.
- **Issue type:** N/A (resource-typed)

## 4. Hide-card global

- **Key:** — (the manifest table line 68 doesn't list a hide-card key — Appointments is gated by the `disable_calendar` feature global instead)
- **Source:** `disable_calendar` global (off) per `demographics.php:2007`

## 5. Edit / expand affordances

- **Pencil/Add icon click:** `btnLink => "return newEvt()"` (`demographics.php:2015`) with `linkMethod => "javascript"` — opens the new-event modal in the calendar JS.
- **Row click:** `oldEvt(<jsEvent>)` (`appointments.html.twig:9`) — opens the appointment detail modal.
- **`[]` expand chevron:** toggles via `getUserSetting('appointments_ps_expand')` (`demographics.php:2013`)
- **In our React port:** Add button opens the legacy calendar in a new tab; row clicks open the appointment detail in a new tab (or simply non-clickable in V1).

## 6. Empty state behavior

- **Legacy renders** (per the `noItems` macro at `appointments.html.twig:51–55`):
  - Future: "No Appointments" (`:70`)
  - Recurring: "No Recurring Appointments" (`:84`)
  - Past: "No Past Appointments" (`:95`)
- **Trigger:** the relevant array (`appts` / `recurrAppts` / `pastAppts`) has length 0.
- **In our React port:** mirror these three copies; render only the sections that have data (or a single combined empty state if all three are empty).

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/Appointment?patient=:id&_sort=-date&_count=10`
- **Verified:** `src/RestControllers/FHIR/FhirAppointmentRestController.php` exists.
- **Field-by-field map:**
  - Legacy `pc_catname` ← FHIR `Appointment.serviceType[].text` or `appointmentType.text`
  - Legacy `pc_eventDate` + `pc_eventTime` ← FHIR `Appointment.start` (ISO datetime — extract date and time client-side)
  - Legacy `pc_status` ← FHIR `Appointment.status` (`booked`/`arrived`/`fulfilled`/`cancelled`/`noshow`/`pending`)
  - Legacy `uname` (provider name) ← FHIR `Appointment.participant[]` where `actor.reference` starts with `Practitioner/` → `.actor.display`
  - Legacy `pc_hometext` (comment) ← FHIR `Appointment.comment`
  - Legacy `pc_recurrtype` (recurrence flag) — FHIR R4 doesn't have first-class recurrence on Appointment in US Core; OpenEMR may emit an extension or omit. Drop in V1.
- **Bundle handling:** `entry[].resource[]` is the iteration target. Sort + section-split client-side: `start > now` → Future, `start <= now` → Past.
- **FHIR fidelity gaps:**
  - **Recurring appointments** (`pc_recurrtype`, `pc_recurrspec`, `pc_endDate`) — not standard on FHIR R4 Appointment. The legacy's recurring section won't have a clean FHIR analog. Drop in V1.
  - Therapy-group categories (`pc_catid in therapyGroupCategories`) — OpenEMR-specific concept; drop.
  - Per-row `bgColor` (driven by `pc_catid`) — UI-side rendering hint not in FHIR; we can pick our own status-driven color scheme instead.

## 8. Notable quirks

- The legacy splits appointments into THREE sections (Future, Recurring, Past) with separate gates (`displayAppts`, `displayRecurrAppts`, `displayPastAppts` at `demographics.php:2020–2022`). FHIR returns a flat list; we section-split client-side by the `start` timestamp.
- The `extraApptDate` field (`appointments.html.twig:35–41`) renders a "+1 more on date X" tail when the visible-future-count cap is hit and there's exactly one more appointment immediately after. UI affordance — drop in V1.
- The `fetchXPastAppts` function at `library/appointments.inc.php:457` uses a 26-week sliding-window search backwards through history (`$periodOf = '26'`) to avoid scanning the full table — pure performance optimization, irrelevant to our FHIR-backed React port.
- `pc_apptstatus` is mapped through `list_options` (table `apptstat`) at `demographics.php:1994` — translates the raw status code to a display string. FHIR `Appointment.status` is already a closed-set enum we render directly.

## 9. Parity decisions for the React port

- **Match:** appointment category/serviceType, date+time, provider name, status pill, future/past sectioning.
- **Drop:** Recurring section (no FHIR analog), per-row bgColor by category, therapy-group categories, "+1 more on date" tail, comment-bubble and recurrence icons.
- **Out-of-scope:** edit views (PRD §2), the new-event affordance, Recall (separate card, see `manifest.md` line 81).
- **Render:** the latest 10 appointments (Future on top, Past below) per PRD §7.
