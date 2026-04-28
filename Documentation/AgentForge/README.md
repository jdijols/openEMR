---
course-start: 2026-04-27
---

# AgentForge (Gauntlet AI)

This folder holds **course and process documentation** for the Clinical Co-Pilot / AgentForge work on this OpenEMR fork. It is separate from upstream OpenEMR’s `Documentation/` tree.

## Process trail (read in order)


| #   | File                                                                         | Purpose                                         |
| --- | ---------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | [process/01-agentforge-impressions.md](process/01-agentforge-impressions.md) | First-pass notes on the case study PDF          |
| 2   | [process/02-tooling-and-skills.md](process/02-tooling-and-skills.md)         | AI workflow: gstack, Cursor, Matt Pocock skills |
| 3   | [process/03-presearch-checklist.md](process/03-presearch-checklist.md)       | Pre-code research checklist (fill over time)    |
| 4   | [process/04-stage1-local-dev-runbook.md](process/04-stage1-local-dev-runbook.md) | Stage 1: Docker easy-dev + demo data runbook    |

Dated entries under `process/journal/week-N/` are session journals between milestones; they are not listed in the table.


## References

- [references/](references/) — case study PDF and other static references

## How to extend this folder

1. Add the next milestone as `process/05-<short-slug>.md` (increment the number; `04` is Stage 1 local dev).
2. Update the table above so the index stays the single map of the trail.
3. For working notes between milestones, add dated entries as `process/journal/week-N/MMDD-THHMM-topic.md`. The skill computes `N` from `course-start` in this README's frontmatter; create `week-N/` lazily if missing. Link decisions worth surfacing back into the relevant numbered process file.
4. If `02-tooling-and-skills.md` grows too long, split changelogs into `02b-skills-changelog.md`.
