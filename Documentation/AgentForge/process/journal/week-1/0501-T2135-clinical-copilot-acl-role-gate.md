---
date: 2026-05-01
topic: Clinical Copilot GACL role gate — policy + examiner documentation
related_milestone: process/16-clinical-copilot-acl-role-gate.md
---

# Clinical Copilot GACL role gate — session journal

## Goal

Capture **process documentation** so Gauntlet **instructors** can see how Clinical Copilot access is permissioned (**who gets the tool vs who does not**), link it from the README trail and module README, and record the decisions behind the **`agentforge/use`** layer and default seeded groups.

## Context

Prior implementation added a module-owned **`agentforge` / `use`** product gate on top of OpenEMR **`patients` / `demo`**, seeded **`use`** + **`propose_write`** only for stock groups **admin**, **doc**, **clin**, and **breakglass**, and intentionally excluded Front Office / Accounting defaults. Product brief (**PRD** §4.9) requires no parallel privilege plane; all checks remain **`AclMain::aclCheckCore`** (or `AclMap` helpers that compose only non-empty specs).

## Key decisions

### Decision: GACL-native product gate vs extra permission store

- **Prompt:** "If this needs to be a secondary permission outside of GACL, then let's do it."
- **Recommendation:** Prefer **single GACL model** (`agentforge/use`, `agentforge/propose_write`) seeded by **`AgentForgeAclInstaller`** rather than duplicating entitlement outside **`gacl_*`** tables.
- **Outcome:** Implemented as module ACOs + default ACL rows; **`PRD.md`**, module README, and milestone **process/16** describe the layering.

### Decision: Emergency Login + propose-write parity for seeded clinical groups

- **Prompt:** User chose **Emergency Login** may access AgentForge; **Administrators**, **Physicians**, **Clinicians** get **both** copilot use and confirmed-write entitlement by default.
- **Recommendation:** Mirror that in **`DEFAULT_PRIVILEGED_GROUP_VALUES`** and grant **`use`** + **`propose_write`** to **`breakglass`** along with **`admin`**, **`doc`**, **`clin`**.
- **Outcome:** **process/16** and installer constant document **`admin`**, **`doc`**, **`clin`**, **`breakglass`** only.

### Decision: Exclude Front Office and Accounting from default AgentForge entitlement

- **Prompt:** Restrict Clinical Copilot to administrators / physicians / clinicians; accounting and front office should not have access without explicit intent.
- **Recommendation:** Do **not** seed **`agentforge/use`** or **`propose_write`** for **`front`** or **`back`**; they may retain **`patients/demo`** for workflows OpenEMR already grants — insufficient for Clinical Copilot rail without explicit admin ACL edits.
- **Outcome:** Default grant list excludes **`front`**/**`back`**; denial behavior documented for examiners on **process/16** and module README §4.9.

### Decision: examiner-facing README linkage

- **Prompt:** "Add process documentation … linked in the README … instructors … call out how we've permissioned who gets access"
- **Recommendation:** Add numbered milestone **process/16**, this journal entry, and cross-links from **Documentation/AgentForge/README.md**, fork **README.md**, and **`oe-module-agentforge/README.md`**.
- **Outcome:** README trail row **#16**, new examiner blurb under AgentForge README, fork README sentence, module README banner link to **process/16**.

## Trade-offs and alternatives

- **`patients/demo` only** — would keep Accounting/Front Office on copilot; rejected for instructor alignment and narrower PHI/agent surface by role.
- **Separate app-level permission DB** — rejected to avoid dual privilege planes and stay consistent with **`AUDIT.md`** / PRD §4.9 language.

## Tools, dependencies, commands

_None this session — documentation-only._

## Files touched

- **Created:** `Documentation/AgentForge/process/16-clinical-copilot-acl-role-gate.md`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0501-T2135-clinical-copilot-acl-role-gate.md`
- **Modified:** `Documentation/AgentForge/README.md`
- **Modified:** `README.md`
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/README.md`

## Outcomes

Examiner-visible **process/16** describes the **`demo`** + **`use`** stack, writes via **`propose_write`**, which stock groups receive default AgentForge ACL rows, which preset roles remain denied until an admin assigns ACOs, the **`admin/super`** caveat, and links to **`PRD`**, module code, tests, and this journal.

## Next steps

- [ ] Gate 7 / submission checklist: cite **process/16** if rubric expects explicit permissioning prose.
- [ ] Sites that need Accounting/Front Office copilot: assign **`agentforge/use`** (**and **`propose_write`** for writes**) in OpenEMR ACL admin.

## Links

- Numbered milestone: [process/16-clinical-copilot-acl-role-gate.md](../../16-clinical-copilot-acl-role-gate.md)
