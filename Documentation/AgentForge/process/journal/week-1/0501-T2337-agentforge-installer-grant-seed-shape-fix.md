---
date: 2026-05-01
topic: Donna Lee Clinical Copilot missing — ACL installer group row shape
related_milestone: process/milestones/week-1/16-clinical-copilot-acl-role-gate.md
---

# Donna Lee Clinical Copilot missing — ACL installer grant seed bug

## Goal

Explain and record why demo user **Donna Lee** (`username`: `physician`) saw **no Clinical Copilot chrome** despite belonging to **Physicians** in GACL, and document the fix so default **`agentforge` / `use`** (and **`propose_write`**) grants actually seed for stock clinical groups.

## Symptom

- Logged in as **physician** (Donna Lee): header/rail Copilot UI absent.
- **Not** “wrong username”: she was active, authorized, and `AclExtended::aclGetGroupTitles()` returned **`["Physicians"]`**.
- `AclMain::aclCheckCore('patients', 'demo', 'physician')` passed; `AclMain::aclCheckCore('agentforge', 'use', 'physician')` failed.

## Root cause

`AgentForgeAclInstaller::ensureDefaultAclGrants()` calls `GaclApi::get_group_data($groupId)`. In practice OpenEMR returns the **legacy numeric row** `[id, parent_id?, value?, display_name, …]`. The installer read **`$row['name']`** for the display name passed to **`search_acl()`** before **`add_acl()`**. That key does not exist on the returned array, so the display name was always empty and the installer **skipped** default grant insertion for **`admin`**, **`doc`**, **`clin`**, **`breakglass`**.

Evidence on dev DB **before** fix: **`gacl_aco`** contained **`agentforge`** objects (`use`, `propose_write`, `module_admin`) but **`gacl_acl`** had **no** rows with notes **`AgentForge default entitlement …`**.

Misleading hypothesis discarded: Donna was already in GACL Physicians; the defect was installer logic, not user group membership alone.

## Fix

- **`groupDisplayName` helper:** resolve display name from **`$row[3]`** first, **`$row['name']`** as fallback (`interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeAclInstaller.php`).
- **`get_group_id`:** single-argument **`$gacl->get_group_id($groupValue)`** aligned with **`GaclApi`** usage in this codebase.
- **Drift guard:** **`AgentForgeAclProductGateStructureTest`** asserts **`$row[3]`** and **`groupDisplayName`** remain in the installer source.

After deploy, invoking **`AgentForgeAclInstaller::ensureRegistered()`** (any code path that already runs it on request) inserts the eight default ACL mappings: **`use`** + **`propose_write`** × four stock groups.

## Verification

- **Runtime (docker `development-easy` OpenEMR):** CLI script with `globals.php`, `AclMap::userPassesAgentForgeReadGate('physician')` → **PASS**; `agentforge/use` → **PASS**; confirmed **`gacl_acl`** rows for **`admin`**, **`doc`**, **`clin`**, **`breakglass`**.
- **`vendor/bin/phpunit -c phpunit-isolated.xml tests/Tests/Isolated/Modules/AgentForge/AgentForgeAclProductGateStructureTest.php`**
- **`vendor/bin/phpunit -c phpunit-isolated.xml tests/Tests/Isolated/Modules/AgentForge`**

User confirmed Copilot available for Donna after refresh / session.

## Key decisions log

| User / context | Decision |
| ---------------- | --------- |
| Copilot absent for **`physician`** despite “Physician” role | Treat as **engineering bug** in default ACL seed path, not as “add Donna to Physicians” (she already was). |
| How to read `get_group_data` | Prefer **numeric index 3** (display name OpenEMR uses); keep associative fallback if row shape normalizes elsewhere. |

## Files touched

- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeAclInstaller.php`
- **Modified:** `tests/Tests/Isolated/Modules/AgentForge/AgentForgeAclProductGateStructureTest.php`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0501-T2337-agentforge-installer-grant-seed-shape-fix.md` (this file)

## Operational note

Sites that ran the module **before** this fix may have **`agentforge` ACO rows** registered but **no default ACL grants**. After upgrading code, hitting any endpoint that runs **`ensureRegistered()`** should backfill grants idempotently. If a site disabled module bootstrap, run an OpenEMR request that invokes the installer or seed grants manually in ACL admin.

## Links

- Policy / layering reference: [process/milestones/week-1/16-clinical-copilot-acl-role-gate.md](../../milestones/week-1/16-clinical-copilot-acl-role-gate.md)
- Earlier policy journal: [0501-T2135-clinical-copilot-acl-role-gate.md](0501-T2135-clinical-copilot-acl-role-gate.md)
