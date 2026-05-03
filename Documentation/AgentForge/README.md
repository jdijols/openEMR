---
course-start: 2026-04-27
---

> **Project README:** [`/README.md`](../../README.md). Clinical Copilot is the product; this folder is the program-context build documentation from the Gauntlet AI AgentForge cohort that produced it.

# AgentForge (Gauntlet AI) — Clinical Copilot Process Trail

This folder holds **course and process documentation** for the Clinical Copilot work developed on this OpenEMR fork during the Gauntlet AI AgentForge program. It is separate from upstream OpenEMR’s `Documentation/` tree.

## Clinical Copilot access control (instructor grading)

**Who gets the Clinical Copilot rail, Context Service, and confirmed writes—and who does not—is defined in OpenEMR GACL**, not environmental toggles alone. Canonical summary for examiners:

- **[process/16-clinical-copilot-acl-role-gate.md](process/16-clinical-copilot-acl-role-gate.md)** — policy table (**`patients/demo`** floor + **`agentforge/use`** + **`agentforge/propose_write`**), **default-seeded groups** (`admin`, `doc`, `clin`, `breakglass`) vs **explicitly excluded** preset roles (`front`, `back`, parent `users` without assignment), **`admin/super`** caveat, implementation links.
- **[Journal 0501-T2135](process/journal/week-1/0501-T2135-clinical-copilot-acl-role-gate.md)** — session decisions (GACL-only model, Emergency Login inclusion, Front Office / Accounting exclusion).
- Spec: **`PRD.md`** §4.9; implementation: **`interface/modules/custom_modules/oe-module-agentforge/README.md`** §4.9.

## Process trail (read in order)


| #   | File                                                                         | Purpose                                         |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | [process/01-agentforge-impressions.md](process/01-agentforge-impressions.md) | First-pass notes on the case study PDF          |
| 2   | [process/02-tooling-and-skills.md](process/02-tooling-and-skills.md)         | AI workflow: gstack, Cursor, Matt Pocock skills |
| 3   | [process/03-presearch-checklist.md](process/03-presearch-checklist.md)       | Pre-code research checklist (fill over time)    |
| 4   | [process/04-stage1-local-dev-runbook.md](process/04-stage1-local-dev-runbook.md) | Stage 1: Docker easy-dev + demo data runbook    |
| 5   | [process/05-stage2-deployment-decision.md](process/05-stage2-deployment-decision.md) | Stage 2: VPS + Compose deployment decision + trade-offs |
| 6   | [process/06-stage3-audit.md](process/06-stage3-audit.md)                     | Stage 3: audit process pointer → [`AUDIT.md`](../../AUDIT.md) |
| 7   | [process/07-stage4-users.md](process/07-stage4-users.md)                     | Stage 4: users process pointer → [`USERS.md`](../../USERS.md) |
| 8   | [process/08-stage5-architecture.md](process/08-stage5-architecture.md)       | Stage 5: architecture process pointer → [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| 9   | [process/09-vps-live-deployment.md](process/09-vps-live-deployment.md)       | MVP: live OpenEMR on a Linux VPS (Vultr) + Compose; GitLab clone; nip.io / HTTPS path |
| 10  | [process/10-prd.md](process/10-prd.md)                                       | PRD + gate-ordered implementation task list; pointer to [`PRD.md`](../../PRD.md) and [`../../TASKS.md`](../../TASKS.md) |
| 11  | [process/11-gate0-complete.md](process/11-gate0-complete.md)                 | Gate 0 scaffold + contract spine closed; verification journal; handoff to Gate 1 |
| 12  | [process/12-gate1-gate2-complete.md](process/12-gate1-gate2-complete.md)       | Gate 1 security primitives + Gate 2 UC-A read spine closed; journal evidence; handoff to Gate 3 |
| 13  | [process/13-gate3-complete.md](process/13-gate3-complete.md)                 | Gate 3 UC-A read completeness closed; case presentation + verification; handoff to Gate 4 |
| 14  | [process/14-gate4-complete.md](process/14-gate4-complete.md)                 | Gate 4 UC-B confirmed writes closed; G4-10 chief-complaint E2E + `log_from='agent'` audit; handoff to Gate 5 |
| 15  | [process/15-gate6-complete.md](process/15-gate6-complete.md)                 | Gate 6 eval + observability + deploy closed (G6-01..G6-18 + G6-20); LLM provider swap + eval-runner refactor + Context HTTP-matrix backfill; handoff to Gate 7 |
| 16  | [process/16-clinical-copilot-acl-role-gate.md](process/16-clinical-copilot-acl-role-gate.md) | **Access control:** who may use Clinical Copilot (`agentforge/use`, `propose_write`) vs excluded preset roles; GACL layering; examiner links |
| 17  | [process/17-encounter-scoped-chart-bind-and-brief.md](process/17-encounter-scoped-chart-bind-and-brief.md) | **Open encounter scope:** appointment click context → session + AgentForge binder; brief vitals + Context `encounter_id` (not calendar “today”) |
| 18  | [process/18-langfuse-observability-cost-analysis.md](process/18-langfuse-observability-cost-analysis.md) | **Observability live + AI cost appendix:** real Langfuse client (cloud) replacing the G6-07 stub — tool spans, LLM generations with model + tokens + cost, PHI-redacted; G7-07 [`ai-cost-analysis.md`](implementation/ai-cost-analysis.md) shipped; deployed to prod |

Dated entries under `process/journal/week-N/` are session journals between milestones; they are not listed in the table.


## Demo data seeding (local Docker)

Synthetic primary-care **demo calendar** for AgentForge uses **2026-05-04 (Monday) and 2026-05-05 (Tuesday)** only. Each of the **28 demo patients appears exactly once** across those two days; extra template slots are skipped so the schedule stays realistic. After a DB reset / demo install, run the seeders **in order** (from `docker/development-easy/`):

```bash
docker compose exec openemr php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_cohort.php
docker compose exec openemr php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_appointments.php
docker compose exec openemr php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_visit_intake.php
```

- [`seed_appointments.php`](../../contrib/util/agentforge/seed_appointments.php) writes [`cohort/appointments.md`](cohort/appointments.md).
- [`seed_visit_intake.php`](../../contrib/util/agentforge/seed_visit_intake.php) creates exactly one same-day **intake encounter** per seeded appointment (reason prefixed `[AgentForge Intake]`, MA vitals, nursing note, social-history touch-up). It also **deletes** any prior `[AgentForge Intake]` encounters (idempotent) and removes encounters dated **2026-04-28–2026-05-02** for demo patients (stock, cohort, scheduled) to clear the old rolling-window artifacts.

## References

- [references/](references/) — case study PDF and other static references

## How to extend this folder

1. Add the next milestone as `process/18-<short-slug>.md` (next index **after `17`** in the table above).
2. Update the table above so the index stays the single map of the trail.
3. For working notes between milestones, add dated entries as `process/journal/week-N/MMDD-THHMM-topic.md`. The skill computes `N` from `course-start` in this README's frontmatter; create `week-N/` lazily if missing. Link decisions worth surfacing back into the relevant numbered process file.
4. If `02-tooling-and-skills.md` grows too long, split changelogs into `02b-skills-changelog.md`.
