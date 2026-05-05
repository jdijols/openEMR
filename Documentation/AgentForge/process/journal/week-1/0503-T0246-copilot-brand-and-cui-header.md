---
date: 2026-05-03
topic: Brand rename to Clinical Copilot + CUI header redesign with encounter shortcuts
related_milestone: none
---

# Clinical Copilot brand + CUI header redesign — session journal

## Goal

Two related UX threads in one session: (1) replace every UI-rendered "AgentForge" / "Clinical Co-Pilot" string with "Clinical Copilot" without touching internal code, namespaces, or file paths, and (2) absorb the OpenEMR top patient-strip's per-encounter affordances (Today, Visit History) into the CUI header so the copilot can take over that vertical real estate. Also: fix the Module Manager DB row that still showed the old brand on the live dev install.

## Context

Submission deadline is 2026-05-03 noon CT; this session is surface polish ahead of the cut. "AgentForge" remains the **internal** developer-facing name (PHP namespaces, TS class names, file paths, dev docs all stay) — only end-user UI text changes. The Clinical Copilot ACL gate and module install flow already exist ([process/16](../../milestones/week-1/16-clinical-copilot-acl-role-gate.md)) but the registrar's display fields were write-once, so any stale row on prod/dev would never refresh.

## Key decisions

### Decision: scope rule for the brand replacement

- **Prompt:** "Any text content inside the UI of the application... that reads as 'AgentForge', which is an internal developer-facing name only, or 'Clinical Co-Pilot' must be replaced with 'Clinical Copilot'."
- **Recommendation:** Confirmed scope as UI-rendered strings only — twig templates, module-manager metadata, CUI React text, HTML `<title>`s, GACL ACO labels — and explicitly leave PHP namespaces (`OpenEMR\Modules\AgentForge`), TS class names (`AgentForgeDeliveryError`), file paths (`oe-module-agentforge/`), code comments, and `Documentation/AgentForge/` untouched.
- **Outcome:** 11 files edited across the OpenEMR module + CUI source; bundle rebuilt. Internal references intentionally preserved so the rename is purely cosmetic.

### Decision: module-manager display reads "Clinical Copilot by Jason Dijols"

- **Prompt:** "The module listing still reads 'AgentForge...' when it should read 'Clinical Copilot by Jason Dijols'"
- **Recommendation:** The stale row predated the rename — registrar's `ensureRegistered()` only INSERTed on missing row, never UPDATEd. Split the single MOD_NAME into three constants (MOD_NAME for the Module column, MOD_UI_NAME for Menu Text, MOD_NICK_NAME for Nick Name) and updated `moduleConfig.php` `author` to "Jason Dijols".
- **Outcome:** [AgentForgeModuleRegistrar.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeModuleRegistrar.php) now carries three display constants; one-shot SQL UPDATE applied to dev DB.

### Decision: registrar gains an auto-refresh path with operator-disable precedence

- **Prompt:** "Yes, add that auto refresh logic, please."
- **Recommendation:** New `RegisterOutcome::Refreshed` case + `displayFieldsAreStale()` check that runs *after* the OperatorDisabled branch — admin's explicit disable always wins over a brand refresh (preserves the G6-17 incident-rollback contract). Extended `ModulesRegistryStore` interface with `updateDisplayFields(int $modId, string $modDirectory, array $fields)` and grew `findByDirectory()` return shape to include the four display fields needed for drift detection.
- **Outcome:** 7/7 registrar tests pass (3 new tests for refresh-on-stale, idempotent-on-clean, no-refresh-on-disabled). End-to-end verified via the bin script: inject drift → REFRESHED → re-run → OK Unchanged.

### Decision: composite-PK scoping bug caught mid-flight

- **Prompt:** (Discovered when re-running `bin/agentforge-enable.php` and seeing `Module (Clinical Copilot by Jason Dijols) could not be initialized` from Laminas.)
- **Recommendation:** The `modules` table's PRIMARY KEY is the composite `(mod_id, mod_directory)` — `mod_id` alone is NOT unique. The initial `UPDATE … WHERE mod_id = ?` clobbered an unrelated Laminas fixture row (`Patientvalidation`) that happened to share `mod_id=6`, causing Laminas to try to load a class literally named "Clinical Copilot by Jason Dijols". Re-scoped the UPDATE to `WHERE mod_id = ? AND mod_directory = ?` and restored the Patientvalidation row.
- **Outcome:** [QueryUtilsModulesRegistryStore.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Install/QueryUtilsModulesRegistryStore.php) UPDATE now safe; interface signature updated; test fixtures track `(mod_id, mod_directory)` pairs explicitly.

### Decision: CUI header gains Today + Visit History buttons; OpenEMR top strip auto-collapses

- **Prompt:** "I want to add a second text that reads 'Today'... opens up the current open encounter for this patient. I also want to add a second button to the left of the refresh button in the header [with] a clock icon... [opens] the visit history... I also want the CUI panel to default to the widest width possible... [and] the top section of the open EMR UI to be collapsed by default."
- **Recommendation:** "Today" reuses the existing NAV_REQUEST `kind: 'encounter'` plumbing pointed at `data-bound-encounter-id` (the AppointmentEncounterBinder's pick). New NAV_REQUEST `kind: 'visit_history'` mirrors `topWin.encounterList()` → `/interface/patient_file/history/encounters.php` in the "enc" tab. Default width raised to MAX_WIDTH (600px) only when sessionStorage is empty (preserves sticky width). Top strip (`#attendantData`) collapsed once per session via an `agentforge.attendant.initialized` sessionStorage flag — sticky if user manually re-expands.
- **Outcome:** Header restructured into two columns (left: patient name link + Today; right: visit history + refresh). Bootstrap.php `RAIL_WIDTH_PX` raised to 600 to prevent FOUC. Three new functions in [App.tsx](../../../../../agentforge/cui/src/App.tsx): `requestEncounterNavigation`, `requestVisitHistoryNavigation`, `IconVisitHistory`.

### Decision: Today restyled from text-link to bordered pill button matching icon-button chrome

- **Prompt:** "I actually want to change how the today button works. I actually don't want it to be a text line with an underline. I want it to be a button in the style of the other two buttons, the clock and the refresh."
- **Recommendation:** New `.agentforge-cui__today-button` class duplicates the icon-button chrome (border / background / radius / hover) but auto-width with `padding: 0 var(--af-s2)` and 14px / weight 500 text — matches the optical weight of the 14px icons inside the icon buttons. Title-group switched from `align-items: baseline` → `center` so the bordered button aligns vertically with the patient-name text.
- **Outcome:** All three header actions (Today, Visit History, Refresh) now read as one visual family.

### Decision: header gap rhythm = panel padding (16px), then right-pair tightened to 8px at min width

- **Prompt:** Two passes — first "Make the spacing to the right of the patient name… equal to the spacing that's to the left of it" (panel padding-left = 16px), then "shrink the gap [between refresh and clock]… so that when we're at the smallest width of the CUI panel, the gap between all three buttons is consistent."
- **Recommendation:** First pass: both column-internal gaps set to `var(--af-s4)` (16px) so every header gap (edge↔name, name↔Today, clock↔refresh, refresh↔edge) reads as one rhythm. Second pass: at rail min-width (320px) the title-group fills the row and Today sits flush against the icon group, so a 16px right-pair gap looks visibly larger than the natural Today↔clock proximity — right-pair shrunk to `var(--af-s2)` (8px). Left-pair stays 16px per user's explicit instruction.
- **Outcome:** Verified at 320px viewport — Today→Clock and Clock→Refresh button-edge gaps both 8px.

## Trade-offs and alternatives

- **Move Today into the right-column action group** — would unify all three buttons under one `gap` value, but user's explicit prior spec was "Today belongs in the left column with the patient name", and the bordered-button style change didn't override that.
- **Negative or zero gap between icon buttons** — would more closely match the visual text→icon distance, but invalid CSS / poor UX. 8px button-edge gap is the tight-but-distinct compromise.
- **Rename the `oe-module-agentforge` directory** — would fully purge "agentforge" from the install path, but breaks every PHP namespace, Laminas autoload entry, test fixture, and the Bootstrap event listener wiring. Out of scope for a UI-text rename.
- **Rename the `AGENTFORGE_API_PUBLIC_URL` env var** — appears in a user-facing error string ("Agent API URL is not configured"), but it's a real config identifier; renaming would touch the API + PHP + deploy scripts. Flagged for follow-up, not changed.

## Tools, dependencies, commands

- `cd agentforge/cui && npm run --silent build` — rebuild CUI bundle into `interface/modules/custom_modules/oe-module-agentforge/public/cui/` after every TSX/CSS change (precommit hook also runs this).
- `docker compose -f docker/development-easy/docker-compose.yml exec -T mysql mariadb -uroot -proot openemr -e "..."` — direct DB inspection / one-shot UPDATE during the composite-PK debug.
- `docker compose exec openemr php /var/www/localhost/htdocs/openemr/interface/modules/custom_modules/oe-module-agentforge/bin/agentforge-enable.php` — runs the registrar end-to-end against the live DB; reports `INSERTED` / `REFRESHED` / `OK` / `OperatorDisabled`.
- `composer phpunit-isolated -- --filter "AgentForgeModuleRegistrar"` — isolated registrar test suite (now 7 tests, 33 assertions).

## Files touched

- **Modified — UI strings (brand rename):**
  - `agentforge/cui/index.html`
  - `agentforge/cui/src/App.tsx`
  - `interface/modules/custom_modules/oe-module-agentforge/info.txt`
  - `interface/modules/custom_modules/oe-module-agentforge/moduleConfig.php`
  - `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig`
  - `interface/modules/custom_modules/oe-module-agentforge/templates/header_icon.html.twig`
  - `interface/modules/custom_modules/oe-module-agentforge/public/launch.php`
  - `interface/modules/custom_modules/oe-module-agentforge/public/panel.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeAclInstaller.php`
- **Modified — registrar refresh path + composite-PK fix:**
  - `interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeModuleRegistrar.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Install/ModulesRegistryStore.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Install/QueryUtilsModulesRegistryStore.php`
  - `interface/modules/custom_modules/oe-module-agentforge/bin/agentforge-enable.php`
  - `tests/Tests/Isolated/Modules/AgentForge/AgentForgeModuleRegistrarTest.php`
- **Modified — CUI header redesign + max width + top-strip auto-collapse:**
  - `agentforge/cui/src/App.tsx` (Today + Visit History + IconVisitHistory; header restructured into title-group + header-actions)
  - `agentforge/cui/src/index.css` (today-button, title-group, header-actions classes)
  - `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig` (MAX_WIDTH default, `visit_history` NAV_REQUEST handler, `navigateVisitHistoryInChrome`, `agentforge.attendant.initialized` one-shot collapse)
  - `interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php` (`RAIL_WIDTH_PX` 420 → 600)
- **Regenerated (build artifacts):**
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js`
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css`
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/index.html`
- **DB writes (dev only, not committed):**
  - `modules` row for `mod_directory='oe-module-agentforge'` — display fields refreshed.
  - `modules` row for `mod_directory='Patientvalidation'` — restored after composite-PK clobber.

## Outcomes

- "AgentForge" and "Clinical Co-Pilot" no longer render anywhere in the UI; internal namespaces / classes / paths intact.
- Module Manager shows "Clinical Copilot by Jason Dijols" / "Clinical Copilot" / "clinical-copilot" across the three columns.
- Registrar self-heals stale display fields on every deploy (REFRESHED outcome) without touching `mod_active`, `sql_version`, or `acl_version`; safe under the composite PK.
- CUI header now exposes Today + Visit History as bordered buttons matching the refresh-button family; rail opens at max width on a fresh tab; OpenEMR top patient strip is collapsed by default per session.

## Next steps

- [ ] Run `bin/agentforge-enable.php` against the prod VPS so the prod row gets REFRESHED to the new branding (one-shot, then idempotent).
- [ ] Decide whether `data-bound-encounter-id` should fall back to "patient's most recent open encounter" when no appointment-bound encounter exists (Today link is currently hidden in that case).
- [ ] Consider renaming `AGENTFORGE_API_PUBLIC_URL` env var as a follow-up so the last "AgentForge" reference disappears from the error-message UI.

## Links

- Numbered milestone (if any): _None this session — could fold into a future "G6 polish" entry._
- Related ADR / external doc: [process/milestones/week-1/16-clinical-copilot-acl-role-gate.md](../../milestones/week-1/16-clinical-copilot-acl-role-gate.md) — same brand surface, ACL/role context.
