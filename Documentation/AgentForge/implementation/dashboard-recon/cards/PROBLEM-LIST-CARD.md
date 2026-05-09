# Problem List (Medical Problems) Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 0   |   **Dispatch pattern:** A — Direct Twig

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:1109` (gate) and `:1153–1173` (build view-args + render)
- **Twig template:** `templates/patient/card/medical_problems.html.twig` (24 LoC)
- **PHP card class:** N/A
- **Fragment:** N/A
- **Backing service:** `OpenEMR\Services\PatientIssuesService` — instantiated at `demographics.php:1151`; queried via `search(['lists.pid' => $pid, 'lists.type' => 'medical_problem'])`. Underlying table: `lists` filtered by `type='medical_problem'`. Active filter via `filterActiveIssues()` (`demographics.php:1123–1126`) drops rows with `outcome=1` or expired `enddate`.

## 2. Rendered fields

From `templates/patient/card/medical_problems.html.twig:17–21` — the template renders only:

- `title` — source: `lists.title` (the condition name string, often a SNOMED-CT label)

That's it. The legacy Twig is intentionally minimal — onset date, ICD-10 code, clinical status are NOT rendered in the dashboard card (those appear in the full-list edit screen at `stats_full.php`).

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckIssue('medical_problem')` at `demographics.php:1109`
- **Write gate:** the `Edit` button uses `$btnLink` to navigate to `stats_full.php?active=all&category=medical_problem` (`demographics.php:1168`); the legacy edit screen runs its own ACL.
- **Issue type:** `medical_problem`

## 4. Hide-card global

- **Key:** `card_medicalproblems`
- **Source:** `globals` table where `gl_name = 'hide_dashboard_cards'`; checked at `demographics.php:1109` via `!in_array('card_medicalproblems', $hiddenCards)`

## 5. Edit / expand affordances

- **Pencil icon click:** `return load_location('/interface/patient_file/summary/stats_full.php?active=all&category=medical_problem')` — legacy edit screen
- **`[]` expand chevron:** toggles via `getUserSetting('medical_problem_ps_expand')` (`demographics.php:1162`)
- **In our React port:** pencil click opens the legacy PHP edit screen in a new tab (per PRD §2 — no React edit views in V1)

## 6. Empty state behavior

- **Legacy renders:**
  - When `list|length == 0` and `listTouched == true` → "None{{Issues}}" (the `xlt` filter strips the `{{...}}` translation context, so the user sees "None") (`medical_problems.html.twig:9`)
  - When `list|length == 0` and `listTouched == false` → "Nothing Recorded" (`medical_problems.html.twig:13`)
- **Trigger:** `getListTouch($pid, 'medical_problem')` flag.
- **In our React port:** render "No active problems on file." in `<EmptyState />` — combine the two legacy states since FHIR doesn't expose `listTouched`.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/Condition?patient=:id&category=problem-list-item`
- **Verified:** `src/RestControllers/FHIR/FhirConditionRestController.php` exists. Category constant `'problem-list-item'` confirmed at `src/Services/FHIR/Condition/FhirConditionHealthConcernService.php:51`.
- **Field-by-field map:**
  - Legacy `title` ← FHIR `Condition.code.text` (preferred) OR `Condition.code.coding[0].display` as fallback.
  - Active filter (legacy `outcome != 1`) ← FHIR `Condition.clinicalStatus.coding[0].code === 'active'` (filter client-side; the `?clinical-status=active` query param also works if OpenEMR's controller honors it).
  - Optional render-richer fields available on FHIR Condition that the legacy hides:
    - `onsetDateTime` (date the condition began) — legacy doesn't show this on the card.
    - `recordedDate` (when entered) — legacy doesn't show this on the card.
- **Bundle handling:** `entry[].resource[]` is the iteration target.
- **FHIR fidelity gaps:** none for the title field. The PRD §7 mapping table proposes also rendering `onsetDateTime` and `clinicalStatus` for richer parity — consider this a "stretch" that goes beyond the legacy.

## 8. Notable quirks

- The legacy template's "None{{Issues}}" string is the OpenEMR translation pattern: the `xlt` filter strips the `{{Issues}}` context marker, so the rendered text is just "None". This is OpenEMR's i18n disambiguation convention, not a bug.
- The legacy splits Medical Problems and Health Concerns into two separate cards by `lists.type`, NOT by FHIR category. See `HEALTH-CONCERNS-CARD.md` for how this maps onto FHIR's `Condition.category` field.

## 9. Parity decisions for the React port

- **Match:** condition title, active-only filter, "no problems" empty state.
- **Add (beyond legacy parity):** onset date and clinical-status pill — both are first-class on FHIR Condition and add clinical value at near-zero cost. Document this as a deliberate "we exceeded legacy parity here" decision in `PARITY-NOTES.md`.
- **Drop:** the `listTouched` two-state empty copy — FHIR can't surface it.
- **Out-of-scope:** edit views (PRD §2), card hiding (V2).
