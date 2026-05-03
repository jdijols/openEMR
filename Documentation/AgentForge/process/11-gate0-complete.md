# Stage 11 — Gate 0 complete

**Purpose:** Record closure of **Gate 0 — Scaffold + Contract Spine** from [`TASKS.md`](../../../TASKS.md): repo layout per PRD §3.2, `agentforge/api` + `cui`, `oe-module-agentforge` module skeleton, `docker/agentforge` compose extension, contract drift tests (Vitest + PHPUnit), Langfuse env + observability interface, `.gitignore` / `secrets.env.example`.

## Verification

Engineer re-ran installs and tests on host (PHP 8.5 + Composer + Redis extension); pushed one combined commit to GitLab. Session journal: [`journal/week-1/0429-T2015-gate0-verified-gitlab.md`](journal/week-1/0429-T2015-gate0-verified-gitlab.md). Scaffold session: [`journal/week-1/0429-T1845-gate0-scaffold-spine.md`](journal/week-1/0429-T1845-gate0-scaffold-spine.md).

## Decisions (lifted from journals)

- **PHPUnit on host:** Prefer `php vendor/bin/phpunit -c phpunit-isolated.xml …` — root Composer script `phpunit-isolated` invokes bare `phpunit` (often not on PATH).
- **Composer + Redis:** `composer install` expects `ext-redis`; Homebrew PHP typically needs PECL `redis` (or `--ignore-platform-req=ext-redis` for vendor-only).

## Next

**Gate 1** — [`TASKS.md` § Gate 1](../../../TASKS.md#gate-1--security-primitives-first) (security primitives, stop-the-line S1/S4/S5/S6/S10 module-side).
