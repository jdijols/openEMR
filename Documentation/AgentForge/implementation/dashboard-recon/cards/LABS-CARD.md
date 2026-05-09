# Labs Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 1   |   **Dispatch pattern:** C — Lazy fragment

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:1489–1517` — gates on `AclMain::aclCheckCore('patients', 'lab')`, runs an existence-check SQL (`:1493–1498`) to set `$widgetAuth`, then renders `templates/patient/card/loader.html.twig` as a placeholder with `id='labdata_ps_expand'`. The fragment is fetched async via `placeHtml("labdata_fragment.php", 'labdata_ps_expand')` in the dispatcher's JS.
- **Twig template (placeholder):** `templates/patient/card/loader.html.twig`
- **Fragment:** `interface/patient_file/summary/labdata_fragment.php` (62 LoC)
- **Backing SQL** (`labdata_fragment.php:28–35`):
  ```sql
  SELECT procedure_report.date_collected AS thedate,
         procedure_order_code.procedure_name AS theprocedure,
         procedure_order.encounter_id AS theencounter
  FROM procedure_report
  JOIN procedure_order
    ON procedure_report.procedure_order_id = procedure_order.procedure_order_id
  JOIN procedure_order_code
    ON procedure_order.procedure_order_id = procedure_order_code.procedure_order_id
  WHERE procedure_order.patient_id = ?
  ORDER BY procedure_report.date_collected DESC
  ```
  The fragment uses `sqlQuery()` (single row), so it shows ONLY the most recent lab — older labs accessed via the trend link.

## 2. Rendered fields

The legacy fragment renders only the **most recent** lab. From `labdata_fragment.php:46–55`:

- `theprocedure` — source: `procedure_order_code.procedure_name` (e.g., "CBC", "Lipid Panel"). Rendered via `xlt('Procedure') . ": " . text(...)`.
- `thedate` — source: `procedure_report.date_collected` (the collection date, in parentheses after the procedure name).
- `theencounter` — source: `procedure_order.encounter_id`. Rendered as a clickable link to `interface/patient_file/encounter/encounter_top.php?set_encounter=<id>` (target=RBot, the encounters frame).

Display format: `Procedure: <name> (<date>)\nEncounter: <encounterId>` followed by a "Click here to view and graph all labdata." link to `interface/patient_file/summary/labdata.php`.

The fragment does NOT render lab values, reference ranges, or abnormal flags — those live on the trend page.

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckCore('patients', 'lab')` at `demographics.php:1489`
- **Write gate:** N/A on dashboard.
- **Issue type:** N/A (resource-typed)

## 4. Hide-card global

- **Key:** `card_lab`
- **Source:** `globals` table where `gl_name = 'hide_dashboard_cards'`; checked at `demographics.php:1514` via `!in_array('card_lab', $hiddenCards)`

## 5. Edit / expand affordances

- **Pencil/Trend button:** `btnLabel => 'Trend'` with `btnLink => "../summary/labdata.php"` (`demographics.php:1506–1507`) — opens the lab trend / graph page.
- **Encounter link:** clicking the encounter ID opens that encounter in the legacy encounters frame (`labdata_fragment.php:52`).
- **`[]` expand chevron:** toggles via `getUserSetting('labdata_ps_expand')` (`demographics.php:1505`)
- **In our React port:** Trend link opens `labdata.php` in a new tab; encounter clicks are V2 (no React encounter view in V1).

## 6. Empty state behavior

- **Legacy renders:** "No lab data documented." (`labdata_fragment.php:40`)
- **Trigger:** the `sqlQuery()` returns false / no row.
- **In our React port:** mirror "No lab data documented." in `<EmptyState />`.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/Observation?patient=:id&category=laboratory&_sort=-date&_count=20`
- **Verified:** `src/RestControllers/FHIR/FhirObservationRestController.php` exists. The PRD §7 confirms the Labs query.
- **Field-by-field map:**
  - Legacy `theprocedure` ← FHIR `Observation.code.text` (preferred) or `code.coding[0].display` (LOINC display name)
  - Legacy `thedate` (collection date) ← FHIR `Observation.effectiveDateTime` or `effectivePeriod.start`
  - Legacy `theencounter` ← FHIR `Observation.encounter.reference` (e.g., `Encounter/123`)
  - Numeric value (legacy not rendered, but PRD §7 asks for it) ← FHIR `Observation.valueQuantity.value` + `.unit`
  - Reference range ← FHIR `Observation.referenceRange[0].low.value` + `.high.value`
  - Abnormal flag ← FHIR `Observation.interpretation[0].coding[0].code` (`H` = high, `L` = low, `N` = normal, etc.) — render an out-of-range visual cue when present.
- **Bundle handling:** `entry[].resource[]` is the iteration target. Each lab observation is a separate resource; some labs may share an encounter or order.
- **FHIR fidelity gaps:**
  - The legacy queries by `procedure_report` (one row per lab REPORT) and surfaces the procedure name. FHIR exposes individual LOINC-coded observations (per analyte). Mapping `procedure_report` → FHIR is **one-to-many**: a single CBC procedure_report likely fans out to ~10 FHIR Observations (WBC, RBC, Hgb, Hct, MCV, etc.). Document in `PARITY-NOTES.md` that the React card lists per-analyte rows, not per-report rows.
  - `procedure_order_code.procedure_name` is the order panel name (e.g., "CBC"); FHIR `Observation.code.text` is the analyte name (e.g., "Hemoglobin"). These differ.
  - The encounter-link affordance has no FHIR analog as a clickable navigation in V1.

## 8. Notable quirks

- The legacy fragment shows only the **single most recent** lab; the PRD §7 / acceptance asks for the latest 20 with values. We're significantly exceeding legacy parity here (per-analyte rows with values + ranges + abnormal flags).
- The `procedure_report` → FHIR `Observation` mapping is many-to-many in the worst case. Group client-side by `Observation.basedOn` (the order reference) if we want to recreate the report-level view. V1 just lists Observations chronologically.
- The fragment requires `CsrfUtils::checkCsrfInput(INPUT_POST, dieOnFail: true)` (`labdata_fragment.php:21`) — meaning the JS-loaded fragment must POST a CSRF. Our React port skips this entire flow (we hit FHIR directly).
- Encounter ID in the legacy renders as `<a target='RBot'>` — it targets the OpenEMR `RBot` (right-bottom) frame, an iframe layout artifact. Drop wholesale.
- The "Click here to view and graph all labdata" link goes to `interface/patient_file/summary/labdata.php` — a separate legacy page that handles trending. We surface it as a "View all labs" link in V1 if we link it at all.

## 9. Parity decisions for the React port

- **Match:** lab analyte name + collection date + value + unit + reference range + abnormal flag (per PRD §7 — exceeds legacy parity).
- **Render:** the latest 20 Observations sorted by `effectiveDateTime` desc.
- **Visual cue for abnormal:** Tailwind warning color (orange/red) on the value when `interpretation[0].coding[0].code` is `H`/`L`/`A`/`AA`.
- **Drop:** the encounter-link affordance, the trend page link (V2), the procedure-panel grouping (V2 — group by `basedOn` reference).
- **Out-of-scope:** edit views (PRD §2), card hiding (V2), the trend / graph view, lab-order entry.
