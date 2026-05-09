# Patient Header — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 0   |   **Dispatch pattern:** dedicated PHP file, included by the dispatcher

## 1. Source mapping

- **Dispatcher entry:** included from `interface/patient_file/summary/demographics.php:1089` via `require_once("$include_root/patient_file/summary/dashboard_header.php")`
- **PHP file:** `interface/patient_file/summary/dashboard_header.php` (33 LoC)
- **Twig template:** `templates/patient/dashboard_header.html.twig` (1 LoC — renders only the page heading text built upstream)
- **Page heading source:** `$oemr_ui->pageHeading()` — assembled by OpenEMR's UI helper from the patient name + chart context (formatting controlled by `globals.php`)
- **Backing data:** `getPatientData($pid, "*, DATE_FORMAT(DOB,'%Y-%m-%d') as DOB_YMD")` at `demographics.php:363` (rows from the `patient_data` table)

## 2. Rendered fields

The legacy "header" emitted by `dashboard_header.php` is intentionally minimal — it's a single text line built by `$oemr_ui->pageHeading()`, augmented by the rest of `demographics.php` rendering the patient title bar, deceased banner (`templates/patient/partials/deceased.html.twig`, see `demographics.php:1346`), and the `PatientMenuRole` horizontal nav (`demographics.php:1094`).

Per the brief / PRD §5, our React port renders the **clinically meaningful five fields** as a single header card:

- `name` — `patient_data.fname` + `lname` + (optional `mname`)
- `birthDate` (DOB) — `patient_data.DOB`
- `gender` (sex) — `patient_data.sex`
- `MRN` — `patient_data.pubpid` (the public/medical-record identifier)
- `active` (status pill) — `patient_data.deceased_date` is null AND no chart-archive flag

## 3. Permission checks (ACL)

- **Read gate:** chart-level — implicit. `dashboard_header.php` includes are gated by `$thisauth` at `demographics.php:1081` (chart owner / squad authorization). No header-specific ACL key.
- **Write gate:** none — header is read-only in legacy.
- **Issue type:** N/A.

## 4. Hide-card global

- **Key:** — (header is not hideable; it's the chart anchor)
- **Source:** N/A

## 5. Edit / expand affordances

- **Pencil icon click:** legacy header has no pencil; demographics edit lives in the Demographics card immediately below (`demographics_full.php`). See `DEMOGRAPHICS-CARD.md`.
- **`[]` expand chevron:** none — header is always visible.
- **In our React port:** header is non-collapsible; edits go through the Demographics card's pencil affordance (which opens legacy `demographics_full.php` in a new tab).

## 6. Empty state behavior

- **Legacy renders:** N/A — if the patient row exists, the header renders. If `$pid` is invalid, the dispatcher errors before reaching the header.
- **Trigger:** N/A
- **In our React port:** if `Patient/:id` returns 404, the page-level error boundary handles it — not a header concern.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/Patient/:id`
- **Verified:** `src/RestControllers/FHIR/FhirPatientRestController.php` exists.
- **Field-by-field map:**
  - `name` ← `Patient.name[0]` — assemble `family + given.join(' ')`. The first entry is the canonical name in OpenEMR's mapping.
  - `birthDate` ← `Patient.birthDate` (ISO date `YYYY-MM-DD`).
  - `gender` ← `Patient.gender` (FHIR codes `male` / `female` / `other` / `unknown`).
  - `MRN` ← `Patient.identifier[]` where `type.coding[0].code === 'PT'` and `system === 'http://terminology.hl7.org/CodeSystem/v2-0203'` → `.value`. Verified at `src/Services/FHIR/FhirPatientService.php:551–565` (`parseOpenEMRPublicPatientIdentifier`). The `pubpid` column is what becomes the MRN; OpenEMR also emits an `SS` (social security) identifier on the same array — filter to `PT`.
  - `active` ← `Patient.active` (boolean). When `false`, render an inactive-state pill.
- **Bundle handling:** N/A — single resource, not a Bundle search.
- **FHIR fidelity gaps:** none for the five required fields; all five are first-class on the FHIR `Patient` resource. `deceased[x]` is also populated by OpenEMR if you want the deceased banner.

## 8. Notable quirks

- The legacy `dashboard_header.php` is a thin shim — most of what looks like "header" in `screenshots/01-full-scroll.png` is actually `$oemr_ui->pageHeading()` (the page title bar at the top of the chrome) + the `PatientMenuRole` horizontal-nav strip at `demographics.php:1094`. We are NOT replicating either of those — they are part of the OpenEMR chrome the React SPA replaces wholesale.
- OpenEMR's FHIR Patient identifier array contains both `SS` (social security) and `PT` (pubpid). Filter by the `type.coding[0].code` value, not by ordinal index — order isn't guaranteed.

## 8a. Visual ground truth (PD-00)

Capture: `Documentation/AgentForge/assets/W2-Migrate-to-React-Screenshots/Patient dashboard, cards expanded w: data 1.png`

Header strip rendered for Sofia Reyes:

```
[avatar]  Sofia Reyes (0031) ×       [Select Encounter (1) ▼] [+]
          DOB: 1983-12-19 Age: 42    Open Encounter: 2026-05-09 (960)
```

Confirms:
- **`(0031)` is `pubpid` (MRN equivalent)** — the same value the FHIR Patient resource exposes via `identifier[type.coding[0].code='PT']`. The legacy `dashboard_header.php` renders this format `<Name> (<pubpid>)` consistently across all chart views.
- **Computed Age is rendered** alongside DOB — we do this client-side from `Patient.birthDate`.
- **The encounter selector and tab strip** above (Calendar / Message Center / Dashboard / Visit History) are part of OpenEMR's main shell and are NOT in our React port's responsibility — they're either elevated via Phase 7 CSS or replaced by simpler in-SPA navigation. See `manifest.md` § "Patient header — visual parity target".

## 9. Parity decisions for the React port

- **Match:** the five PRD-required fields (name, DOB, gender, MRN, active).
- **Drop:** the `$oemr_ui->pageHeading()` text and `PatientMenuRole` horizontal nav — those are OpenEMR chrome, replaced wholesale by the SPA's own header. The deceased banner is V2 (we render the active pill only).
- **Out-of-scope:** edit views (PRD §2), card hiding (V2).
