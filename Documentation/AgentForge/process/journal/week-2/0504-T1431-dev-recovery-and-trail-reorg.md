---
date: 2026-05-04
topic: Local-dev OpenEMR recovery (sqlconf reset to baseline) + reorg of process trail into per-week milestone directories
related_milestone: process/milestones/week-2/01-local-dev-recovery-runbook.md
---

# Local-dev recovery + Week-2 trail reorg — session journal

## Goal

User opened `localhost:8300` mid-Week-2 and got the OpenEMR Setup wizard ("Pre Install — Checking File and Directory Permissions") instead of the usual login. Goal of the first half: diagnose what reset and recover without losing the 28-patient AgentForge demo DB. Goal of the second half (after recovery): "process document this chat" and reorganize the process trail so Week-1 entries don't get confused with Week-2.

## Context

Cohort `course-start: 2026-04-27`; today is `2026-05-04` → Week 2 begins. Local stack had been up multi-day; `openemr` + `agentforge-api` containers had been recreated ~32 hours ago. The MariaDB volume (`databasevolume`) was untouched; only the per-site Docker named volume (`development-easy_sitesvolume`) had reverted to the openemr-flex image baseline (every file in `sites/default/` dated `Apr 27 17:44`, including `sqlconf.php` with `$config = 0` and `$host = 'localhost'`).

## Key decisions

### Decision: don't run the wizard — patch `sqlconf.php` in place

- **Prompt:** "I'm just trying to load my dev environment, and when I open the local host, it gives me this weird message I'd never seen before. What should I do?"
- **Recommendation:** Stop — clicking "Proceed to Step 1" runs OpenEMR's SQL bootstrap and would rewrite the existing `openemr` DB, wiping the AgentForge state. Verified DB intact (28 patients, 18 modules) and that the openemr container reaches MariaDB by service name. Edit `sites/default/sqlconf.php` to `$host = 'mysql'` + `$config = 1` and reload. Reversible.
- **Outcome:** Patched via `docker compose exec openemr sed -i ...` with a `.bak` left in the volume; `localhost:8300` now redirects to `OpenEMR Login`.

### Decision: VPS is unaffected — but worth recording for future deploys

- **Prompt:** "This doesn't affect our VPS deployment, does it?"
- **Recommendation:** No — VPS is a separate machine with its own filesystem and DB. The local `sitesvolume` reset is purely local. Our deploy workflow imports a full local DB dump into the VPS DB, which doesn't sync `sites/default/documents/` (also wiped here) — and the VPS has its own working `sqlconf.php`.
- **Outcome:** Captured in this journal and surfaced as a durable Week-2 milestone ([01-local-dev-recovery-runbook.md](../../milestones/week-2/01-local-dev-recovery-runbook.md)) so the next deploy session sees it.

### Decision: reorg shape — `process/milestones/week-N/` (user-proposed inversion)

- **Prompt:** "Why don't we go from process to milestones to week? There's symmetry there without making a big shift specifically for journals."
- **Recommendation:** Better than my initial `process/week-N/milestones/` proposal — this layout mirrors the existing `process/journal/week-N/` exactly, so both top-level concepts (milestones, journal) share one mental model. No journal moves needed.
- **Outcome:** All 19 existing milestones moved via `git mv` (history preserved). `.gitkeep` placeholder in empty `week-2/`.

### Decision: per-week milestone numbering

- **Prompt:** "I'd prefer per-week numbering, so the first milestone will be numbered one for week two."
- **Recommendation:** Each week's sub-table restarts at `01`. Filenames repeat across weeks but full paths stay unique, and each week's narrative arc reads cleanly.
- **Outcome:** README's Process Trail split into `### Week 1` / `### Week 2` sub-tables. SKILL.md and MILESTONE-NAMING.md updated to enforce per-week `max(#) + 1`.

### Decision: leave journals at `process/journal/week-N/`

- **Prompt:** "I think we should leave alone and have the folder path go from process to journal then to week."
- **Recommendation:** Journals already organize by week; no churn needed. Combined with the milestone inversion above, the layout `process/{milestones,journal}/week-N/` is fully symmetric.
- **Outcome:** No journal files moved. This entry lands at `process/journal/week-2/0504-T1431-...md` (lazy-created `week-2/`).

### Decision: fix a pre-existing skill path-math bug while I was in there

- While editing SKILL.md the cheat sheet read "repo root is `../../../../`" (4 ups) from a journal — wrong by 1, since `Documentation/AgentForge/process/journal/week-N/` is 5 levels deep. Existing journal files (e.g. [`0427-T1956-agentforge-process-skill.md`](../week-1/0427-T1956-agentforge-process-skill.md)) already correctly use 5 ups; only the skill's instruction text was wrong.
- **Outcome:** Cheat sheet and example link in SKILL.md fixed to use 5 ups.

## Trade-offs and alternatives

- **Reorg via sed vs. Python.** ~300 cross-references across 8 distinct path patterns (Pattern A: `process/NN-...`, Pattern B: `../../NN-...`, plus 6 sub-patterns for moved-milestone relative URLs of varying depth). Sed with explicit anchoring worked once-and-done but required care for idempotency. Python would have been cleaner; sed was faster to run.
- **Commit `sqlconf.php` change?** The host bind mount propagated my container-side write back to the working tree (`M sites/default/sqlconf.php`). Tempting to commit the working values (`$host=mysql`, `$config=1`), but those are docker-compose-service-specific — the repo baseline (`$host=localhost`, `$config=0`) is correct for fresh installs and the live VPS. Leaving as a local working-tree mod for the user to decide.
- **Move journals into `process/week-N/journal/` for full hierarchy uniformity?** Considered; rejected per user. Journals already separate by week, and the inverted milestone layout makes the symmetry explicit without journal churn.

## Tools, dependencies, commands

- No new dev-side dependencies installed.
- Recovery commands captured in the new milestone runbook (`process/milestones/week-2/01-local-dev-recovery-runbook.md`).
- Reorg sed patterns:
  ```bash
  # Pattern A
  git grep -lE 'process/[0-9]{2}-[a-z0-9-]+\.md' | xargs sed -i '' -E 's|process/([0-9]{2}-[a-z0-9-]+\.md)|process/milestones/week-1/\1|g'
  # Pattern B
  git grep -lE '\.\./\.\./[0-9]{2}-[a-z0-9-]+\.md' | xargs sed -i '' -E 's|\.\./\.\./([0-9]{2}-[a-z0-9-]+\.md)|../../milestones/week-1/\1|g'
  # Plus 6 sub-patterns inside moved milestones to fix relative URLs to repo root, implementation/, references/, journal/, archive/.
  ```

## Files touched

- **Created:**
  - `Documentation/AgentForge/process/milestones/week-2/.gitkeep`
  - `Documentation/AgentForge/process/journal/week-2/0504-T1431-dev-recovery-and-trail-reorg.md` (this file)
  - `Documentation/AgentForge/process/milestones/week-2/01-local-dev-recovery-runbook.md` (next step in this session)
- **Moved (git mv, 19):** `Documentation/AgentForge/process/{NN-slug}.md` → `Documentation/AgentForge/process/milestones/week-1/{NN-slug}.md`.
- **Modified by reorg:**
  - `Documentation/AgentForge/README.md` — Process Trail split into per-week sub-tables; "How to extend" rewritten for per-week numbering.
  - `.agents/skills/agentforge-process-doc/SKILL.md` — path conventions, per-week numbering rule, repo-hygiene check, fixed pre-existing path-math bug.
  - `.agents/skills/agentforge-process-doc/SESSION-JOURNAL-TEMPLATE.md` — example link updated.
  - `.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md` — header path, numbering rule, "things that should never happen" expanded.
  - ~58 markdown files touched by Pattern A; ~38 by Pattern B; 19 moved milestones touched by URL-fix sub-patterns.
- **Container-side fix (host bind-mount propagated):** `sites/default/sqlconf.php` — `$host=mysql`, `$config=1`. Backup at `sites/default/sqlconf.php.bak` (inside the named volume).

## Outcomes

- Local dev env restored: `localhost:8300` → `OpenEMR Login`. AgentForge demo data intact.
- Process trail reorganized to per-week milestones; mental model symmetric with journals (`process/{milestones,journal}/week-N/`).
- Skill files updated to enforce the new conventions on all future milestone/journal additions.
- Pre-existing skill path-math bug fixed.

## Next steps

- [ ] Commit the reorg (separate commit from the local `sqlconf.php` mod, which is machine-specific).
- [ ] Decide whether to commit `sites/default/sqlconf.php` working values or revert and document the recovery as a runbook-only artifact (current default).
- [ ] When Week-2 cohort milestones land, they go at `process/milestones/week-2/02-...md` and onward.
- [ ] Pre-existing journal-link cleanup (out of scope for this session): a link-integrity sweep across `process/journal/week-1/` and a few moved milestones (10, 11, 12) shows ~175 broken links — mostly typo'd timestamps in journal cross-references (e.g. `0429-T2015` vs actual `0429-T2115`) and 4-up `../../../../X.md` paths to repo-root files that should be 5-up. None caused by this reorg; same class as the SKILL.md path-math bug fixed above. Worth a separate cleanup pass.

## Links

- Numbered milestone for this session: [process/milestones/week-2/01-local-dev-recovery-runbook.md](../../milestones/week-2/01-local-dev-recovery-runbook.md)
- Stage 1 local-dev runbook (Week 1 baseline): [process/milestones/week-1/04-stage1-local-dev-runbook.md](../../milestones/week-1/04-stage1-local-dev-runbook.md)
- VPS deployment runbook (confirmed unaffected): [process/milestones/week-1/09-vps-live-deployment.md](../../milestones/week-1/09-vps-live-deployment.md)
- AgentForge README (trail index): [Documentation/AgentForge/README.md](../../../README.md)
