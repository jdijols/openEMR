# Gate 0 close — scaffold + contract spine

**Time:** 2026-04-29 (local)  
**Refs:** [`TASKS.md`](../../implementation/TASKS.md) (Gate 0), [`PRD.md`](../../../../PRD.md) §3.2 §3.4 §5.1.1 §7.1.1 §11.1 §4.9.1

## Exit criteria (task list)

- Directory tree matches PRD §3.2 with placeholder READMEs; `module-http-paths.json` + `MODULE_HTTP_PATHS` + `ModuleHttpContract` drift tests enforce the same 13 endpoint paths.
- `oe-module-agentforge/openemr.bootstrap.php` + `composer.json` PSR-4; runtime autoload via `ModulesClassLoader` (OpenEMR convention).
- `agentforge/api`: Hono app, Zod `env.ts` (incl. `LANGFUSE_*`), correlation middleware, `GET /health` with deps stubbed `unknown`, observability interface with Langfuse-init try/fail noop, Vitest coverage for contract/env/HTTP/obs.
- `agentforge/cui`: Vite + React + TS strict + ESLint; `npm run build` → `dist/`.
- `docker/agentforge/docker-compose.override.yml` skeleton: `agentforge-api`, `postgres`, `langfuse`, `caddy` (§7.1.1).
- `.gitignore` extended for `*.env`, `secrets.env`, `**/dist/`, `.cache`.
- `docker/agentforge/secrets.env.example` documents all boot-required keys aligned with `env.ts`.
- Module README records PRD §4.9.1 admin/super + accepted-risk language verbatim (spec bullets).
- LANGFUSE env contract is validated at API boot (Gate 6 wires self-hosted + redaction).

## Done proofs (re-run)

From repo root:

1. `tree -L 3 interface/modules/custom_modules/oe-module-agentforge agentforge docker/agentforge` — paths present.
2. `cd interface/modules/custom_modules/oe-module-agentforge && composer dump-autoload` — no errors.
3. `cd agentforge/api && npm install && npm run typecheck && npm run build && npm test`
4. `cd agentforge/cui && npm install && npm run typecheck && npm run lint && npm run build` — expect `dist/index.html`.
5. `php vendor/bin/phpunit -c phpunit-isolated.xml tests/Tests/Isolated/Modules/AgentForge/ModuleHttpContractTest.php` — root Composer script uses bare `phpunit` (often missing on PATH); see [`0429-T2115-gate0-verified-gitlab.md`](0429-T2115-gate0-verified-gitlab.md).
6. `docker compose -f docker/development-easy/docker-compose.yml -f docker/agentforge/docker-compose.override.yml config`

## User intervention

- None required for Gate 0 unless local Node & Docker versions differ (Node 20+, Docker Compose v2).
