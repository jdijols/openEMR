# oe-module-agentforge

OpenEMR custom module for **AgentForge V1 Clinical Co-Pilot** ([`PRD.md`](../../../../PRD.md)). Gate 0 scaffold; Context Service endpoints and GACL wiring land in later gates.

## §4.9 ACL declarations + admin/super guard (PRD verbatim)

### 4.9.1 Implementation surface

- `OpenEMR\Modules\AgentForge\Acl\AclMap` declares one ACO section `agentforge` with these values:
  - `read_chart` — required for any §4.4 endpoint.
  - `propose_write` — required for any §4.7 endpoint.
  - `module_admin` — required to install/uninstall the module (matches OpenEMR convention).
- Each endpoint's request handler calls `AclMain::aclCheckCore('agentforge', '<value>')` as a non-empty spec. This closes the [`AUDIT.md` Security-10](../../../../AUDIT.md#security-10-gacl-semantics-superuser-bypass-and-fail-open-caller-bugs) "empty ACO spec → fail-open" hole.
- `OpenEMR\Modules\AgentForge\Security\AdminGuard` blocks `admin/super` from launching the rail. The header icon is hidden when the active user is `admin` or has `admin/super`. If a user re-enables the icon manually (e.g. via dev tools), `panel.php` refuses to mint a launch code with `403 {"error":"admin_user_blocked"}`.
- A documentation note in `interface/modules/custom_modules/oe-module-agentforge/README.md` records this as accepted-risk for synthetic-data demo and a hard prerequisite for real-PHI deployment per [`ARCHITECTURE.md` "Security rules we do not relax"](../../../../ARCHITECTURE.md).

### 4.9.2 Done means (PRD)

- [ ] Every read/write endpoint calls `aclCheckCore('agentforge', '<value>')` with a non-empty spec.
- [ ] The header icon is hidden for `admin` and `admin/super` users.
- [ ] `panel.php` refuses launch-code mint for those users.
- [ ] Module README records the accepted-risk note.
