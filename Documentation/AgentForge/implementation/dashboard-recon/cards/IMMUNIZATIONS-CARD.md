# Immunizations Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 1   |   **Dispatch pattern:** A — Direct Twig (rendered from `stats.php`, NOT from `demographics.php`)

## 1. Source mapping

- **Dispatcher entry:** the Immunizations dashboard card is rendered by `interface/patient_file/summary/stats.php:299` — NOT by `demographics.php`. (`demographics.php` only references the immunizations card via the LBF charting reference at `:994` in a comment.) `stats.php` is included separately as part of the PatientMenuRole flow.
- **Twig template:** `templates/patient/card/immunizations.html.twig` (17 LoC)
- **PHP card class:** N/A
- **Fragment:** N/A — the dashboard card is template-rendered. The full edit screen `interface/patient_file/summary/immunizations.php` (71 KB) is a CRUD page reachable from the card's "Edit" button — we do NOT replicate that.
- **Backing SQL** (`stats.php:266–277`):
  ```sql
  SELECT IF(i1.administered_date,
           concat(i1.administered_date,' - ',c.code_text_short),
           IF(i1.note, substring(i1.note,1,20), c.code_text_short)
       ) AS immunization_data
  FROM immunizations i1
  LEFT JOIN code_types ct ON ct.ct_key = 'CVX'
  LEFT JOIN codes c ON c.code_type = ct.ct_id AND i1.cvx_code = c.code
  WHERE i1.patient_id = ?
    AND i1.added_erroneously = 0
  ORDER BY i1.administered_date DESC
  ```

## 2. Rendered fields

From `templates/patient/card/immunizations.html.twig:9–14` — each list row renders:

- `cvx_text` — source: assembled by `stats.php:286–293`. Uses `cvx_text` from the `codes` table when `use_custom_immun_list=0` (default), or `generate_display_field('immunizations', immunization_id)` when the site uses a custom list.
- `url` — source: `stats.php:295` — `attr_js("immunizations.php?mode=edit&id=<id>&csrf_token_form=<token>")`. Each row is wrapped in an `<a>` that opens the edit screen via `load_location()`.

So the user sees: a clickable row per immunization, displaying the CVX vaccine label (e.g., "MMR", "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3mL dose"). The administered date is NOT shown in the visible row body — it's only in the SQL's `immunization_data` field which is not actually rendered (the template uses `cvx_text` directly, see `stats.php:289`).

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckCore('patients', 'med')` per the manifest line 67 (gated by the broader medical ACL; `stats.php` itself runs additional checks).
- **Write gate:** N/A on the dashboard card.
- **Issue type:** N/A (resource-typed)

## 4. Hide-card global

- **Key:** — (the manifest table line 67 marks Immunizations as having no hide-card global)
- **Source:** N/A

## 5. Edit / expand affordances

- **Pencil icon click:** the Edit button targets `immunizations.php` (`stats.php:304`) — the full CRUD page.
- **Each row click:** `load_location("immunizations.php?mode=edit&id=<id>")` — opens the row in edit mode.
- **`[]` expand chevron:** toggles via `getUserSetting('immunizations_ps_expand')` (`stats.php:298`)
- **In our React port:** pencil click opens the legacy `immunizations.php` page in a new tab; row clicks are also legacy-bound (or we make rows non-clickable in V1).

## 6. Empty state behavior

- **Legacy renders:** "None{{Immunizations}}" → renders as "None" (`immunizations.html.twig:6`)
- **Trigger:** `imx|length == 0`
- **In our React port:** render "No immunizations recorded." in `<EmptyState />`.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/Immunization?patient=:id&_sort=-date`
- **Verified:** `src/RestControllers/FHIR/FhirImmunizationRestController.php` exists.
- **Field-by-field map:**
  - Legacy `cvx_text` ← FHIR `Immunization.vaccineCode.text` (or `vaccineCode.coding[]` where `system='http://hl7.org/fhir/sid/cvx'` → `.display`)
  - Legacy `administered_date` (in SQL but not rendered) ← FHIR `Immunization.occurrenceDateTime`
  - `status` (legacy not rendered, but useful to add) ← FHIR `Immunization.status` (`completed`/`entered-in-error`/`not-done`) — filter `entered-in-error` client-side (matching the legacy's `added_erroneously = 0` filter).
  - Optional rich fields available on FHIR Immunization that the legacy hides: `lotNumber`, `manufacturer.display`, `route.text`, `site.text`, `doseQuantity`.
- **Bundle handling:** `entry[].resource[]` is the iteration target.
- **FHIR fidelity gaps:** none for our V1 render. FHIR Immunization carries strictly more than the legacy renders (the `immunizations` table has manufacturer, lot number, education date, VIS date, refusal reason, etc., all of which FHIR exposes but the dashboard card hides).

## 8. Notable quirks

- The 71 KB `interface/patient_file/summary/immunizations.php` is a CRUD page — full add/edit/delete UI for immunizations including DOM-rendered tables (`<tr>` rows starting at line 775+) and a date-picker form. We are NOT replicating any of that — V1 React surfaces only the read-side via the FHIR endpoint.
- The dashboard card is **rendered from `stats.php`, not `demographics.php`** — easy to miss. `stats.php` is included by the PatientMenuRole flow; the manifest's `cards` table line 67 noted "linked from `immunizations.php`" but the actual render site is `stats.php:299`.
- The SQL at `stats.php:266` builds an `immunization_data` field that the Twig template never uses — the template renders `cvx_text` directly. Either dead code or the field was intended for an alternate display path.
- The `codes` table join (`stats.php:273`) means immunizations show their CVX-code-text label; if the CVX code is missing the row falls back to the user's note (truncated to 20 chars at SQL line 271). Our React port renders `vaccineCode.text` and accepts whatever OpenEMR puts there.

## 9. Parity decisions for the React port

- **Match:** vaccine label per row, sort by date desc, "no immunizations" empty state.
- **Add (beyond legacy parity):** show `occurrenceDateTime` next to the vaccine name (the legacy SQL fetches it but the template doesn't render it — surfacing it is a clean win). Document as deliberate.
- **Drop:** the per-row click-to-edit affordance, the `mode=edit` URL plumbing.
- **Out-of-scope:** edit views (PRD §2), the full `immunizations.php` CRUD UI, lot-number / manufacturer / VIS-date metadata (V2 stretch), card hiding.
