# oe-module-agentforge

OpenEMR custom module for **AgentForge V1 Clinical Co-Pilot** ([`PRD.md`](../../../../PRD.md)). Gate 0 scaffold; Context Service endpoints and GACL wiring land in later gates.

## §4.9 ACL declarations + no parallel privilege plane

### 4.9.1 Implementation surface

- `OpenEMR\Modules\AgentForge\Acl\AclMap` centralizes the ACL specs used by the module:
  - chart read / rail launch uses the existing OpenEMR chart-read permission `patients/demo`, so users who can open the chart in the UI can open the co-pilot.
  - module-owned `agentforge` ACOs remain available for module administration and optional write-proposal entitlement, but they are not a second chart-read gate.
- Each endpoint's request handler calls `AclMain::aclCheckCore('<section>', '<value>')` with a non-empty spec. This closes the [`AUDIT.md` Security-10](../../../../AUDIT.md#security-10-gacl-semantics-superuser-bypass-and-fail-open-caller-bugs) "empty ACO spec → fail-open" hole.
- `admin/super` users are allowed to launch and use the co-pilot under the same OpenEMR session semantics as physicians. The accepted risk is that `admin/super` bypasses normal GACL, so role-scoped ACL guarantees do not apply to that account class; active-chart binding, launch-code/token hygiene, explicit-confirm writes, and V1 write-target limits still apply.
- The co-pilot is not a parallel privilege plane: if OpenEMR would deny an action for the current session, the module denies it too; if OpenEMR grants it (including superuser grant), the co-pilot may use it within V1 scope.

### 4.9.2 Done means (PRD)

- [ ] Every read/write endpoint calls `aclCheckCore('agentforge', '<value>')` with a non-empty spec.
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
