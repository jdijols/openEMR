# Vitals Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 0   |   **Dispatch pattern:** C — Lazy fragment

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:1519–1542` — gates on `$vitals_is_registered && AclMain::aclCheckCore('patients', 'med')`, then renders `templates/patient/card/loader.html.twig` as a placeholder with `id='vitals_ps_expand'`. The fragment is fetched async via `placeHtml("vitals_fragment.php", 'vitals_ps_expand')` in the dispatcher's JS block.
- **Twig template (placeholder):** `templates/patient/card/loader.html.twig`
- **Fragment:** `interface/patient_file/summary/vitals_fragment.php` (48 LoC)
- **Backing data:** the fragment includes `interface/forms/vitals/report.php` and calls `vitals_report('', '', 1, $result['id'])` (`vitals_fragment.php:42`) which renders an HTML fragment for the most-recent `form_vitals` row.
- **Direct SQL** (`vitals_fragment.php:26`): `SELECT FORM_VITALS.date, FORM_VITALS.id FROM form_vitals AS FORM_VITALS LEFT JOIN forms AS FORMS ON FORM_VITALS.id = FORMS.form_id WHERE FORM_VITALS.pid=? AND FORMS.deleted != '1' ORDER BY FORM_VITALS.date DESC` — fetches only the single most-recent vitals encounter; older vitals are accessed via the "Click here to view and graph all vitals" trend link to `interface/patient_file/encounter/trend_form.php?formname=vitals`.

## 2. Rendered fields

The legacy card renders only the **most recent** vitals row. From the `form_vitals` schema (`sql/database.sql:2417–2451`) and the rendered output of `interface/forms/vitals/report.php` (the `vitals_report()` function), the fields shown are:

- `date` — source: `form_vitals.date` (datetime when the vitals encounter was recorded)
- `bps` / `bpd` — systolic / diastolic blood pressure (rendered as `<bps>/<bpd>` per `report.php:82`)
- `weight` — `form_vitals.weight` (lbs/kg with US/metric conversion via `US_weight()` per `report.php:98–106`)
- `height` — `form_vitals.height` (inches/cm conversion per `report.php:115–121`)
- `temperature` — `form_vitals.temperature` (F/C conversion per `report.php:128–134`)
- `pulse` — `form_vitals.pulse` (per min, `report.php:147`)
- `respiration` — `form_vitals.respiration` (per min, `report.php:147`)
- `oxygen_saturation` — `form_vitals.oxygen_saturation` (% per `report.php:140`)
- `oxygen_flow_rate` — `form_vitals.oxygen_flow_rate` (l/min per `report.php:143`)
- `BMI` — `form_vitals.BMI` (kg/m², `report.php:145`)
- `head_circ` — pediatric head circumference
- `note` — free-text memo

The card displays a heading `"Most recent vitals from: <date>"` (`vitals_fragment.php:37`) followed by the rendered HTML table from `vitals_report()` and a "Click here to view and graph all vitals" link to the trend page.

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckCore('patients', 'med')` at `demographics.php:1519` (also requires `$vitals_is_registered` — the `vitals` form must be registered/enabled in the `registry` table).
- **Write gate:** N/A on the dashboard card — entries happen via the encounter form.
- **Issue type:** N/A (resource-typed)

## 4. Hide-card global

- **Key:** `card_vitals`
- **Source:** `globals` table where `gl_name = 'hide_dashboard_cards'`; checked at `demographics.php:1539` via `!in_array('card_vitals', $hiddenCards)`. Plus the `vitals` form must be in the `registry` table (`registry.directory='vitals' AND state=1`).

## 5. Edit / expand affordances

- **Pencil icon click:** the card's button is labeled "Trend" with `btnLink => "../encounter/trend_form.php?formname=vitals&context=dashboard"` (`demographics.php:1532`) — opens the trend / graphs view, not an edit.
- **`[]` expand chevron:** toggles via `getUserSetting('vitals_ps_expand')` (`demographics.php:1530`)
- **In our React port:** in V1, "Trend" link opens the legacy trend page in a new tab; or we render a small inline sparkline beside each metric (V2 stretch).

## 6. Empty state behavior

- **Legacy renders:** "No vitals have been documented." (`vitals_fragment.php:30`)
- **Trigger:** the `sqlQuery()` returns false / no row.
- **In our React port:** mirror "No vitals have been documented." in `<EmptyState />`.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/Observation?patient=:id&category=vital-signs&_sort=-date&_count=10`
- **Verified:** `src/RestControllers/FHIR/FhirObservationRestController.php` exists. The PRD §7 confirms the Vitals query.
- **Field-by-field map (FHIR Observation per vital, code = LOINC):**
  - Blood pressure (systolic/diastolic) — LOINC `85354-9` (BP panel) with `component[]` containing `8480-6` (systolic) + `8462-4` (diastolic). Each component has `valueQuantity.value` + `.unit`.
  - Weight — LOINC `29463-7` → `valueQuantity.value` (kg or lb based on `.unit`)
  - Height — LOINC `8302-2` → `valueQuantity.value`
  - Temperature — LOINC `8310-5` → `valueQuantity.value` + `.unit` (F or C)
  - Heart rate (pulse) — LOINC `8867-4` → `valueQuantity.value`
  - Respiratory rate — LOINC `9279-1` → `valueQuantity.value`
  - Oxygen saturation — LOINC `2708-6` (or `59408-5`) → `valueQuantity.value` (%)
  - BMI — LOINC `39156-5` → `valueQuantity.value`
  - Date taken ← `Observation.effectiveDateTime` (preferred) or `effectivePeriod.start`
- **Bundle handling:** `entry[].resource[]` — each Observation is a separate resource even within one vitals encounter. Group client-side by `effectiveDateTime` (or by `Observation.encounter.reference`) to reconstruct a "vitals row".
- **FHIR fidelity gaps:**
  - The legacy renders the **single most recent** vitals row; the PRD asks for the latest 10. FHIR's `_count=10` returns ten Observations, not ten encounters — depending on how OpenEMR groups them, you may need to fetch more (e.g., `_count=100`) and group client-side, OR query each LOINC separately. Document the chosen approach in `PARITY-NOTES.md`.
  - `BMI_status` (legacy categorical label) — not standard on FHIR Observation.
  - `temp_method` (legacy temperature method enum) — not standard.
  - Pediatric percentile fields (`ped_weight_height`, `ped_bmi`, `ped_head_circ`) — likely not in OpenEMR's FHIR emission. Drop in V1.

## 8. Notable quirks

- The legacy fragment shows the most-recent **single** vitals encounter, with a "view and graph all" link as the affordance for history. The PRD §5 acceptance criterion asks for "latest 10 readings" which is richer than legacy parity. We're deliberately exceeding parity here.
- The `vitals_fragment.php:23` opening tag has a duplicate single-quote: `<div id='vitals''>`. Harmless syntax-noise that browsers tolerate, but worth noting if we ever copy-paste.
- The fragment requires `CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true)` (`vitals_fragment.php:20`) — meaning the `placeHtml()` JS must POST a CSRF token. Our React port skips this entire flow (we hit FHIR directly with OAuth2 bearer).
- Unit conversion (US ↔ metric) is controlled by `OEGlobalsBag::getInstance()->get('us_weight_format')` (`report.php:98`). FHIR Observations carry the unit in `valueQuantity.unit` — render whatever unit OpenEMR emits; do not silently convert.

## 8a. Visual ground truth (PD-00)

**Captures:**
- Dashboard card: `Patient dashboard, cards expanded w: data 3.png` (bottom of left column)
- Detail/full table: `Vitals view 1.png` / `Vitals view 2.png` / `Vitals view 3.png` (the legacy `Vitals` tab)

### Dashboard card render — single most-recent encounter (NOT 10 observations)

The legacy dashboard card renders ONE most-recent encounter's vitals as a compact key/value list (NOT a sliding window of 10 individual observations). Sofia Reyes's most recent vitals (2026-05-09 08:48:00):

```
Vitals []
Most recent vitals from: 2026-05-09 08:48:00

Blood Pressure:    119/75
Height:            69 in (175.30 cm)
Weight:            175.4 lb (79.56 kg)
Temperature:       98.3 F (36.84 C)
Pulse:             71 per min
Respiration:       16 per min
BMI:               26 kg/m^2
Oxygen Saturation: 98 %
Last Updated:      2026-05-08 04:26:22

Click here to view and graph all vitals.
```

**This resolves the open question on Vitals grouping strategy** (manifest.md §"Open questions"). Our PRD §5 acceptance criterion ("latest 10 readings") was misaligned with legacy parity — the legacy renders the **single most-recent encounter**, not a 10-row table. Two options for the React port:

- **Option A (parity):** fetch `Observation?category=vital-signs&_sort=-date&_count=50`, group client-side by `effectiveDateTime` date, render the latest group's key-value rows. Matches legacy.
- **Option B (above parity):** render the latest encounter as the dashboard card (parity), AND link to a "/vitals/history" sub-route that shows the last 10 encounters. V2.

**Decision:** Option A for V1 — match the legacy. Update PRD §5 acceptance criterion accordingly.

### Detail tab — full LOINC-coded table (out of scope for V1)

`Vitals view 1.png` shows the detail tab navigated to a separate `Vitals` tab with a wide table where each row is a LOINC-coded observation:
- Weight (LOINC:29463-7), Height/Length (LOINC:8302-2), BP Systolic (LOINC:8480-6), BP Diastolic (LOINC:8462-4), Pulse (LOINC:8867-4), Respiration (LOINC:9279-1), Temperature (LOINC:8310-5), Oxygen Saturation (LOINC:59408-5), Oxygen Flow Rate (LOINC:3151-8), Inhaled Oxygen Concentration (LOINC:3150-0), Head Circumference (LOINC:9843-4), Waist Circumference (LOINC:9843-4), BMI (LOINC:39156-5), BMI Status, Other Notes
- Plus a Vitals History table below with one column per encounter date

**We don't render this detail view in V1** — link out to legacy if needed.

### Unit display

The legacy renders both imperial and metric for height/weight/temperature in the dashboard card (`69 in (175.30 cm)` / `175.4 lb (79.56 kg)` / `98.3 F (36.84 C)`). FHIR `Observation.valueQuantity` carries one unit per observation. Recommendation: render whatever the FHIR observation emits (typically imperial when `us_weight_format=1`); skip the on-the-fly metric conversion in V1.

## 9. Parity decisions for the React port

- **Match:** single most-recent encounter rendered as key/value rows: BP / Height / Weight / Temperature / Pulse / Respiration / BMI / Oxygen Saturation, with the timestamp header "Most recent vitals from: <date>".
- **Drop:** `temp_method`, `BMI_status` categorical, pediatric percentiles, US/metric on-the-fly conversion (render the FHIR-emitted unit verbatim).
- **Out-of-scope:** edit views (PRD §2), card hiding (V2), the trend / graph link (V2 stretch), the LOINC-explicit detail table (V2).
