# Medications Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 0   |   **Dispatch pattern:** A — Direct Twig

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:1110` (gate) and `:1175–1195` (build view-args + render)
- **Twig template:** `templates/patient/card/medication.html.twig` (26 LoC)
- **PHP card class:** N/A
- **Fragment:** N/A
- **Backing service:** `OpenEMR\Services\PatientIssuesService` — `search(['lists.pid' => $pid, 'lists.type' => 'medication'])`. Underlying table: `lists` filtered by `type='medication'`. Active filter via `filterActiveIssues()` (`demographics.php:1123–1126`).

## 2. Rendered fields

From `templates/patient/card/medication.html.twig:17–22` — each list row renders two text fragments side-by-side:

- `title` — source: `lists.title` (medication name; rendered with `font-weight-normal`)
- `drug_dosage_instructions` — source: `lists.comments` mapped through to `drug_dosage_instructions` by `PatientIssuesService` (the sig / dosage instructions string)

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckIssue('medication')` at `demographics.php:1110`
- **Write gate:** the `Edit` button uses `$btnLink` to navigate to `stats_full.php?active=all&category=medication` (`demographics.php:1190`); the legacy edit screen runs its own ACL.
- **Issue type:** `medication`

## 4. Hide-card global

- **Key:** `card_medication`
- **Source:** `globals` table where `gl_name = 'hide_dashboard_cards'`; checked at `demographics.php:1110` via `!in_array('card_medication', $hiddenCards)`

## 5. Edit / expand affordances

- **Pencil icon click:** `return load_location('/interface/patient_file/summary/stats_full.php?active=all&category=medication')` — legacy edit screen
- **`[]` expand chevron:** toggles via `getUserSetting('medication_ps_expand')` (`demographics.php:1184`)
- **In our React port:** pencil click opens the legacy PHP edit screen in a new tab (per PRD §2 — no React edit views in V1)

## 6. Empty state behavior

- **Legacy renders:**
  - When `list|length == 0` and `listTouched == true` → "None{{Issues}}" → renders as "None" (`medication.html.twig:9`)
  - When `list|length == 0` and `listTouched == false` → "Nothing Recorded" (`medication.html.twig:13`)
- **Trigger:** `getListTouch($pid, 'medication')` flag.
- **In our React port:** render "No active medications on file." in `<EmptyState />`.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/MedicationRequest?patient=:id&intent=order&status=active`
- **Verified:** `src/RestControllers/FHIR/FhirMedicationRequestRestController.php` exists.
- **Field-by-field map:**
  - Legacy `title` ← FHIR `MedicationRequest.medicationCodeableConcept.text` (or `.coding[0].display`).
  - Legacy `drug_dosage_instructions` ← FHIR `MedicationRequest.dosageInstruction[0].text` (FHIR provides a free-text sig field that maps to the legacy's `comments` column).
  - Active filter (legacy `outcome != 1`) ← FHIR query param `status=active`.
- **Bundle handling:** `entry[].resource[]` is the iteration target.
- **FHIR fidelity gaps:** none for the two rendered fields. FHIR exposes much more — `dosageInstruction[0].timing`, `.route`, `.doseAndRate` — but the legacy card concatenates all of that into `dosage_instructions` text upstream, so we can either render `dosageInstruction[0].text` verbatim (parity) or break it into structured fragments (richer).

## 8. Notable quirks

- This is a **distinct card** from Prescriptions. Medications come from `lists` (the issue/problem-list family), Prescriptions come from `prescriptions` (a separate table backed by the prescription Controller). FHIR collapses both into `MedicationRequest` — see `PRESCRIPTIONS-CARD.md` for the relationship.
- The legacy uses `lists.comments` as the dosage-instructions field. This is how OpenEMR stuffs unstructured sig text into the issue-list family; our `MedicationRequest` lookup goes through the proper sig field (`dosageInstruction[0].text`), which is cleaner.

## 9. Parity decisions for the React port

- **Match:** drug name + dosage-instructions sig text, active-only filter, "no medications" empty state.
- **Drop:** the `listTouched` two-state empty copy.
- **Out-of-scope:** edit views (PRD §2), card hiding (V2).
- **Note:** since FHIR `MedicationRequest` covers both Medications and Prescriptions, the React Medications card and Prescriptions card differ by query param (`status=active` vs no status filter, sorted by `authoredOn`) — they share Zod schema and the FHIR client.
