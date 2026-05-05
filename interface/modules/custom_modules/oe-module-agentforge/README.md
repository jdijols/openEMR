# oe-module-agentforge

OpenEMR custom module for **AgentForge V1 Clinical Copilot** ([`PRD.md`](../../../../PRD.md)). Gate 0 scaffold; Context Service endpoints and GACL wiring land in later gates.

**Instructor grading / access policy (who may use Clinical Copilot):** **[`Documentation/AgentForge/process/milestones/week-1/16-clinical-copilot-acl-role-gate.md`](../../../../Documentation/AgentForge/process/milestones/week-1/16-clinical-copilot-acl-role-gate.md)** (summary table plus **`admin`/`doc`/`clin`/`breakglass`** vs **`front`**/**`back`**). Session journal: **[`0501-T2135-clinical-copilot-acl-role-gate.md`](../../../../Documentation/AgentForge/process/journal/week-1/0501-T2135-clinical-copilot-acl-role-gate.md)**.

## §4.9 ACL declarations + no parallel privilege plane

### 4.9.1 Implementation surface

- `OpenEMR\Modules\AgentForge\Acl\AclMap` centralizes the ACL specs used by the module:
  - **Chart floor:** Clinical Copilot read paths and launch (`panel.php`, `launch.php`, Context Service via `ChartContextGate`, header/rail chrome via `Bootstrap`) require OpenEMR chart-demographics ACL **`patients` / `demo`** first.
  - **Product entitlement:** the copilot UX additionally requires module-owned **`agentforge` / `use`**. This is *not* redundant with `demo` — it restricts the AI surface to operators your practice explicitly entitles (default seed: **Administrators**, **Physicians**, **Clinicians**, **Emergency Login**; Front Office and Accounting are intentionally *not* seeded).
  - **`agentforge` / `propose_write`** remains the confirmed-write gate (`public/write/`); write scripts use `AclMap::userPassesAgentForgeProposeWriteGate()`.
  - **`agentforge` / `module_admin`** is reserved for module administration (not yet wired on HTTP entrypoints).
- Each endpoint's request handler calls `AclMain::aclCheckCore('<section>', '<value>')` with a non-empty spec (directly or via `AclMap` helpers that only compose non-empty checks). This closes the [`AUDIT.md` Security-10](../../../../AUDIT.md#security-10-gacl-semantics-superuser-bypass-and-fail-open-caller-bugs) "empty ACO spec → fail-open" hole.
- `admin/super` users are allowed to launch and use the copilot under the same OpenEMR session semantics as physicians. The accepted risk is that `admin/super` bypasses normal GACL, so role-scoped ACL guarantees do not apply to that account class; active-chart binding, launch-code/token hygiene, explicit-confirm writes, and V1 write-target limits still apply.
- The copilot is not a parallel privilege plane: if OpenEMR would deny an action for the current session, the module denies it too; if OpenEMR grants it (including superuser grant), the copilot may use it within V1 scope.

### UC-B confirmed writes (`public/write/`)

Chief complaint (**Gate 4 G4-01**, `public/write/chief_complaint.php`), vitals (**G4-02**, `public/write/vitals.php`), tobacco (**G4-03**, `public/write/tobacco.php`), and allergy (**G4-04**, `public/write/allergy.php`) check **`agentforge` / `propose_write`** (via `AclMap::userPassesAgentForgeProposeWriteGate()`) on top of session token + active-chart binding + chart floor + **`agentforge` / `use`**. Grant both `use` and `propose_write` to roles that should run Agent API–initiated confirmed writes after you install the module schema (includes table `agentforge_completed_write_proposal` for proposal-id dedupe). Default seed assigns both to Administrators, Physicians, Clinicians, and Emergency Login.

### 4.9.2 Done means (PRD)

- [ ] Context ingress and write surfaces enforce the chart floor plus **`agentforge/use`** (read) and **`agentforge/propose_write`** (writes); no empty ACO spec passthrough.
- [ ] `admin/super` can launch when authenticated, but receives no special bypass beyond the normal OpenEMR superuser model.
- [ ] Module README records the accepted-risk note and the “same session, no parallel privilege plane” rule.

## Runtime configuration (Gate 1)

The PHP public endpoints (`launch.php`, `panel.php`, `handshake_redeem.php`) read:

- `OPENEMR_MODULE_SHARED_SECRET` — must match `agentforge-api` `OPENEMR_MODULE_SHARED_SECRET`; sent as `X-Internal-Auth` on S2S redeem.
- `SESSION_TOKEN_SECRET` — must match `agentforge-api`; used to verify `session_token` on Context Service calls (Gate 2+).

Configure these in the web/PHP environment (e.g. Apache/Caddy `SetEnv`, `php-fpm` pool env, or Docker `environment` / `env_file` on the OpenEMR service).

**Docker (development-easy + AgentForge override):** use `docker/agentforge/secrets.env` (see `docker/agentforge/README.md`); the merged compose loads it into the `openemr` container so `getenv()` works for this module.

Without them, internal redeem and future binding verification cannot work.

### CUI → Agent API (Gate 2)

- `AGENTFORGE_API_PUBLIC_URL` — absolute base URL of the Agent API as reached by the **browser** (e.g. `http://localhost:8080` behind Caddy, or your deployed API host). `panel.php` injects this into `window.__AGENTFORGE_CUI__.apiBase` so the embedded React bundle can call `/handshake/redeem` and `/chat`.
- The Agent API’s `CUI_ALLOWED_ORIGINS` must include your OpenEMR site **Origin** (scheme + host + port), e.g. `http://localhost:8300`, or the browser will block cross-origin requests.

Build the CUI bundle after UI changes:

```bash
cd agentforge/cui && npm ci && npm run build
```

Artifacts are written to `public/cui/` under this module (`agentforge-cui.js`, `agentforge-cui-index.css`).
