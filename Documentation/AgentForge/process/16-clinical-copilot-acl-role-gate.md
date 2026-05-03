---
date: 2026-05-01
topic: Clinical Copilot GACL layer — instructor-facing access control summary
related_milestone: "process/16-clinical-copilot-acl-role-gate.md"
---

# Clinical Copilot access control — process milestone

## Purpose

Provide a single **examiner-facing** checkpoint for **who may use AgentForge Clinical Copilot** and **who may not**, aligned with OpenEMR GACL (no parallel privilege plane). Implementation lives in **`oe-module-agentforge`**; this file is the process-trail anchor for grading narratives and demos.

See also session journal [0501-T2135-clinical-copilot-acl-role-gate.md](../journal/week-1/0501-T2135-clinical-copilot-acl-role-gate.md) for pivot history.

---

## Decision (product policy)

Clinical Copilot access is **not** “everyone who can open demographics (`patients/demo`).” It adds a module-owned entitlement:

| Layer | GACL section / value | Role |
| ----- | --------------------- | ---- |
| Chart floor | `patients` / `demo` | User may access chart-demographics workflows OpenEMR already tied to **`demo`** (required first). |
| Product read | `agentforge` / `use` | User may load rail, **`panel.php`**, **`launch.php`**, Context Service reads (ChartContextGate). |
| Proposed writes | `agentforge` / `propose_write` | User may execute **`public/write/`** confirmed-write endpoints (after binding + tokens). |

**Default seed groups** (`AgentForgeAclInstaller`; stock OpenEMR `gacl_aro_groups.value`): **`admin`**, **`doc`**, **`clin`**, **`breakglass`** (Administrators, Physicians, Clinicians, Emergency Login). Each receives **`use`** + **`propose_write`** grants idempotently on first module registration.

**Intentionally not default-seeded:** **Front Office** (`front`), **Accounting** (`back`), parent **OpenEMR Users** (`users`). They may retain `patients/demo` for scheduling/billing demographics but **do not** receive AgentForge ACO grants unless an administrator assigns **`agentforge/use`** (and **`propose_write`** if writes are desired).

**Superuser caveat:** Sessions with **`admin/super`** follow normal OpenEMR semantics (`AclMain::aclCheckCore` bypass for superuser accounts). Accepted risk is documented on the module README and **`PRD.md` §4.9**.

---

## Code and spec pointers

- Module README (implementation detail): [`interface/modules/custom_modules/oe-module-agentforge/README.md`](../../../interface/modules/custom_modules/oe-module-agentforge/README.md) — §4.9.
- Product spec: [`PRD.md`](../../../PRD.md) §4.9.
- Constants and composed checks: [`AclMap.php`](../../../interface/modules/custom_modules/oe-module-agentforge/src/Acl/AclMap.php).
- Lazy ACO registration + default ACL rows: [`AgentForgeAclInstaller.php`](../../../interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeAclInstaller.php).
- Read gate: **`ChartContextGate`**, **`launch.php`**, **`panel.php`**, **`Bootstrap::shouldShowChrome()`** → **`AclMap::userPassesAgentForgeReadGate()`**.
- Write gate: **`public/write/*.php`** → **`AclMap::userPassesAgentForgeProposeWriteGate()`** (implies read gate + **`propose_write`**).
- Drift tests (isolated PHPUnit): **[`AgentForgeAclProductGateStructureTest.php`](../../../tests/Tests/Isolated/Modules/AgentForge/AgentForgeAclProductGateStructureTest.php)**, **`NoParallelPrivilegePlaneTest.php`**, **`AgentForgeAclCoreSpecGuardTest.php`** (same directory).

---

## Operational notes for demos

To verify denial for non-clinical preset roles after upgrade: use a demo user mapped to Front Office or Accounting (e.g. after **`dev-reset-install-demodata`**, credentials per [CONTRIBUTING Demo Credentials](https://www.open-emr.org/wiki/index.php/Development_Demo#Demo_Credentials)). Expect **no header icon**, **`panel.php`/`launch.php` → `403 acl_denied`**, and Context Service refusal for the same user.

---

## Links

- Session journal: [journal/week-1/0501-T2135-clinical-copilot-acl-role-gate.md](../journal/week-1/0501-T2135-clinical-copilot-acl-role-gate.md)
