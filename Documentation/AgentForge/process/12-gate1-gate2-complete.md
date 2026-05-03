# Stage 12 — Gate 1 and Gate 2 complete

**Purpose:** Record closure of **Gate 1 — Security Primitives First** and **Gate 2 — First Vertical Read Slice (UC-A spine)** from [`TASKS.md`](../../../TASKS.md): launch-code + redeem handshake, active-chart binding, ACL/audit alignment with OpenEMR (no parallel privilege plane), Agent API Hono edge (CORS, error normalization, session token), then rail + CUI + Context Service (identity, allergies) + orchestrator + **G2-12** cited read with S1 cross-patient smoke. Stops-the-line **S1, S4, S5, S6, S10** (module/API scope for Gate 1) and the Gate 2 architecture proof (“one chart-bound question with citations”) are satisfied per the task list.

## Verification

**Gate 1** — Task list status **CLOSED** (2026-04-29). Canonical smoke record: [`journal/week-1/0429-T2151-gate1-security-smoke.md`](journal/week-1/0429-T2151-gate1-security-smoke.md). Closeout / decisions: [`journal/week-1/0429-T2258-gate1-security-closeout.md`](journal/week-1/0429-T2258-gate1-security-closeout.md). Isolated PHPUnit `tests/Tests/Isolated/Modules/AgentForge/` + `agentforge/api` Vitest cover launch code, binding, audit metadata, handshake redeem, CORS, S6 normalization, `assertBoundPatient`.

**Gate 2** — Code-complete journal (automated suites + topology): [`journal/week-1/0429-T2352-gate2-code-complete.md`](journal/week-1/0429-T2352-gate2-code-complete.md). **G2-12** manual smoke and Gate 2 **CLOSED** (2026-04-30): [`journal/week-1/0430-T1830-gate2-closed-g212-manual-smoke.md`](journal/week-1/0430-T1830-gate2-closed-g212-manual-smoke.md). Session handoff / operator checklist context: [`journal/week-1/0430-T0050-gate2-session-handoff-g212-g214.md`](journal/week-1/0430-T0050-gate2-session-handoff-g212-g214.md). Snapshot at close: API Vitest 31/31, CUI 15/15, AgentForge PHPUnit 19/19; CUI bundle into `oe-module-agentforge/public/cui/`; dev + prod compose merges validated (per task list verification recap).

## Decisions (lifted from journals)

- **S4 / admin\|super:** Copilot mirrors OpenEMR session/GACL; **no** copilot-only block on `admin/super`. Accepted risk and binding still enforced via active-chart checks, token hygiene, and later explicit-confirm writes (see module README + task list G1-06).
- **Rail read ACL:** Use existing chart-read expectations (e.g. `patients/demo` for launch/read paths); avoid a second `agentforge/read_chart` plane that could deny users who already have the chart open.
- **Secrets:** Shared module/API secrets live in gitignored `docker/agentforge/` env files (`secrets.env` lineage; evolved to `secrets.dev.env` / `secrets.prod.env` + `AGENTFORGE_SECRETS_FILE` for Gate 2 topology). Prefer `docker compose … config --services` over full `config` in logs (secrets expand).
- **S2S redeem:** `handshake_redeem.php` uses controlled `ignoreAuthForRequest` so browser auth does not intercept server-to-server redeem; **`X-Internal-Auth`** still required.
- **Gate 2 topology:** `openemr` on `agentforge_internal`; `OPENEMR_MODULE_BASE_URL` host loopback (dev) vs `http://openemr` (prod); prod-shaped Caddy + TLS + API internal-only in compose overlay (full bake deferred to Gate 6).
- **Deferred post–Gate 2:** Active chart ↔ rail sync without full page reload → **Gate 3 / G3-12** in the task list.

## Next

**Gate 3** — **Closed** (2026-04-30); see [Stage 13 — Gate 3 complete](13-gate3-complete.md). Historical pointer: [`TASKS.md` § Gate 3](../../../TASKS.md#gate-3--uc-a-read-completeness).

**Gate 4** — [`TASKS.md` § Gate 4](../../../TASKS.md#gate-4--uc-b-confirmed-writes): UC-B confirmed writes.

**Prior milestone:** [Stage 11 — Gate 0 complete](11-gate0-complete.md).
