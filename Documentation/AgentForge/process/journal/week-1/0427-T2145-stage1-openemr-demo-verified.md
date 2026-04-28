---
date: 2026-04-27
topic: Stage 1 OpenEMR local — Docker, demo data, Finder
related_milestone: process/04-stage1-local-dev-runbook.md
---

# Stage 1 OpenEMR demo verified — session journal

## Goal

Complete Gauntlet Stage 1: run OpenEMR locally with **realistic sample data**, document setup, and be able to **click through** staff workflows. User confirmed success: demo data loaded; providers and clients visible in-app.

## Context

Earlier in the week the plan favored **Docker easy-dev** + **`dev-reset-install-demodata`** (curated dataset). Docker was initially missing on the Mac (`zsh: command not found: docker`). After Docker Desktop, `localhost:8300` worked; login and empty Finder were debugged until demo load and navigation to **Finder** were understood.

## Key decisions

### Decision: Docker easy-dev as canonical local path

- **Prompt:** Plan Stage 1 and later discussion of Gauntlet instructors suggesting Docker might add complexity; deploy target TBD.
- **Recommendation:** Stay with [docker/development-easy](../../../../docker/development-easy) per upstream [CONTRIBUTING.md](../../../../CONTRIBUTING.md); defer native LAMP and production shape to Presearch ([03-presearch-checklist.md](../../03-presearch-checklist.md)).
- **Outcome:** Runbook [04-stage1-local-dev-runbook.md](../../04-stage1-local-dev-runbook.md) remains the single source for commands and ports.

### Decision: Curated demo data only (no Synthea in Stage 1)

- **Prompt:** User chose Option 2 — use existing curated demo rather than synthetic volume import.
- **Recommendation:** `docker compose exec openemr /root/devtools dev-reset-install-demodata` only; skip `import-random-patients` until a later stage needs scale.
- **Outcome:** Demo loaded successfully; providers/clients visible.

### Decision: Staff-only scope for MVP stories; patient portal deferred

- **Prompt:** User clarified login is staff/practitioner; role usernames map to future user stories; patient portal not in scope for now.
- **Recommendation:** Document wiki staff accounts (`admin`, `physician`, `clinician`, `accountant`, `receptionist`); ignore portal logins for AgentForge scope until needed.
- **Outcome:** Captured in runbook and this journal.

### Decision: Where to see mock patients in the UI

- **Prompt:** Logged in but could not find patient/record data until demo was loaded and navigation clarified.
- **Recommendation:** **Finder** tab or **Patient → Find Patient** → search → open chart; empty results usually mean demo SQL not loaded yet.
- **Outcome:** User verified data visible after demo load; runbook now includes a **Finding demo patients** section with menu paths.

## Trade-offs and alternatives

- **Native PHP/MySQL install** — Closer to some production VMs; higher setup cost on macOS (many `composer.json` extensions). Deferred.
- **Synthea import** — More patients/richer charts; slower and unnecessary for Stage 1. Deferred.

## Tools, dependencies, commands

- Docker Desktop (macOS), Docker Compose v2.
- `cd …/docker/development-easy && docker compose up --detach --wait`
- `docker compose exec openemr /root/devtools dev-reset-install-demodata`
- Staff login: `admin` / `pass` (and role accounts per [Development Demo wiki](https://www.open-emr.org/wiki/index.php/Development_Demo#Demo_Credentials)).

## Files touched

- **Modified:** `Documentation/AgentForge/process/04-stage1-local-dev-runbook.md`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0427-T2145-stage1-openemr-demo-verified.md`
- **Modified:** `Documentation/AgentForge/README.md` (“How to extend” next milestone = `05-`, not duplicate `04-`)

## Outcomes

OpenEMR easy-dev runs locally; curated demo dataset is loaded; **Finder** shows mock patients/clients; Stage 1 exploration unblocked. Runbook updated with Docker PATH troubleshooting, staff-role note, UI navigation, and checked verification items.

## Next steps

- [ ] Work through [03-presearch-checklist.md](../../03-presearch-checklist.md) using a running instance for grounded notes.
- [ ] (Optional) Record `docker --version` / `docker compose version` in the runbook session table for reproducibility.
- [ ] (Optional) Log in as `receptionist` or `physician` to compare ACL-visible menus for user-story drafting.

## Links

- Milestone runbook: [process/04-stage1-local-dev-runbook.md](../../04-stage1-local-dev-runbook.md)
- Upstream contributor setup: [CONTRIBUTING.md](../../../../CONTRIBUTING.md) (local development + devtools)
