# Allergies Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 0   |   **Dispatch pattern:** A — Direct Twig

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:1108` (gate) and `:1129–1149` (build view-args + render)
- **Twig template:** `templates/patient/card/allergies.html.twig` (52 LoC)
- **PHP card class:** N/A
- **Fragment:** N/A
- **Backing service:** `OpenEMR\Services\AllergyIntoleranceService` — `getAll(['lists.pid' => $pid])` returns issue rows from the `lists` table where `type='allergy'`. Wrapped through `filterActiveIssues()` (`demographics.php:1123–1126`) to drop rows with `outcome=1` (resolved) or past `enddate`.

## 2. Rendered fields

From `templates/patient/card/allergies.html.twig:38–49` — each list row renders:

- `title` — source: `lists.title` (the allergen name string)
- `severity_al` — source: `lists.severity_al` (a list-option key); used for the row's CSS class — rows with severity in `["severe", "life_threatening_severity", "fatal"]` get `bg-warning font-weight-bold` highlighting
- `_severity` (display label) — `getListItemTitle('severity_ccda', l.severity_al)` — looks up the human-readable label from the `severity_ccda` list_options
- `reaction_title` — source: `lists.reaction` joined to `list_options` (rendered as a `title` HTML tooltip only, not in the visible row body)

Visible row body is: `{title} ({severityLabel})` — the reaction shows on hover only.

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckIssue('allergy')` at `demographics.php:1108`
- **Write gate:** the `Edit` button uses `$btnLink` to navigate to `stats_full.php?active=all&category=allergy` (`demographics.php:1144`); the legacy edit screen runs its own ACL.
- **Issue type:** `allergy`

## 4. Hide-card global

- **Key:** `card_allergies`
- **Source:** `globals` table where `gl_name = 'hide_dashboard_cards'`; checked at `demographics.php:1108` via `!in_array('card_allergies', $hiddenCards)`

## 5. Edit / expand affordances

- **Pencil icon click:** `return load_location('/interface/patient_file/summary/stats_full.php?active=all&category=allergy')` — legacy edit screen
- **`[]` expand chevron:** toggles via `getUserSetting('allergy_ps_expand')` (`demographics.php:1138`)
- **In our React port:** pencil click opens the legacy PHP edit screen in a new tab (per PRD §2 — no React edit views in V1)

## 6. Empty state behavior

- **Legacy renders:**
  - When `list|length == 0` and `listTouched == true` → "No Known Allergies" (`allergies.html.twig:30`)
  - When `list|length == 0` and `listTouched == false` → "Nothing Recorded" (`allergies.html.twig:34`)
- **Trigger:** `getListTouch($pid, 'allergy')` returns whether the user has ever explicitly recorded a state for this list (i.e., NKA was clicked).
- **In our React port:** mirror "No Known Allergies" as the default empty copy in `<EmptyState />` since FHIR doesn't expose the `listTouched` flag directly.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/AllergyIntolerance?patient=:id`
- **Verified:** `src/RestControllers/FHIR/FhirAllergyIntoleranceRestController.php` exists.
- **Field-by-field map:**
  - Legacy `title` ← FHIR `AllergyIntolerance.code.text` (or `code.coding[0].display` as fallback)
  - Legacy `severity_al` (label) ← FHIR `AllergyIntolerance.criticality` (`low`/`high`/`unable-to-assess`) OR `reaction[0].severity` (`mild`/`moderate`/`severe`) — FHIR splits "criticality" (overall) from per-reaction "severity"; pick `criticality` for the row label.
  - Legacy `reaction_title` (tooltip) ← FHIR `reaction[].manifestation[].text` (or `.coding[0].display`) — comma-join multiple manifestations.
  - Active filter (legacy `outcome != 1`) ← FHIR `clinicalStatus.coding[0].code === 'active'` (filter client-side).
- **Bundle handling:** `entry[].resource[]` is the iteration target.
- **FHIR fidelity gaps:**
  - The legacy's `severity_ccda` list-option labels (e.g., `life_threatening_severity`) don't map cleanly to FHIR's three-value `criticality` enum — we lose the granular distinction between "severe" and "fatal". Render the FHIR criticality verbatim and note this limitation in `PARITY-NOTES.md`.

## 8. Notable quirks

- The "critical row floats to top" behavior described in the Twig docblock comment (`allergies.html.twig:5–9`) is **not actually implemented** in this template — the comment claims severe/life-threatening/fatal allergies are pinned to the top, but the loop at `:39–49` iterates the list as-is. The CSS highlight is applied, but no reordering happens. We can implement client-side sort (`criticality === 'high'` first) in React to match the documented intent.
- `filterActiveIssues()` is defined inline at `demographics.php:1123` and reused by Medical Problems and Medications. It's not a service method; the dispatcher does its own filtering.

## 8a. Visual ground truth (PD-00)

**Captures:**
- Dashboard card: `Patient dashboard, cards expanded w: data 1.png` (top-left position)
- Detail/expanded view: `Allergies view.png` (clicking the card title routes to "Patient Issues" tab)

**Dashboard card render** for Sofia Reyes (1 active allergy):
```
Allergies []                                                [pencil]
Ibuprofen [Severe yellow pill]
```
Compact: name + severity pill, one row per allergy.

**Detail/expanded view** (Patient Issues → Allergies):
```
[ ] Allergies                                                       + Add
▼  Ibuprofen (Active)  ⓘ                          [Severe]  Occurrence: Unknown or N/A
   Last Modified | Verification | Comments
   2026-05-08    |     ⓘ        | GI bleed
```
Full field set: name, status (Active), info icon, severity pill, Occurrence, Last Modified, Verification icon, Comments. We render only the dashboard subset (name + severity) in V1.

**Severity rendering observation:** the legacy renders the "Severe" pill in **yellow** regardless of value. Our React port color-codes by severity — see `PARITY-NOTES.md` §7 item 9. Documented as deliberate.

**Click affordance:** clicking the card title navigates to the "Patient Issues" tab (full app routing), NOT a modal. The pencil icon goes to the same place. In our React port, both link out to the legacy URL in a new tab.

## 9. Parity decisions for the React port

- **Match:** allergen name, severity label, reaction tooltip, critical-row CSS highlight, "No Known Allergies" empty state, sorting critical entries first (honoring the legacy's documented intent even though the legacy code skips the sort).
- **Drop:** the `listTouched` two-state empty copy — FHIR can't surface it.
- **Improve:** color-code severity pill (red / amber / slate / zinc by criticality) — legacy renders yellow regardless.
- **Out-of-scope:** edit views (PRD §2), card hiding (V2).
