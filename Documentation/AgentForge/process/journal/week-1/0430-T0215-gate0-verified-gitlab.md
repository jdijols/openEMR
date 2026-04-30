---
date: 2026-04-30
topic: Gate 0 verified on host, PHPUnit path, GitLab merge
related_milestone: process/11-gate0-complete.md
---

# Gate 0 verified + GitLab — session journal

## Goal

Close out Gate 0 after engineer verification: PHP/Composer/PECL Redis, isolated PHPUnit, manual `curl /health`, correlation-id round-trip, and one combined commit pushed to GitLab; capture process trail for handoff to Gate 1.

## Context

Gate 0 scaffold shipped in a prior agent session ([`0429-T2330-gate0-scaffold-spine.md`](0429-T2330-gate0-scaffold-spine.md)). OpenEMR’s `composer.json` script `phpunit-isolated` calls bare `phpunit` (not on PATH); host install needed `ext-redis` for `composer install`.

## Key decisions

### Decision: Run PHPUnit via `vendor/bin`

- **Prompt:** (implicit) `composer phpunit` → `phpunit: command not found`
- **Recommendation:** Use `php vendor/bin/phpunit -c phpunit-isolated.xml …` from repo root after `composer install`; root script can be fixed later.
- **Outcome:** `ModuleHttpContractTest` — OK (1 test, 2 assertions).

### Decision: Host PHP Redis extension

- **Prompt:** `composer install` blocked on `ext-redis`; PECL prompts mishandled (`[no]` vs `no`) caused msgpack configure error.
- **Recommendation:** Re-run `pecl install -n redis` or answer prompts with plain `no`; alternatively `composer install --ignore-platform-req=ext-redis` for vendor-only work.
- **Outcome:** `php -m` shows `redis`; full `composer install` succeeded.

### Decision: Manual health check

- **Prompt:** Optional `curl` after `npm run dev` — env vars required (no auto `.env` load).
- **Recommendation:** `export` all keys from `secrets.env.example` (dummy values OK); `curl -i http://localhost:3000/health`; optional inbound `x-correlation-id` header.
- **Outcome:** 200 + JSON shape + header preserved (`my-test-id`).

## Trade-offs and alternatives

_None this session — execution followed PRD/task list._

## Tools, dependencies, commands

- `brew install php composer` (earlier in week)
- `pecl install` / `pecl install -n redis` (PHP 8.5)
- `composer install` (repo root)
- `php vendor/bin/phpunit -c phpunit-isolated.xml tests/Tests/Isolated/Modules/AgentForge/ModuleHttpContractTest.php`
- `docker compose -f docker/development-easy/docker-compose.yml -f docker/agentforge/docker-compose.override.yml config`
- `agentforge/api`: `npm install`, `npm run typecheck`, `npm run build`, `npm test`
- `agentforge/cui`: `npm install`, `npm run typecheck`, `npm run lint`, `npm run build`
- `cd interface/modules/custom_modules/oe-module-agentforge && composer dump-autoload -o`

## Files touched

- **Modified (this wrap-up):** `Documentation/AgentForge/implementation/clinical-copilot-task-list.md`, `Documentation/AgentForge/README.md`, `Documentation/AgentForge/process/10-prd.md`, `Documentation/AgentForge/process/02-tooling-and-skills.md`, `Documentation/AgentForge/process/11-gate0-complete.md` (created), this journal (created).
- **Engineer commit (already on GitLab):** scaffold trees per Gate 0 — `agentforge/`, `docker/agentforge/`, `interface/modules/custom_modules/oe-module-agentforge/`, `tests/Tests/Isolated/Modules/AgentForge/`, `.gitignore`, docs/PRD/task-list material as committed by user.

## Outcomes

Gate 0 exit criteria are green on the engineer’s machine; implementation is on GitLab; task list rows marked `[x]`; process trail index updated with milestone **11** and this journal.

## Next steps

- [ ] Begin **Gate 1** — security primitives ([`clinical-copilot-task-list.md`](../../implementation/clinical-copilot-task-list.md#gate-1--security-primitives-first)) in a new session.
- [ ] (Optional) Patch root `composer.json` `phpunit-isolated` to invoke `./vendor/bin/phpunit`.

## Links

- Milestone: [process/11-gate0-complete.md](../../11-gate0-complete.md)
- Prior scaffold journal: [0429-T2330-gate0-scaffold-spine.md](0429-T2330-gate0-scaffold-spine.md)
