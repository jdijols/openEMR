# Care Team Card — Reverse Engineering

> Phase 0 PD-02 output. Source treated as read-only artifact. Companion to [`../manifest.md`](../manifest.md).
>
> **Tier:** 0   |   **Dispatch pattern:** B — PHP Card class

## 1. Source mapping

- **Dispatcher entry:** `interface/patient_file/summary/demographics.php:1264–1288` — instantiates `new CareTeamViewCard($pid, ['dispatcher' => $ed])`, reads `$card->getAcl()`, then `echo $t->render($card->getTemplateFile(), array_merge($viewArgs, $card->getTemplateVariables()))`.
- **Twig template:** `templates/patient/card/manage_care_team.html.twig` (chosen by `CareTeamViewCard::TEMPLATE_FILE`) — this is a feature-rich edit screen embedded inline; for V1 we only consume the read-side data.
- **PHP card class:** `src/Patient/Cards/CareTeamViewCard.php` (390 LoC)
- **Fragment:** N/A
- **Backing services:**
  - `OpenEMR\Services\CareTeamService::getCareTeamData($pid)` — returns `['team_id' => …, 'team_name' => …, 'team_status' => …, 'members' => [...]]`
  - `OpenEMR\Services\CareTeamService::hasActiveCareTeam($pid)` — boolean used in `templateVars['hasActiveTeam']` (`CareTeamViewCard.php:119`)
  - `OpenEMR\Services\ContactService` + `ContactRelationService` — pull related-persons (USCDI v5 enrichment)
  - `OpenEMR\Services\ListService::getOptionsByListName('care_team_roles')` and `'Care_Team_Status'` — populate role / status dropdown options
  - Direct SQL at `CareTeamViewCard.php:201` queries `users` joined to `list_options` for physician-type lookup; SQL at `:219` queries `facility` (service or billing locations).

## 2. Rendered fields

The Care Team card surfaces a "Care Team" with a list of members. Each member (from `getCareTeamData()['members']`, see `CareTeamViewCard.php:166–182`) carries:

- `member_type` — `'user'` (provider) or `'contact'` (related person) — drives a colored badge
- `user_id` / `contact_id` — FK to either `users` or `contact` table
- `role` — option_id from `care_team_roles` list (e.g., "PCP", "Cardiologist")
- `role_display` (pulled separately from `list_options.title`)
- `facility_id` + `facility_display`
- `provider_since` — date the role started
- `status` — option_id from `Care_Team_Status` (e.g., active, inactive, proposed)
- `note` — free-text member note
- `user_name` — assembled from `users.fname` + `lname`
- `contact_name` — for related-person rows
- `contact_relationship` — relationship label
- `physician_type` + `physician_type_code` — provider-type metadata

In the read-only view (which is what our React card mirrors), the visible row body is essentially: badge + name + role + facility + status. Notes hidden by default.

Plus team-level fields:

- `team_name` — string (default `'default'` per `CareTeamViewCard.php:163`)
- `team_status` — option_id (e.g., `'active'`, mapped to badge classes at `CareTeamViewCard.php:319–328`)
- `team_status_display` — human label

## 3. Permission checks (ACL)

- **Read gate:** `$card->getAcl()` returns `['patients', 'demo']` (`CareTeamViewCard.php:89`); checked at `demographics.php:1283` via `AclMain::aclCheckCore('patients', 'demo')`.
- **Write gate:** `AclMain::aclCheckCore('patients', 'demo', '', 'write')` (`CareTeamViewCard.php:86`) — controls Edit affordance.
- **Issue type:** N/A (resource-typed)

## 4. Hide-card global

- **Key:** `card_care_team`
- **Source:** `globals` table where `gl_name = 'hide_dashboard_cards'`; checked at `demographics.php:1264` via `!in_array('card_care_team', $hiddenCards)`

## 5. Edit / expand affordances

- **Pencil icon click:** the card is itself the edit screen — `btnLink => "javascript:void(0);"` (`CareTeamViewCard.php:102`) plus `btnClass => 'btn-edit-care-team'` toggles inline edit mode via the JS in `manage_care_team.html.twig:9–21` (`toggleEditMode()`).
- **`[]` expand chevron:** toggles via `getUserSetting('careteam_ps_expand')` (`CareTeamViewCard.php:85`)
- **In our React port:** pencil click opens the legacy `demographics.php` (or a dedicated care-team edit URL) in a new tab — we don't reproduce inline edit (PRD §2).

## 6. Empty state behavior

- **Legacy renders:** the `manage_care_team.html.twig` template still mounts when there are no members — it just shows an empty table. The `hasActiveTeam` flag (`CareTeamViewCard.php:119`) hints whether to show "no active team" copy, but the template logic for it isn't visible in the first 60 lines.
- **Trigger:** `existing_care_team` array is empty.
- **In our React port:** render "No care team members assigned." in `<EmptyState />` per the PRD §5 acceptance copy.

## 7. FHIR mapping

- **Endpoint:** `GET /apis/default/fhir/CareTeam?patient=:id`
- **Verified:** `src/RestControllers/FHIR/FhirCareTeamRestController.php` exists.
- **Field-by-field map:**
  - Team-level legacy `team_status` ← FHIR `CareTeam.status` (`active`/`inactive`/`proposed`/`entered-in-error`/`suspended`)
  - Team-level legacy `team_name` ← FHIR `CareTeam.name`
  - Per-member legacy `user_name` / `contact_name` ← FHIR `CareTeam.participant[].member.display` (the `member` reference's `.display` is the practitioner / related-person name string)
  - Per-member legacy `role_display` ← FHIR `CareTeam.participant[].role[0].text` or `.coding[0].display`
  - Per-member legacy `member_type` ← derived from FHIR `CareTeam.participant[].member.reference` prefix (`Practitioner/...` vs `RelatedPerson/...`)
- **Bundle handling:** `entry[].resource[]` — typically a single CareTeam resource per patient, but iterate the bundle in case multiple teams are configured.
- **FHIR fidelity gaps:**
  - `physician_type_code` (legacy USCDI v5 SNOMED metadata) — not first-class on FHIR `CareTeam`; would need to follow the `member.reference` to the `Practitioner` resource and read its `qualification`. Drop in V1.
  - `provider_since` and per-member `note` — not standard on FHIR `CareTeam.participant`. Drop in V1.

## 8. Notable quirks

- The legacy `CareTeamViewCard` carries massive edit-mode plumbing in `getFormManagementData()` (`CareTeamViewCard.php:158–388`) — option strings, related-person dropdowns, status badges. Our React read-only card touches almost none of this; we only consume `members[].user_name|contact_name|role|status`.
- The card is one of the few that bundles a POST handler: `handleFormSubmission()` at `CareTeamViewCard.php:124` runs on every dashboard render to catch save submissions. Since our React port never POSTs to `demographics.php`, this is effectively dead code from our perspective.
- Comments throughout the file mark "AI-generated" sections (lines 184, 269, 309, 339, 350, 365, 376, 384) — the related-persons integration was added with AI assistance per the docblock at `:9`. Worth noting for stability — this code is newer than most of the dashboard.
- **Open question:** sparse demo data is expected per `manifest.md` line 129. What does an empty `CareTeam` Bundle look like? Confirm during PD-31 smoke against Margaret Chen's chart — likely an empty `entry[]` array.

## 8a. Visual ground truth (PD-00)

**Captures:**
- Filled state: `Care team filled view.png`
- Edit affordance: `Care team edit view.png`
- Empty-card context: `Patient dashboard, cards expanded w: data 1.png` (Care Team header with empty table headers below)

### Filled-state dashboard render

The legacy renders Care Team as a TABLE inside the dashboard card itself (not a click-to-expand). Sofia Reyes has one team member:

```
Care Team []                                                                              [pencil]
Great Clinic [Active green pill]

Type             Member                  Role                  Facility       Since        Status   Note   Remove
[Provider blue]  Lee, Donna (physician)  Primary Care Provider Great Clinic   2026-05-08   Active
```

Columns visible: **Type** (pill: `Provider`), **Member** (`Lee, Donna (physician)`), **Role** (`Primary Care Provider`), **Facility** (`Great Clinic`), **Since** (date), **Status** (`Active`), **Note**, **Remove**.

**Above the table:** a clinic-name banner with team-level status pill (`Great Clinic [Active]`) — this is the *care-team grouping container*, NOT a row. Maps to FHIR `CareTeam.name` + `CareTeam.status`.

### Empty-state render

`Patient dashboard, cards expanded w: data 1.png` shows the same Care Team card with column headers visible but no data rows. Our React port replaces the empty-headers shape with explicit `<EmptyState>No care team members assigned.</EmptyState>` for clarity (see `PARITY-NOTES.md` §6).

### Implications for the React port

- Render as a TABLE on the dashboard, not a bullet list — matches legacy structure.
- Drop **Remove** column (out-of-scope for V1, edit-only).
- Drop **Note** column unless we surface the FHIR data (sparse on R4 `CareTeam.participant`).
- Group rows by care-team grouping (`CareTeam.name` + `CareTeam.status`) — render the team-level banner with status pill above the table.

## 9. Parity decisions for the React port

- **Match:** member name + role + facility + status, team-level name banner with status pill, member-type badge (provider vs related-person), "no team" empty state, table layout (not bullet list).
- **Drop:** inline edit affordances, **Remove** column (V1 read-only), **Note** column (sparse FHIR data), `physician_type_code` SNOMED metadata, `provider_since` (not standard on FHIR R4), per-member notes — none have clean FHIR mappings.
- **Out-of-scope:** edit views (PRD §2), card hiding (V2), USCDI v5 codes.
