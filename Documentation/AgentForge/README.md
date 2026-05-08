---
course-start: 2026-04-27
---

> **Project README:** [`/README.md`](../../README.md). Clinical Copilot is the product; this folder is the program-context build documentation from the Gauntlet AI AgentForge cohort that produced it.

# AgentForge (Gauntlet AI) — Clinical Copilot Process Trail

This folder holds **course and process documentation** for the Clinical Copilot work developed on this OpenEMR fork during the Gauntlet AI AgentForge program. It is separate from upstream OpenEMR’s `Documentation/` tree.

## Clinical Copilot access control (instructor grading)

**Who gets the Clinical Copilot rail, Context Service, and confirmed writes—and who does not—is defined in OpenEMR GACL**, not environmental toggles alone. Canonical summary for examiners:

- **[process/milestones/week-1/16-clinical-copilot-acl-role-gate.md](process/milestones/week-1/16-clinical-copilot-acl-role-gate.md)** — policy table (**`patients/demo`** floor + **`agentforge/use`** + **`agentforge/propose_write`**), **default-seeded groups** (`admin`, `doc`, `clin`, `breakglass`) vs **explicitly excluded** preset roles (`front`, `back`, parent `users` without assignment), **`admin/super`** caveat, implementation links.
- **[Journal 0501-T2135](process/journal/week-1/0501-T2135-clinical-copilot-acl-role-gate.md)** — session decisions (GACL-only model, Emergency Login inclusion, Front Office / Accounting exclusion).
- Spec: **`PRD.md`** §4.9; implementation: **`interface/modules/custom_modules/oe-module-agentforge/README.md`** §4.9.

## Process trail (read in order)

Milestones are organized by cohort week under `process/milestones/week-N/`, with numbering restarting at `01` each week. Session journals live alongside under `process/journal/week-N/` and are not listed below.

### Week 1

| #   | File                                                                         | Purpose                                         |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | [process/milestones/week-1/01-agentforge-impressions.md](process/milestones/week-1/01-agentforge-impressions.md) | First-pass notes on the case study PDF          |
| 2   | [process/milestones/week-1/02-tooling-and-skills.md](process/milestones/week-1/02-tooling-and-skills.md)         | AI workflow: gstack, Cursor, Matt Pocock skills |
| 3   | [process/milestones/week-1/03-presearch-checklist.md](process/milestones/week-1/03-presearch-checklist.md)       | Pre-code research checklist (fill over time)    |
| 4   | [process/milestones/week-1/04-stage1-local-dev-runbook.md](process/milestones/week-1/04-stage1-local-dev-runbook.md) | Stage 1: Docker easy-dev + demo data runbook    |
| 5   | [process/milestones/week-1/05-stage2-deployment-decision.md](process/milestones/week-1/05-stage2-deployment-decision.md) | Stage 2: VPS + Compose deployment decision + trade-offs |
| 6   | [process/milestones/week-1/06-stage3-audit.md](process/milestones/week-1/06-stage3-audit.md)                     | Stage 3: audit process pointer → [`AUDIT.md`](../../AUDIT.md) |
| 7   | [process/milestones/week-1/07-stage4-users.md](process/milestones/week-1/07-stage4-users.md)                     | Stage 4: users process pointer → [`USERS.md`](../../USERS.md) |
| 8   | [process/milestones/week-1/08-stage5-architecture.md](process/milestones/week-1/08-stage5-architecture.md)       | Stage 5: architecture process pointer → [`ARCHITECTURE.md`](../../ARCHITECTURE.md) |
| 9   | [process/milestones/week-1/09-vps-live-deployment.md](process/milestones/week-1/09-vps-live-deployment.md)       | MVP: live OpenEMR on a Linux VPS (Vultr) + Compose; GitLab clone; nip.io / HTTPS path |
| 10  | [process/milestones/week-1/10-prd.md](process/milestones/week-1/10-prd.md)                                       | PRD + gate-ordered implementation task list; pointer to [`PRD.md`](../../PRD.md) and [`../../TASKS.md`](../../TASKS.md) |
| 11  | [process/milestones/week-1/11-gate0-complete.md](process/milestones/week-1/11-gate0-complete.md)                 | Gate 0 scaffold + contract spine closed; verification journal; handoff to Gate 1 |
| 12  | [process/milestones/week-1/12-gate1-gate2-complete.md](process/milestones/week-1/12-gate1-gate2-complete.md)       | Gate 1 security primitives + Gate 2 UC-A read spine closed; journal evidence; handoff to Gate 3 |
| 13  | [process/milestones/week-1/13-gate3-complete.md](process/milestones/week-1/13-gate3-complete.md)                 | Gate 3 UC-A read completeness closed; case presentation + verification; handoff to Gate 4 |
| 14  | [process/milestones/week-1/14-gate4-complete.md](process/milestones/week-1/14-gate4-complete.md)                 | Gate 4 UC-B confirmed writes closed; G4-10 chief-complaint E2E + `log_from='agent'` audit; handoff to Gate 5 |
| 15  | [process/milestones/week-1/15-gate6-complete.md](process/milestones/week-1/15-gate6-complete.md)                 | Gate 6 eval + observability + deploy closed (G6-01..G6-18 + G6-20); LLM provider swap + eval-runner refactor + Context HTTP-matrix backfill; handoff to Gate 7 |
| 16  | [process/milestones/week-1/16-clinical-copilot-acl-role-gate.md](process/milestones/week-1/16-clinical-copilot-acl-role-gate.md) | **Access control:** who may use Clinical Copilot (`agentforge/use`, `propose_write`) vs excluded preset roles; GACL layering; examiner links |
| 17  | [process/milestones/week-1/17-encounter-scoped-chart-bind-and-brief.md](process/milestones/week-1/17-encounter-scoped-chart-bind-and-brief.md) | **Open encounter scope:** appointment click context → session + AgentForge binder; brief vitals + Context `encounter_id` (not calendar “today”) |
| 18  | [process/milestones/week-1/18-langfuse-observability-cost-analysis.md](process/milestones/week-1/18-langfuse-observability-cost-analysis.md) | **Observability live + AI cost appendix:** real Langfuse client (cloud) replacing the G6-07 stub — tool spans, LLM generations with model + tokens + cost, PHI-redacted; G7-07 [`ai-cost-analysis.md`](implementation/ai-cost-analysis.md) shipped; deployed to prod |
| 19  | [process/milestones/week-1/19-final-submission-prep.md](process/milestones/week-1/19-final-submission-prep.md) | **Final submission prep:** UC count 3→10 (UC-A..UC-J incl. documentary med-rec + abnormal-lab surfacing), eval count 13→39 (4 instructor-named failure-mode rules + constraint-boundary describes-vs-recommends gate), CRUD soft-delete tools (vitals_delete, chief_complaint_delete), rebrand to "Clinical Copilot" with strategic product/program split, full submission-doc sync via `update-submission-files` skill |

### Week 2

| #   | File                                                                          | Purpose                                          |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | [process/milestones/week-2/01-local-dev-recovery-runbook.md](process/milestones/week-2/01-local-dev-recovery-runbook.md) | **Local-dev recovery runbook:** what to do when `localhost:8300` shows the OpenEMR Setup wizard (`sitesvolume` reset to baseline) — diagnostic check, sqlconf patch, why the VPS is unaffected; first observed 2026-05-04 |
| 2   | [process/milestones/week-2/02-architecture-and-task-plan.md](process/milestones/week-2/02-architecture-and-task-plan.md) | **W2 architecture + task plan locked:** brief-compliant [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md) (probe-validated Claude PDF/Vision extraction with `pdf-parse` cross-check, `pgvector` RAG, supervisor + 2 workers, citation contract + UI, 50-case eval gate) + gated [`TASKS.md`](../../TASKS.md) (3 gates, ~90 task IDs, S12 brief's hard gate); cohort sample patients planned as new-patient appointments; pre-implementation phase complete |
| 3   | [process/milestones/week-2/03-g2-mvp-execution.md](process/milestones/week-2/03-g2-mvp-execution.md) | **W2 G2-MVP execution + API smoke verified:** 33 of ~34 G2-MVP tasks done across 12 commits (`afcd330d7`→`99713875f`); cohort + chart prep, schemas + tests, PHP module (upload/bytes/observation), TS extractor + tool + orchestrator wiring, hybrid RAG (pgvector + bge-small + Cohere Rerank, 24 chunks), routing nudge, PHI redaction (S11), 10 CUI components. **Smoke gate (G2-MVP-58):** clinical question returned 5 USPSTF/ADA citations + 3 surviving claim blocks via `evidence_retrieve` source_pack envelope. Known gap deferred to G2-Early: `attach_and_extract` leaf source_packs. Three continuation options for G2-MVP-99 captured at the bottom of the milestone |
| 4   | [process/milestones/week-2/04-g2-early-gate-completion.md](process/milestones/week-2/04-g2-early-gate-completion.md) | **W2 G2-Early gate completion + final-bucket writeups:** brief's hard gate (eval-gate-blocks-regression) verified end-to-end + 5 of 7 brief MUST deliverables green + cost-latency report + architecture drift reconciliation + submission scoreboard drafted, in 8 conventional commits (`37998e86c`→`77076a872`). Supervisor handoff spans + selectModel + branching prompt; 50-case W2 boolean rubric eval suite (4/4/4/35/3) with pinned baseline + per-category regression gate; PR-blocking pre-push hook + GitHub Actions trigger expansion + self-injection rehearsal; required Langfuse fields (retrieval hits, extraction confidence, eval outcome event, per-step latency); bbox highlight overlay in DocumentModal fallback path. Cohort appointments migrated forward to 2026-05-10..13. W2 write tools cut to tier 4 mid-session, then REVERSED at session end — next session lifts the cut and builds the chart-write path before VPS deploy |
| 5   | [process/milestones/week-2/05-https-retrofit-deploy.md](process/milestones/week-2/05-https-retrofit-deploy.md) | **HTTPS retrofit + W2 final VPS deploy:** brought live VPS forward 18 commits (`d98bf6f13`→`3456a4e42`) plus in-deploy fix `a3b954ab6`; second Caddy site at `https://oe.108-61-145-220.nip.io` with Let's Encrypt cert (the Gauntlet submission URL); demo DB refreshed via local→VPS dump-and-import (cohort window 5/9–5/12, W2 pubpids 0029–0032, sidecar `agentforge_demo_patient_markers` table); latent TS2379 in `attach_and_extract.ts` caught only by prod `tsc -p tsconfig.build.json` and fixed in a one-line widen. Three post-deploy hardening items logged: Caddyfile compose-path mismatch, prek-side prod-tsc gap, npm-audit/Node-20 dependency drift |


## Demo data seeding (local Docker)

Synthetic primary-care **demo calendar** for AgentForge uses **Saturday 2026-05-09 through Tuesday 2026-05-12** (W2 submission weekend — shifted at process/milestones/week-2/05 on 2026-05-08; prior windows were 5/10..13 and 5/04..05). Saturday is a normal-mix clinic day with **11 appointments** (the four W2 cohort patients in 30-min back-to-back morning slots plus 7 established/new), Sun/Mon/Tue stay at **7 appointments each** — **32 demo patients** total, each appearing exactly once. After a DB reset / demo install, run the seeders **in order** (from `docker/development-easy/`):

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

1. **New milestone.** Add as `process/milestones/week-N/NN-<short-slug>.md`, where:
   - `N` is the current cohort week (computed from `course-start` in this README's frontmatter — same `N` as the journal directory).
   - `NN` is the next index in that week's sub-table above; **numbering restarts at `01` per week**.
2. Add a row to the matching week's sub-table so the index stays the single map of the trail.
3. **Working notes between milestones** go under `process/journal/week-N/MMDD-THHMM-topic.md`. The skill computes `N` from `course-start`; create `week-N/` lazily if missing. Link decisions worth surfacing back into the relevant numbered milestone.
4. If `02-tooling-and-skills.md` grows too long, split changelogs into a sibling `02b-skills-changelog.md` within the same week directory.
