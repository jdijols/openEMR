# Health Concerns Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 1   |   **Dispatch pattern:** A — Direct Twig (Condition resource with `category=health-concern`)

## 1. Source mapping

- **Dispatcher entry:** the legacy `demographics.php` does NOT render a separate "Health Concerns" card. Health Concerns are stored in the same `lists` table as Medical Problems but with `lists.type='health_concern'` (verified at `interface/patient_file/summary/add_edit_issue.php:452, 922`). The legacy dashboard exposes them via the issue-list edit screens (`stats_full.php` with the appropriate `category` query param), not as a top-level dashboard card.
- **Twig template:** there is no dedicated Health Concerns template — `templates/patient/card/medical_problems.html.twig` is the same shape and would be reused if the legacy ever added the card.
- **PHP card class:** N/A
- **Backing service:** for FHIR, `OpenEMR\Services\FHIR\Condition\FhirConditionHealthConcernService` (`src/Services/FHIR/Condition/FhirConditionHealthConcernService.php`). Note `:51–52`: `CATEGORY_PROBLEM_LIST = 'problem-list-item'` and `CATEGORY_HEALTH_CONCERN = 'health-concern'` are sibling categories of the same FHIR `Condition` resource. The service maps the FHIR category back to OpenEMR's `lists.type='health_concern'` filter at `:146`: `$openEMRSearchParameters['type'] = new StringSearchField('type', ['health_concern'], SearchModifier::EXACT)`.

## 2. Rendered fields

Since the legacy doesn't render this as a top-level dashboard card, we don't have a Twig template defining the field set. We mirror the Medical Problems card's field set (since it's the same `lists` table, just with `type='health_concern'`):

- `title` — source: `lists.title` (the health concern statement, often a SNOMED-CT label or free-text concern)
- (legacy detail page additionally shows): `health_concern_subtype` and `health_concern_subtype_title` — see `FhirConditionHealthConcernService.php:167–184`. These map to the SDOH (Social Determinants of Health) sub-categories: SDOH, functional-status, disability-status, cognitive-status, treatment-intervention-status, care-experience-preference (per the `supportsCategory()` enum at `:88–99`).

## 3. Permission checks (ACL)

- **Read gate:** `AclMain::aclCheckIssue('medical_problem')` — Health Concerns share the medical-problem ACL gate at the issue-list level. (No separate ACL key for health-concern.)
- **Write gate:** N/A on dashboard — edits via `add_edit_issue.php` legacy form.
- **Issue type:** `medical_problem` (legacy) / `'health_concern'` (FHIR category)

## 4. Hide-card global

- **Key:** — (no dedicated hide-card key; legacy doesn't ship a Health Concerns dashboard card so there's nothing to hide)
- **Source:** N/A

## 5. Edit / expand affordances

- **Pencil icon click:** would link to `stats_full.php?active=all&category=health_concern` (mirroring the Medical Problems pattern at `demographics.php:1168`)
- **`[]` expand chevron:** would toggle via `getUserSetting('health_concern_ps_expand')` if implemented
- **In our React port:** pencil click opens the legacy edit screen (parametrized for health-concern category) in a new tab.

## 6. Empty state behavior

- **Legacy renders:** N/A (no dashboard card)
- **Trigger:** empty FHIR Bundle entry array
- **In our React port:** render "No health concerns recorded." in `<EmptyState />`

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/Condition?patient=:id&category=health-concern`
- **Verified:** `FhirConditionHealthConcernService.php:52` defines `CATEGORY_HEALTH_CONCERN = 'health-concern'`. `supportsCategory()` at `:88` accepts the value.
- **Field-by-field map:**
  - `title` ← FHIR `Condition.code.text` (or `code.coding[0].display`)
  - `category` ← FHIR `Condition.category[].coding[]` where `system='http://terminology.hl7.org/CodeSystem/condition-category'` AND `code='health-concern'` (the `system` constant is `CATEGORY_SYSTEM` at `FhirConditionHealthConcernService.php:50`).
  - `clinicalStatus` ← `Condition.clinicalStatus.coding[0].code` — filter to `active` client-side.
  - `health_concern_subtype` (SDOH sub-category) ← `Condition.category[].coding[]` where `system` matches one of the US Core observation-category systems (`FhirConditionHealthConcernService.php:308–320`).
  - `onsetDateTime` — date the concern was first recorded.
- **Bundle handling:** `entry[].resource[]` is the iteration target. Filter by `resource.category[].coding[].code === 'health-concern'` if the server returns mixed categories.
- **FHIR fidelity gaps:** none for our V1 render. The SDOH sub-category enrichment (sdoh / functional-status / disability-status / cognitive-status / etc.) is fully exposed via FHIR — we just don't render it in V1.

## 8. Notable quirks

- **Critical recon finding:** the legacy OpenEMR dashboard does NOT distinguish "Health Concerns" from "Problem List" as separate visible cards on `demographics.php`. They are different `lists.type` values that are edited separately via the issue-list screens, but neither has a dedicated dashboard widget the way Medical Problems does. The PRD adds Health Concerns as a Tier-1 deliverable because FHIR `Condition?category=health-concern` exists and is a clean addition; the React port surfaces it as a separate card the legacy doesn't have.
- The FHIR service file extensively comments AI-generated code (`FhirConditionHealthConcernService.php` docblock at line 9–10: "Public Domain for portions marked as AI Generated which were created with the assistance of Claude.AI and Microsoft Copilot"). Worth noting for stability.
- **Recommendation:** since Health Concerns and Problem List share field shape and Twig template (`medical_problems.html.twig`) and differ only in FHIR category param, the React port should implement a single `<ConditionCard>` component parametrized by category, mounted twice in `<PatientDashboardPage>` — once with `category=problem-list-item`, once with `category=health-concern`. This avoids code duplication.

## 9. Parity decisions for the React port

- **Match:** condition title, active-only filter (matching the Medical Problems treatment).
- **Add (beyond legacy parity):** dedicated dashboard card the legacy doesn't have. Document as deliberate in `PARITY-NOTES.md`.
- **Drop:** SDOH sub-category enrichment in V1 (V2 stretch).
- **Out-of-scope:** edit views (PRD §2), card hiding (V2).
- **Implementation:** share a single `<ConditionCard>` component with Problem List, parametrized by category — see `PROBLEM-LIST-CARD.md` §9.
