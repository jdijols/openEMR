---
date: 2026-04-29
topic: Gate 1 security primitives closeout
related_milestone: process/11-gate0-complete.md
---

# Gate 1 security closeout — session journal

## Goal

Implement and fully close Gate 1 for the AgentForge Clinical Copilot: security primitives first, stop-the-line S1/S4/S5/S6/S10 coverage, docs aligned with PRD/task list/architecture, and local smoke evidence before moving to Gate 2.

## Context

Gate 0 was already closed. The Gate 1 task list initially conflicted with `ARCHITECTURE.md` on whether `admin/super` users should be blocked; the user clarified that architecture was authoritative and that the copilot should mirror OpenEMR permissions rather than create a second privilege plane.

## Key decisions

### Decision: allow admin/super under normal OpenEMR semantics

- **Prompt:** "ARCHITECTURE.md is actually correct. I believe they should be allowed. An admin/superuser should be allowed to do everything a physician can do."
- **Recommendation:** Remove the special admin/super launch block and rely on OpenEMR session/GACL, active-chart binding, token hygiene, explicit confirmed writes, and V1 write-target limits.
- **Outcome:** Gate 1 policy, code, tests, and docs now define S4 as "no copilot privilege bypass," not "no admin launch." See `TASKS.md` and `interface/modules/custom_modules/oe-module-agentforge/README.md`.

### Decision: use existing chart-read ACL for copilot access

- **Prompt:** "Anyone who has access to certain data (read or write) would have the same access through the copilot."
- **Recommendation:** Treat copilot launch/read access as downstream of OpenEMR's existing chart authorization, while keeping optional module-owned ACOs for future admin/write-proposal controls.
- **Outcome:** `AclMap` uses existing `patients/demo` for rail/read launch. The module does not create a parallel `agentforge/read_chart` gate.

### Decision: configure shared secrets through one gitignored env file

- **Prompt:** "Where am I going to put these secrets? Can you create the file? Do I need to add a file?"
- **Recommendation:** Put `OPENEMR_MODULE_SHARED_SECRET` and `SESSION_TOKEN_SECRET` in `docker/agentforge/secrets.env`, copied from `secrets.env.example`, and load that same file into both `openemr` and `agentforge-api`.
- **Outcome:** `docker/agentforge/docker-compose.override.yml` wires `env_file: ../agentforge/secrets.env` into both services. `docker/agentforge/README.md` documents safe validation with `config --services` because full Compose config expands secrets.

### Decision: server-to-server redeem must bypass browser auth but keep internal auth

- **Prompt:** "Let's complete gate one fully before moving forward."
- **Recommendation:** Run a real local smoke. It exposed that `handshake_redeem.php` was being intercepted by OpenEMR browser auth/module access before acting as a server-to-server endpoint.
- **Outcome:** `agentforge_require_globals()` now supports an explicit `ignoreAuthForRequest` flag, and only `handshake_redeem.php` opts into it. Internal auth via `X-Internal-Auth` remains required.

### Decision: keep one canonical Gate 1 smoke record

- **Prompt:** "When I look in the journal directory, it looks like there are two gate one entries that are slightly different. What happened there? Shouldn't we just have one?"
- **Recommendation:** Keep the timestamped file `0429-T2151-gate1-security-smoke.md` as the canonical smoke entry, move the populated evidence there, delete the duplicate nonconforming `0430-gate1-security-smoke.md`, and update task-list links.
- **Outcome:** The Gate 1 task list points to `Documentation/AgentForge/process/journal/week-1/0429-T2151-gate1-security-smoke.md`; the duplicate was removed.

## Trade-offs and alternatives

- A separate `agentforge/read_chart` ACL was not used for launch/read access because it would create a second authorization plane and could deny users who can already open the chart in OpenEMR.
- A live public "throw 500" endpoint was not added for S6 smoke because exposing a debug failure route would be worse than relying on the existing Vitest proof for normalized unhandled errors.
- Full `docker compose config` output was avoided in documentation because it prints secret values from `secrets.env`; `config --services` is the safe check.

## Tools, dependencies, commands

- `php vendor/bin/phpunit -c phpunit-isolated.xml tests/Tests/Isolated/Modules/AgentForge/`
- `npm --prefix agentforge/api test`
- `docker compose -f docker/development-easy/docker-compose.yml -f docker/agentforge/docker-compose.override.yml config --services`
- `docker compose -f docker/development-easy/docker-compose.yml -f docker/agentforge/docker-compose.override.yml up -d openemr agentforge-api`
- Local smoke used `curl`, OpenEMR's browser-session restore semantics, and MariaDB checks against the development-easy database.

## Files touched

- **Created:** `Documentation/AgentForge/process/journal/week-1/0429-T2258-gate1-security-closeout.md`
- **Created:** `agentforge/api/src/appTypes.ts`
- **Created:** `agentforge/api/src/cors.ts`
- **Created:** `agentforge/api/src/errors/normalize.ts`
- **Created:** `agentforge/api/src/handshake/redeem.ts`
- **Created:** `agentforge/api/src/handshake/sessionToken.ts`
- **Created:** `agentforge/api/src/tools/_binding.ts`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/public/agentforge_common.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/public/handshake_redeem.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/sql/table.sql`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Acl/AclMap.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Audit/AgentAuditLogger.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeAclInstaller.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/ActiveChartBinding.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/ActiveChartBindingException.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/LaunchCode.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/LaunchCodePayload.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/LaunchCodeStore.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/OpenEmrLaunchCodeStore.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/PdoLaunchCodeStore.php`
- **Created:** `interface/modules/custom_modules/oe-module-agentforge/src/Security/SessionTokenVerifier.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/ActiveChartBindingTest.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/AgentAuditLoggerTest.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/AgentForgeAclCoreSpecGuardTest.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/AgentForgeModuleSchemaTest.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/LaunchCodeTest.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/NoParallelPrivilegePlaneTest.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/SessionTokenInteropTest.php`
- **Created:** `tests/Tests/Isolated/Modules/AgentForge/SessionTokenIssuerFixture.php`
- **Modified:** `TASKS.md`
- **Modified:** `PRD.md`
- **Modified:** `agentforge/api/src/app.ts`
- **Modified:** `docker/agentforge/README.md`
- **Modified:** `docker/agentforge/docker-compose.override.yml`
- **Modified:** `docker/agentforge/secrets.env.example`
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/README.md`
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/moduleConfig.php`
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/public/launch.php`
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/public/panel.php`
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/sql/001_module_install.sql`
- **Deleted:** `Documentation/AgentForge/process/journal/week-1/0430-gate1-security-smoke.md`

## Outcomes

Gate 1 is closed in the implementation task list. Automated tests and local smoke evidence cover the Gate 1 stop-the-line requirements, and the docs now reflect the accepted admin/super policy, ACL model, secret wiring, and single canonical smoke record.

## Next steps

- [ ] Start Gate 2 with the corrected admin/super visibility assumption.
- [ ] Decide whether to promote Gate 1 closeout into a numbered `process/12-...` milestone or keep it as journal-only.
- [ ] Before external sharing, rotate local `secrets.env` values if any full `docker compose config` output containing secrets may have been exposed.

## Links

- Gate 1 smoke evidence: [0429-T2151-gate1-security-smoke.md](0429-T2151-gate1-security-smoke.md)
- Task list: [TASKS.md](../../../../../TASKS.md)
- Numbered milestone context: [process/11-gate0-complete.md](../../11-gate0-complete.md)
