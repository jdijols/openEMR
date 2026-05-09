# Patient Dashboard — Source Manifest

> **Phase 0 PD-01 output.** The entry-point map for the OpenEMR Patient Dashboard. Companion artifacts:
> - Per-card analysis: [`cards/`](cards/)
> - Parity decisions: [`PARITY-NOTES.md`](PARITY-NOTES.md)
> - Route evaluation: [`MIGRATION-OPTIONS.md`](MIGRATION-OPTIONS.md)
> - Visual ground-truth: [`screenshots/`](screenshots/) (PD-00 captures)
>
> **Source treated as read-only artifact.** No PHP / Twig / SCSS edits during Phase 0.

## Entry point

- **Dispatcher:** [`interface/patient_file/summary/demographics.php`](../../../../interface/patient_file/summary/demographics.php) — 2,088 LoC
- **Renders:** the entire patient chart "Dashboard" tab seen in `screenshots/01-full-scroll.png`
- **Cohort patients:**
  - **PD-00 visual recon (Jason 2026-05-08):** Sofia Reyes — `pid=0031` (External ID `0031`, DOB 1983-12-19, age 42, sex Female). 28 screenshots in [`screenshots/`](../../assets/W2-Migrate-to-React-Screenshots/) (under `Documentation/AgentForge/assets/W2-Migrate-to-React-Screenshots/` — out-of-tree because of size). Sofia has 1 active allergy (Ibuprofen, Severe, "GI bleed"), 3 active medications (Metformin, Ozempic, Sertraline), 1 care-team row (Provider Lee Donna at Great Clinic since 2026-05-08), 1 vitals reading (2026-05-09 08:48), 1 immunization, no problems / prescriptions / health concerns / labs.
  - **PD-53 Phase 5 deployed-OpenEMR smoke target:** Margaret Chen — `pid=151` — URL: `/interface/patient_file/summary/demographics.php?set_pid=151`
- **Data flow:** dispatcher resolves `$pid` from session → loads patient + insurance + demographics → dispatches `RenderEvent::EVENT_SECTION_LIST_RENDER_TOP` (top-of-list extension hook) → enters two side-by-side columns (Bootstrap `col-md-8` left, `col-md-4` right) → each column dispatches its own `SectionEvent` (`'primary'` left, `'secondary'` right) so third-party modules can inject cards → emits `EVENT_SECTION_LIST_RENDER_AFTER` at the end

## Layout structure

The legacy dashboard renders **two side-by-side columns** in a Bootstrap 4 grid:

| Column | Class | Cards (legacy reading order) |
|---|---|---|
| Left | `col-md-8` | Allergies + Medical Problems + Medication (3-up Bootstrap row) → Prescriptions / Care Team / Treatment Pref / Care Experience → `SectionEvent('primary')` cards (Demographics / Billing / Insurance) → Messages / Patient Reminders / Disclosures / Amendments / Labs / Vitals / LBF charting groups |
| Right | `col-md-4` | `SectionEvent('secondary')` cards → eRx panel → Photo / ID Card → Advance Directives → Clinical Reminders → Appointments + Recall + Recurrences + Past Appointments → Track Anything (third-party) → admin Delete |

**Visual confirmation from PD-00:** the legacy renders the two-column layout in BOTH the collapsed-all state (`screenshots/Patient dashboard collapsed.png`) and the expanded state (`screenshots/Patient dashboard, cards expanded w: data 1-3.png`). The patient header strip above (Sofia Reyes (0031) + DOB + Age + tabs row + Encounter selector) is rendered by `interface/patient_file/summary/dashboard_header.php` and is OUTSIDE the two-column grid.

**Our React port targets the May 2025 single-continuous-scroll modernization** ([CapMinds writeup](https://www.capminds.com/blog/7-ui-ux-enhancements-in-openemr-that-elevate-healthcare-delivery/)) — one column on desktop, demographics at top, reading order matches legacy left-then-right. Mobile reflows trivially.

## Card visibility model

A card renders if **all three** are true:

1. **ACL check passes** — `AclMain::aclCheckIssue('<topic>')` (issue-typed: allergy / medical_problem / medication) OR `AclMain::aclCheckCore('<resource>', '<action>')` (resource-typed: patients / squads / admin / etc.). Gates by user role.
2. **Hide-card global is unset** — `hide_dashboard_cards` admin global doesn't list the card's hide-key (`card_allergies`, `card_medicalproblems`, `card_medication`, `card_prescriptions`, `card_care_team`, etc.). Gates by site config.
3. **Feature global is enabled** (where applicable) — `disable_prescriptions`, `enable_cdr`, `enable_cdr_crw`, `appt_recurrences_widget`, `disable_calendar`, `amendments`, `advance_directives_warning`. Gates by feature flags.

**Plus** PHP module event hooks: `SectionEvent`, `CardRenderEvent`, `RenderEvent` — third-party modules inject cards or modify existing cards via Symfony EventDispatcher.

**Decision for our port:** OAuth2 scopes provide the read gate. We do not re-implement per-card ACL — we trust OpenEMR's session-level check at the FHIR endpoint. See `PARITY-NOTES.md`.

## Card dispatch patterns

OpenEMR uses three distinct rendering patterns. Our React port maps each to one parity-contract shape:

| Pattern | Description | Examples | Parity contract |
|---|---|---|---|
| **A — Direct Twig** | `$t->render('patient/card/<name>.html.twig', $viewArgs)` rendered server-side, full HTML in initial response | Allergies, Medical Problems, Medication, Prescriptions (rx + erx), Amendments, Photo, Adv Dir, Recall, Appointments | The Twig template's rendered field set IS the parity surface |
| **B — PHP Card class + Section** | `new <Name>ViewCard(...)` registered via `$sectionRenderEvents->addCard(...)` to `SectionEvent('primary'\|'secondary')`, then looped via `foreach ($sectionCards as $card) { echo $t->render($card->getTemplateFile(), ...); }`. Card class extends `CardModel`, exposes `getTitle()`, `getTemplateFile()`, `getTemplateVariables()`, `getBackgroundColorClass()`, etc. | Demographics, Billing, Insurance, Care Team, Treatment Preference, Care Experience, Portal | Card class's `getTemplateVariables()` defines the parity field set; the template is just the renderer |
| **C — Lazy fragment** | `loader.html.twig` placeholder rendered initially → JS `placeHtml(<fragment>.php, '<id>_ps_expand')` fetches HTML async. Fragment is a self-contained PHP page producing an HTML string. | Messages (pnotes), Patient Reminders, Disclosures, Lab Data, Vitals, Clinical Reminders, LBF (linked-by-form) groups | Fragment PHP file's queries + rendered output IS the parity surface — most "data-rich" cards live here |

**Why this matters for the React port:** every Tier-0 / Tier-1 card maps to one of these three. Tier-0 Allergies / Medical Problems / Medication / Prescriptions are pattern A. Tier-0 Care Team is pattern B. Tier-0 Vitals is pattern C. Tier-1 Demographics is pattern B (reuses `Patient` resource we already fetched for header). Tier-1 Health Concerns is pattern A (same Twig as Medical Problems with category filter). Tier-1 Immunizations / Appointments / Labs are pattern C. Per-card MDs in [`cards/`](cards/) capture each card's exact pattern + field mapping.

## Card inventory

22 cards visible in `screenshots/01-full-scroll.png`. The table is the **dispatch index** — what to read for each:

| # | Card | Tier | Dispatch | demographics.php line(s) | ACL gate | Hide-card key | Feature global | Twig template | PHP class / fragment |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Allergies | **0** | A — Twig | 1108, 1147 | `aclCheckIssue('allergy')` | `card_allergies` | — | `templates/patient/card/allergies.html.twig` | (uses `AllergyIntoleranceService`) |
| 2 | Medical Problems (Problem List) | **0** | A — Twig | 1109, 1171 | `aclCheckIssue('medical_problem')` | `card_medicalproblems` | — | `templates/patient/card/medical_problems.html.twig` | (uses `PatientIssuesService`) |
| 3 | Medications | **0** | A — Twig | 1110, 1193 | `aclCheckIssue('medication')` | `card_medication` | — | `templates/patient/card/medication.html.twig` | — |
| 4 | Prescriptions | **0** | A — Twig | 1111, 1221 (eRx) / 1257 (core) | `aclCheckCore('patients', 'rx')` | `card_prescriptions` | `disable_prescriptions` (off), `erx_enable` (eRx variant) | `templates/patient/card/erx.html.twig` OR `templates/patient/card/rx.html.twig` | — |
| 5 | Care Team | **0** | B — Card class | 1264–1265 | (resolved by card's `getAcl()`) | `card_care_team` | — | (card-defined via `getTemplateFile()`) | `src/Patient/Cards/CareTeamViewCard.php` |
| 6 | Vitals | **0** | C — Lazy fragment | 1519–1542 | `aclCheckCore('patients', 'med')` + `$vitals_is_registered` | `card_vitals` | (form_vitals registry entry) | `templates/patient/card/loader.html.twig` (placeholder) | `interface/patient_file/summary/vitals_fragment.php` |
| 7 | Demographics | 1 | B — Card class (`primary`) | 1351–1352 | (resolved by card's `getAcl()`) | — (always renders) | — | (card-defined) | `src/Patient/Cards/DemographicsViewCard.php` |
| 8 | Health Concerns | 1 | A — Twig (Condition variant) | (within Medical Problems block, filtered by category) | `aclCheckIssue('medical_problem')` | (shares `card_medicalproblems`) | — | reuses medical_problems template | (uses `PatientIssuesService` w/ category filter) |
| 9 | Immunizations | 1 | A — Twig (via meta-fragment `stats.php`) | rendered by `stats.php:299` (loaded as fragment from `demographics.php:620`) | `aclCheckCore('patients', 'med')` + `disable_immunizations` global (off) | `weight_loss_clinic` global (off) | `templates/patient/card/immunizations.html.twig` (17 LoC) | SQL inline in `stats.php:266–277` (joins `immunizations` + `codes` + `code_types`); 71KB `immunizations.php` is the *edit* page, not the dashboard renderer |
| 10 | Appointments | 1 | A — Twig | 2007, 2010 | `aclCheckCore('patients', 'appt')` | — | `disable_calendar` (off) | `templates/patient/card/appointments.html.twig` | `library/appointments.inc.php` (`fetchNextXAppts`, `fetchXPastAppts`) |
| 11 | Labs | 1 | C — Lazy fragment | 1489–1517 | `aclCheckCore('patients', 'lab')` | `card_lab` | — | `templates/patient/card/loader.html.twig` (placeholder) | `interface/patient_file/summary/labdata_fragment.php` |
| — | *PATIENT HEADER* | **0** | (separate file) | (rendered above demographics.php) | (chart-level ACL) | — | — | — | `interface/patient_file/summary/dashboard_header.php` |
| 12 | Treatment Intervention Preferences | out | B — Card class | 1292–1293 | (card's `getAcl()`) | `card_treatment_preferences` | — | `templates/patient/card/preference_card_inline.html.twig` | `src/Patient/Cards/TreatmentPreferenceViewCard.php` |
| 13 | Care Experience Preferences | out | B — Card class | 1318–1319 | (card's `getAcl()`) | `card_care_experience` | — | (preference template) | `src/Patient/Cards/CareExperiencePreferenceViewCard.php` |
| 14 | Billing | out | B — Card class (`primary`) | 1355 | (card's `getAcl()`) | — | — | `templates/patient/card/billing.html.twig` | `src/Patient/Cards/BillingViewCard.php` |
| 15 | Insurance | out | B — Card class (`primary`) | 1358–1359 | (card's `getAcl()`) | `card_insurance` | — | `templates/patient/card/insurance.html.twig` | `src/Patient/Cards/InsuranceViewCard.php` |
| 16 | Messages (Patient Notes) | out | C — Lazy fragment | 1396–1413 | `aclCheckCore('patients', 'notes')` | — | — | `templates/patient/card/loader.html.twig` | `interface/patient_file/summary/pnotes_fragment.php` |
| 17 | Patient Reminders | out | C — Lazy fragment | 1415–1432 | `aclCheckCore('patients', 'reminder')` | `card_patientreminders` | `enable_cdr` + `enable_cdr_prw` | `templates/patient/card/loader.html.twig` | `interface/patient_file/summary/patient_reminders_fragment.php` |
| 18 | Disclosures | out | C — Lazy fragment | 1436–1456 | `aclCheckCore('patients', 'disclosure')` | `card_disclosure` | — | `templates/patient/card/loader.html.twig` | `interface/patient_file/summary/disc_fragment.php` |
| 19 | Amendments | out | A — Twig | 1459–1486 | `aclCheckCore('patients', 'amendment')` | `card_amendments` | `amendments` (on) | `templates/patient/card/amendments.html.twig` | (uses amendment service) |
| 20 | Patient Portal / API Access | out | B — Card class (`secondary`) | 1592–1603 | (card's `getAcl()`) | — | `portal_onsite_two_enable` OR `rest_fhir_api` OR `rest_api` OR `rest_portal_api` | (card-defined) | `src/Patient/Cards/PortalCard.php` |
| 21 | Clinical Reminders | out | C — Lazy fragment | 1735–1755 | `aclCheckCore('patients', 'alert')` + rules-defined gate | — | `enable_cdr` + `enable_cdr_crw` + `resolve_rules_sql(...)` non-empty | `templates/patient/card/loader.html.twig` | `interface/patient_file/summary/clinical_reminders_fragment.php` |
| 22 | Recall | out | A — Twig | 1907–1929 | `aclCheckCore('patients', 'appt')` (shares with Appointments) | — | `disable_calendar` (off) | `templates/patient/card/recall.html.twig` | (queries `medex_recalls`) |

**Tier legend:** **0** = must ship (brief requirement), **1** = stretch (FHIR-backed, reuses Tier-0 infra), `out` = explicitly deferred per [§2 of the PRD](../PRD-patient-dashboard.md). Patient Header is rendered separately (different PHP file) but is a Tier-0 deliverable.

## Pattern C' — Meta-fragment (`stats.php`)

A discovery during PD-02: [`interface/patient_file/summary/stats.php`](../../../../interface/patient_file/summary/stats.php) (339 LoC) is itself loaded as a lazy fragment by `demographics.php:620` (`placeHtml("stats.php", "stats_div", true)`), but **inside `stats.php` are multiple direct-Twig render calls** dispatching additional cards:

| stats.php line | Card rendered | Twig template |
|---|---|---|
| 175 | eRx panel | `templates/patient/card/erx.html.twig` |
| 226 | Medications (rendered again, alternate context) | `templates/patient/card/medication.html.twig` |
| 228 | Medical Problems (rendered again, alternate context) | `templates/patient/card/medical_problems.html.twig` |
| 256 | Treatment Preference inline | `templates/patient/card/tp_il.html.twig` |
| **299** | **Immunizations** | `templates/patient/card/immunizations.html.twig` |
| 337 | Medical Problems variant (likely Health Concerns under `lists.type='health_concern'` — see below) | `templates/patient/card/medical_problems.html.twig` |

**Implication for our React port:** the dispatch pattern is "fragment containing direct-Twig renders" (a meta-fragment). For parity, the *contract* matters more than the dispatch chain — Immunizations is a card with its own field set, regardless of where the legacy dispatches it. Our `<ImmunizationsCard>` mounts directly in `<PatientDashboardPage>`.

## Health Concerns vs. Medical Problems — issue_types table

OpenEMR's `issue_types` table ([`sql/database.sql:3478–3490`](../../../../sql/database.sql)) configures dashboard-visible issue subtypes. The relevant rows with `force_show='1'`:

| ordering | type | plural | abbreviation |
|---|---|---|---|
| 10 | `medical_problem` | Medical Problems | P |
| 15 | `health_concern` | Health Concerns | HC |
| 20 | `allergy` | Allergies | A |
| 30 | `medication` | Medications | M |

**Health Concerns is not directly dispatched from `demographics.php`** — it shares the `lists` table with Medical Problems (same row, different `lists.type` value) and is rendered through `stats.php:337` (the second `medical_problems.html.twig` render, parametrized for `type='health_concern'`). The FHIR equivalent is `Condition?category=health-concern` (verified at [`src/Services/FHIR/Condition/FhirConditionHealthConcernService.php:50–52`](../../../../src/Services/FHIR/Condition/FhirConditionHealthConcernService.php)).

**Decision for the React port:** implement a single `<ConditionCard category={'problem-list-item' | 'health-concern'}>` component, mounted twice — once for Problem List, once for Health Concerns. Same Twig field shape, same FHIR resource, different category filter. See [`cards/PROBLEM-LIST-CARD.md`](cards/PROBLEM-LIST-CARD.md) and [`cards/HEALTH-CONCERNS-CARD.md`](cards/HEALTH-CONCERNS-CARD.md).

## Lazy-load fragment pattern (pattern C, expanded)

Fragment cards initially render the `loader.html.twig` placeholder, which produces a Bootstrap card with a collapse body and a JS hook. After page-ready, [`demographics.php:530–743`](../../../../interface/patient_file/summary/demographics.php#L530-L743) defines:

```javascript
async function placeHtml(url, divId, embedded = false, sessionRestore = false) { … }

placeHtml("pnotes_fragment.php",          'pnotes_ps_expand');
placeHtml("disc_fragment.php",            'disclosures_ps_expand');
placeHtml("labdata_fragment.php",         'labdata_ps_expand');
placeHtml("vitals_fragment.php",          'vitals_ps_expand');
placeHtml("clinical_reminders_fragment.php", 'clinical_reminders_ps_expand');
placeHtml("patient_reminders_fragment.php",  'patient_reminders_ps_expand');
placeHtml("track_anything_fragment.php",  'track_anything_ps_expand');
```

Each fragment PHP file is a self-contained mini-page that runs its own SQL, formats rows, and emits HTML. **For our React port, this pattern's parity surface is the SQL + rendered field set, not the HTML itself.** The Vitals fragment, for example, queries `form_vitals` and renders BP / HR / temp / weight / height columns — the parity contract is *those columns*, not the legacy table markup.

**FHIR mapping for pattern C cards:** every Tier-1 fragment-backed card has a FHIR equivalent (Vitals → `Observation?category=vital-signs`, Labs → `Observation?category=laboratory`, Immunizations → `Immunization`). We render the FHIR shape directly; we do not load the legacy fragment.

## Event-driven extensibility (we do not need to reproduce)

OpenEMR's dashboard supports third-party module injection via three event types (`use OpenEMR\Events\Patient\Summary\Card\…`):

- `SectionEvent('primary'|'secondary')::EVENT_HANDLE` — register a new card to a section
- `CardRenderEvent('<name>')::EVENT_HANDLE` — inject prepended/appended HTML into an existing card
- `RenderEvent($pid)::EVENT_SECTION_LIST_RENDER_TOP` / `EVENT_SECTION_LIST_RENDER_BEFORE` / `EVENT_SECTION_LIST_RENDER_AFTER` — page-level render hooks

This is OpenEMR's plugin extensibility model. **Our React port does not need to reproduce it** — the dashboard renders a fixed card set, configurable by hide-card globals at most (deferred to V2 per [§2](../PRD-patient-dashboard.md)). If we need to expose extension points later, they map naturally to React render-prop / children patterns or a small registry.

## Cross-references for the build

- **OAuth2 entry point we'll redirect to:** [`oauth2/authorize.php`](../../../../oauth2/authorize.php)
- **FHIR R4 base path:** `/apis/default/fhir` ([`src/RestControllers/FHIR/`](../../../../src/RestControllers/FHIR/))
- **Patient header (separate from demographics.php):** [`interface/patient_file/summary/dashboard_header.php`](../../../../interface/patient_file/summary/dashboard_header.php) (33 LoC — small, useful read for header parity)
- **CardModel base class:** `OpenEMR\Patient\Cards\…ViewCard` extends `CardModel` — `getTitle()`, `getTemplateFile()`, `getTemplateVariables()`, `getAcl()`, `getBackgroundColorClass()`, `getTextColorClass()`, `canCollapse()`, `canEdit()`, `canAdd()`, `isInitiallyCollapsed()`

## Visual ground truth — screenshots index

PD-00 captures live in `Documentation/AgentForge/assets/W2-Migrate-to-React-Screenshots/`. Mapping shot → relevant card MD:

| Screenshot | Resolves / illustrates |
|---|---|
| `Login.png` | OAuth flow entry — OpenEMR's standard `/interface/login/login.php` form. Our `/login` redirects users HERE before OpenEMR's `/oauth2/authorize` consent. |
| `Patient dashboard collapsed.png` | Two-column legacy layout, all cards collapsed. Reference for legacy reading order. |
| `Patient dashboard, cards expanded 1-3.png` | Empty-state dashboard for a synthetic patient with sparse data. |
| `Patient dashboard, cards expanded w: data 1-3.png` | Dashboard with Sofia Reyes data — single source of truth for visual parity target. |
| `Allergies view.png` | Allergies expanded view (clicking the card title routes to "Patient Issues" tab). Field set: name link, status pill (`Active`), severity pill (`Severe` yellow), Occurrence, Last Modified, Verification icon, Comments. |
| `Medical problems view.png` | Empty state — `[ ] None` checkbox. |
| `Medications view.png` | Per-row: name link + (Active) status, Last Modified, Start Date, Comments (e.g., "1000 mg : BID"), Occurrence. |
| `Prescriptions view.png` | Click → MODAL DIALOG with "There are currently no prescriptions." + Add/Quit buttons. Different click affordance from Patient Issues tabs. |
| `Care team filled view.png` | Care Team renders as a TABLE on the dashboard itself (not collapsed): columns Type, Member, Role, Facility, Since, Status, Note, Remove. With a header row: "Great Clinic [Active]". |
| `Care team edit view.png` | Pencil icon → edit form (out of scope; legacy PHP). |
| `Health concerns view.png` | Empty state — `[ ] None`. Confirms Health Concerns IS a card. |
| `Vitals view 1-3.png` | Detail tab navigates to a separate `Vitals` tab with full LOINC-coded table (Weight LOINC:29463-7, BP Systolic LOINC:8480-6, etc.) + Vitals History below. The DASHBOARD card just renders the most recent encounter's vitals as key/value pairs. |
| `Immunizations view 1-3.png` | The legacy "Immunizations" tab is the EDIT FORM (CVX Code, Date & Time Administered, Manufacturer, Lot Number, etc.) — out of scope. The dashboard card just shows date + vaccine name. |
| `Demographics view.png` | The legacy "Edit Current Patient" tab is the EDIT FORM with sub-tabs (Who, Contact, Choices, Employer, Stats, Misc, Related) — out of scope. The dashboard card itself shows a read-only version with the same Who-tab subset. |
| `Appointments patient view 1-2.png` + `Appointments provider view 1-2.png` | Click → MODAL with Patient/Provider tabs (form with Category, Facility, Provider, Date, Time, Repeats). Out of scope; the dashboard card just renders Future Appointments + Recurring Appointments + Past Appointments lists. |
| `Calendar view booked.png` + `Calendar view empty.png` | **Phase 7 reference** — the existing OpenEMR calendar tab. CSS elevation target. |

## Patient header — visual parity target

From `Patient dashboard, cards expanded w: data 1.png`:

```
[avatar]  Sofia Reyes (0031) ×       [Select Encounter (1) ▼] [+]
          DOB: 1983-12-19 Age: 42    Open Encounter: 2026-05-09 (960)

▾ Calendar 🔄🔒×  Message Center 🔄🔒×  [Dashboard] 🔄🔒×  Visit History 🔄🔒×
```

**Implications for `<PatientHeader>`:**
- The `(0031)` in the header IS the `External ID` field — same value as `pubpid` in OpenEMR's DB and the FHIR `Patient.identifier` entry whose `system` matches OpenEMR's MRN system. Rendering "Name (MRN)" matches the legacy.
- DOB + computed Age side-by-side. Compute age client-side from `Patient.birthDate`.
- Encounter selector is OUT of scope — we render a static "Open Encounter" indicator if there's a SMART launch context, otherwise omit.
- Tab strip (Calendar / Message Center / Dashboard / Visit History) is part of OpenEMR's main shell — we don't reproduce it; if we frame our dashboard inside an iframe in the host, the legacy tab strip still appears above us.

## Open questions for follow-up

Status after PD-02:

- ✅ **Health Concerns category filter** — resolved. `Condition?category=health-concern` is supported by `FhirConditionHealthConcernService`. Legacy renders via `stats.php:337` using the shared `medical_problems.html.twig` with `lists.type='health_concern'`. React port shares a `<ConditionCard>` parametrized by category.
- ✅ **Immunizations FHIR endpoint** — resolved. `Immunization?patient=:id` is supported via `FhirImmunizationRestController.php`. Legacy dashboard card is rendered from `stats.php:299` (NOT the 71KB `immunizations.php` which is the edit screen).
- ✅ **Patient header MRN** — resolved. The legacy header shows `Sofia Reyes (0031)` — the `(0031)` is `External ID` (= `pubpid` in DB = MRN). For FHIR, render `Patient.name[0]` + `(<identifier where system matches OpenEMR's MRN system>)`. Confirm the actual `system` value against a live `GET /Patient/0031` response in Phase 2 PD-21.
- ✅ **Care Team empty Bundle shape** — resolved by visual evidence. Sofia Reyes has one care-team row (Provider Lee Donna at Great Clinic). For an empty patient, render `<EmptyState>No care team members assigned.</EmptyState>`. The legacy renders an empty table with column headers and no rows when there's no data; our React port renders explicit empty-state copy instead.
- ✅ **Allergies sort intent vs. implementation** — confirmed. Sofia's screenshot shows 1 allergy, so sort isn't observable here, but the docblock claim of "critical first" is unimplemented in the loop. Our React port sorts by `criticality` desc + `recordedDate` desc per `PARITY-NOTES.md` §3 — *we don't reproduce the legacy bug.*
- ✅ **Vitals grouping strategy** — resolved by visual evidence. The legacy dashboard card renders **one most-recent encounter** ("Most recent vitals from: 2026-05-09 08:48:00" then key/value rows: Blood Pressure, Height, Weight, Temperature, Pulse, Respiration, BMI, Oxygen Saturation, Last Updated). The Vitals **detail tab** renders the full LOINC-coded table with history. For Phase 3 PD-36: fetch `Observation?category=vital-signs&_sort=-date&_count=50`, group client-side by `effectiveDateTime` (date), render the latest encounter's group as the dashboard card. Detail/history view is out of scope for V1.
- ⏳ **Recurring-appointment fields** — FHIR `Appointment` has no R4 analog for OpenEMR's `pc_recurrtype`/`pc_recurrspec`/`pc_endDate`. Recurrence display is dropped for V1 — captured in `PARITY-NOTES.md`. Sofia's screenshot shows "No Recurring Appointments" empty state, confirming this is fine to drop.

## Read-only artifact discipline

Per the instructor's framework: **`interface/patient_file/summary/demographics.php` is frozen during Phase 0.** No PHP edits, no Twig edits, no SCSS edits. We're producing documentation against it. Phase 7 visual elevation (Saturday evening, ≤2h cap) is the only place we'll touch *anything* in `interface/` — and only via a scoped CSS override file under `interface/themes/agentforge-elevated.css` — never the source files mapped here.
