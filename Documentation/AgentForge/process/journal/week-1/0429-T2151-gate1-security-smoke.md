# Gate 1 — Security primitives (2026-04-29)

## Automated proof (CI/local)

- `php vendor/bin/phpunit -c phpunit-isolated.xml tests/Tests/Isolated/Modules/AgentForge/` — launch code, active-chart binding, audit metadata SQL schema guard, ACL empty-spec guard, session token interop.
- `cd agentforge/api && npm test` — handshake redeem (mocked module), CORS allowlist, error normalization (S6), `assertBoundPatient` (S1), session token round-trip.

## Docker env wiring (Gate 1 close-out)

`docker/agentforge/docker-compose.override.yml` attaches `env_file: secrets.env` to **`openemr`** and **`agentforge-api`**. Create `docker/agentforge/secrets.env` from `secrets.env.example` (gitignored). Merge + validate (lists services only; avoid full `config` in shared logs -- it expands `secrets.env`):

`cd docker/development-easy && docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml config --services`

Validated services include `openemr`, `agentforge-api`, `postgres`, `mysql`, `caddy`, and the existing development-easy support services.

## G1-13 manual smoke (engineer checklist — Caddy-less stack)

Run when OpenEMR + module SQL are applied and `secrets.env` is present (or equivalent env on PHP + Node):

1. **S5** — Open `panel.php` or `launch.php` authenticated; response HTML contains `data-launch-code` only (no `?launch_code=` in address bar).
2. **S4** — As `admin` or admin-super user, `panel.php` mints a launch code when the normal OpenEMR session/ACL permits it; there is no co-pilot-only admin block and no empty ACL spec.
3. **S1/S5** — `curl` redeem: POST `handshake_redeem.php` with `X-Internal-Auth` + JSON `{"launch_code":"…"}`; second POST with same code returns `401` `invalid_launch_code`.
4. **S6** — Trigger agent API `500` path (any thrown error); body must be `internal_error` + `correlation_id` only (no SQL/PHI strings).

Capture outputs below when complete (paste command results / notes).

### Manual run log

- Docker/OpenEMR preparation:
  - Recreated `openemr` with the AgentForge override so PHP `getenv()` sees `OPENEMR_MODULE_SHARED_SECRET` and `SESSION_TOKEN_SECRET`.
  - Started `agentforge-api` skeleton service; verified both required secrets are present in `openemr` and `agentforge-api` without printing values.
  - Applied local dev DB schema for `agentforge_launch_code` and `log.correlation_id`; verified both objects exist.
  - Registered/enabled `oe-module-agentforge` in the local OpenEMR `modules` table so OpenEMR's module access layer permits public module scripts.
- Automated proof rerun:
  - `php vendor/bin/phpunit -c phpunit-isolated.xml tests/Tests/Isolated/Modules/AgentForge/` -> `OK (14 tests, 66 assertions)`.
  - `npm --prefix agentforge/api test` -> `8 passed`, `16 passed`.
- S5/S4 live launch smoke:
  - Authenticated as `admin` / `pass` using the OpenEMR browser-session restore semantics from CLI.
  - `panel.php?site=default` returned `200`.
  - Response contained `data-launch-code`.
  - Effective URL query did **not** contain `launch_code=`.
  - This confirms admin/super is not categorically blocked and the launch token is delivered in document HTML, not the URL.
- S5 live redeem smoke:
  - Inserted a synthetic one-time launch-code row in the local dev DB without printing the token.
  - First `POST handshake_redeem.php?site=default` with `X-Internal-Auth` returned `200` and JSON shape `encounter_id,patient_uuid,user_id`.
  - Second POST with the same code returned `401` and JSON error `invalid_launch_code`.
- S1/S6 proof status:
  - S1 active-chart binding is covered by the Gate 1 PHPUnit/Vitest suites (`ActiveChartBinding` module-side and `assertBoundPatient` API-side).
  - S6 normalized unhandled API errors are covered by `agentforge/api` Vitest (`error-normalize.test.ts`). No production debug throw route is exposed for live curl, so the live Gate 1 smoke does not add a temporary public failure route.

Gate 1 is closed for implementation and local smoke evidence.
