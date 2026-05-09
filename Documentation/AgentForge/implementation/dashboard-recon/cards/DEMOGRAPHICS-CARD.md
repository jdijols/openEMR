# Demographics Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 1   |   **Dispatch pattern:** B — PHP Card class, registered to `SectionEvent('primary')`

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:1351–1352` registers the card via `$sectionRenderEvents->addCard(new DemographicsViewCard($result, $result2, ['dispatcher' => $ed]))`. The card is then iterated and rendered by the `foreach ($sectionCards as $card)` loop at `:1368–...`.
- **Twig template:** `templates/patient/card/demographics.html.twig` (10 LoC) wraps `templates/patient/card/tab_base.html.twig` — the actual fields are rendered by Smarty `tabRow('DEM', result, result2)` and `tabData('DEM', result, result2)` macros. (Note: the `DemographicsViewCard::TEMPLATE_FILE` constant points to `tab_base.html.twig` directly — see `DemographicsViewCard.php:22`.)
- **PHP card class:** `src/Patient/Cards/DemographicsViewCard.php` (79 LoC)
- **Backing data:** `$result = getPatientData($pid, "*, DATE_FORMAT(DOB,'%Y-%m-%d') as DOB_YMD")` (`demographics.php:363`) — selects the entire `patient_data` row. `$result2 = getEmployerData($pid)` (`demographics.php:365`) — joins to `employer_data`. Both are passed into the card constructor.

## 2. Rendered fields

The Demographics card renders the full `patient_data` row in tabs (DEM tab + employer + emergency contact tabs). For our React port, we render the fields the FHIR `Patient` resource exposes — a subset of what the legacy shows but the clinically useful ones:

- `name` — `patient_data.fname` + `mname` + `lname` (also `nickname`, `pubpid`)
- `DOB` — `patient_data.DOB`
- `sex` / `gender_identity` — `patient_data.sex` + `gender_identity`
- `street`, `city`, `state`, `postal_code`, `country_code` — patient address
- `phone_home`, `phone_cell`, `phone_biz` — contact phone numbers
- `email` (and `email_direct`)
- `language` — `patient_data.language`
- `race`, `ethnicity` — demographics
- `marital_status` — `patient_data.status`
- `pubpid` — MRN (also surfaced in the patient header)
- `ss` — social security number (legacy renders this; we DROP for PHI hygiene)

## 3. Permission checks (ACL)

- **Read gate:** `$opts['acl'] = ['patients', 'demo']` (`DemographicsViewCard.php:35`) — checked in the dispatcher loop at `demographics.php:1370` via `AclMain::aclCheckCore('patients', 'demo')`.
- **Write gate:** `AclMain::aclCheckCore('patients', 'demo', '', 'write')` (`DemographicsViewCard.php:60`) — controls Edit affordance.
- **Issue type:** N/A (resource-typed)

## 4. Hide-card global

- **Key:** — (Demographics is not in the manifest's hide-card list; `manifest.md` line 65 marks it as "always renders")
- **Source:** N/A. The card always renders if ACL passes.

## 5. Edit / expand affordances

- **Pencil icon click:** `btnLink => 'demographics_full.php'` (`DemographicsViewCard.php:38`) with `linkMethod => 'html'` — navigates to the full demographics edit page.
- **`[]` expand chevron:** toggles via `getUserSetting('demographics_ps_expand')` (`DemographicsViewCard.php:42`)
- **In our React port:** pencil click opens `/interface/patient_file/summary/demographics_full.php` in a new tab.

## 6. Empty state behavior

- **Legacy renders:** N/A — every patient has a `patient_data` row by definition; the card always has content.
- **Trigger:** N/A.
- **In our React port:** if FHIR `Patient/:id` returns 404, the page-level error boundary handles it. The card itself does not need an empty state.

## 7. FHIR mapping

- **Endpoint:** reuse the `Patient` resource fetched for the header (`GET /apis/default/fhir/Patient/:id`) — no additional fetch needed.
- **Verified:** `src/RestControllers/FHIR/FhirPatientRestController.php` exists.
- **Field-by-field map:**
  - `name` ← `Patient.name[0].family` + `Patient.name[0].given.join(' ')`
  - `DOB` ← `Patient.birthDate` (ISO `YYYY-MM-DD`)
  - `gender` ← `Patient.gender` (FHIR enum `male`/`female`/`other`/`unknown`)
  - `address` ← `Patient.address[0]` — `.line[0]`, `.city`, `.state`, `.postalCode`, `.country`
  - `phone_home` ← `Patient.telecom[]` where `system='phone'` AND `use='home'` → `.value`
  - `phone_cell` ← `Patient.telecom[]` where `system='phone'` AND `use='mobile'`
  - `email` ← `Patient.telecom[]` where `system='email'` → `.value`
  - `language` ← `Patient.communication[0].language.text` (or `.coding[0].display`)
  - `race` ← `Patient.extension[]` where `url='http://hl7.org/fhir/us/core/StructureDefinition/us-core-race'` (US Core extension; nested `valueCoding`)
  - `ethnicity` ← `Patient.extension[]` where `url='...us-core-ethnicity'`
  - `marital_status` ← `Patient.maritalStatus.coding[0].display`
  - `MRN` ← `Patient.identifier[]` where `type.coding[0].code='PT'` (see `PATIENT-HEADER.md` for the system constant)
- **Bundle handling:** N/A — single resource.
- **FHIR fidelity gaps:**
  - SSN — emitted as a separate `identifier` with `type.coding[0].code='SS'`; we deliberately DROP for PHI hygiene per W2 anti-success criterion D2.
  - `gender_identity` (separate from `sex`) — OpenEMR's FHIR likely doesn't surface this distinct concept; FHIR R4 gender is a single field. Drop in V1.
  - Employer data (`patient_data` JOIN to `employer_data`) — not part of FHIR `Patient`. The legacy renders this in the EMP tab; we drop.
  - Emergency contact — also not part of FHIR `Patient`; could query `RelatedPerson?patient=:id` but drop in V1.

## 8. Notable quirks

- `DemographicsViewCard.php:22` sets `TEMPLATE_FILE = 'patient/card/tab_base.html.twig'` — bypassing `demographics.html.twig`, the wrapper. Both templates are functionally equivalent for the dashboard's purposes (one extends the other).
- The `tabRow()` and `tabData()` macros are defined in `templates/patient/macros/` and run Smarty-bridged code that pulls from `patient_data` columns directly. Our React port avoids this entirely — we render structured fields from the FHIR resource.
- The card was annotated as "expensive functions" (`DemographicsViewCard.php:51`) — `getTemplateVariables()` is deliberately lazy so the data isn't fetched until needed. Our React port has the same property since we fetch via `useFhirQuery`.

## 9. Parity decisions for the React port

- **Match:** name, DOB, gender, address, phone, email, language, race, ethnicity, marital status, MRN.
- **Drop:** SSN (PHI hygiene), employer data, emergency contact (not in FHIR Patient — would need `RelatedPerson` fetch), the multi-tab edit affordance.
- **Out-of-scope:** edit views (PRD §2), the full DEM/EMP/CON/STA tabbed editor, card hiding (V2).
