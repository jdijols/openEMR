---
date: 2026-04-27
topic: agentforge-process-doc skill creation
related_milestone: none (tooling change; logged in process/02-tooling-and-skills.md changelog)
---

# AgentForge process-doc skill — session journal

## Goal

Build a local agent skill that turns end-of-chat sessions and new process milestones into concrete updates to the AgentForge process trail with one invocation. Triggers: "process documentation", "add process file to documentation", "compact and document". Must capture user prompts and agent recommendation summaries at key decision points — highlights only, not transcripts — and must keep README index-row + numbered file in sync so adding step 4, step 5, etc. stays trivial.

## Context

The AgentForge folder ([Documentation/AgentForge/](../../../README.md)) had three numbered process files and a README trail table, but no automated way to extend it. The repo also had `.agents/skills/` populated with three Matt Pocock skills (vendored via `npx skills@latest add`, hashes tracked in [skills-lock.json](../../../../../skills-lock.json)) and a stale `docs/agentforge/` reference in the root README from before the folder was renamed to `Documentation/AgentForge/`.

## Key decisions

### Decision: canonical AgentForge docs path

- **Prompt:** "option A (Documentation/AgentForge) since I made that change to the file structure and if it conflicts with the current readme text, then update the readme as necessary to make it coherent"
- **Recommendation:** Treat `Documentation/AgentForge/` as the single source of truth, hardcode that into the new skill, and patch all stale `docs/agentforge/` references (root README, process file frontmatter, 02 doc) so the path is consistent across the repo.
- **Outcome:** Done in three files — [README.md](../../../../../README.md) line 25, [process/02-tooling-and-skills.md](../../02-tooling-and-skills.md) line 25, and `fork_docs_path` frontmatter in [process/01-agentforge-impressions.md](../../01-agentforge-impressions.md) line 3. Skill instructions now warn against writing under `docs/agentforge/` ([SKILL.md](../../../../../.agents/skills/agentforge-process-doc/SKILL.md) "Repo hygiene").

### Decision: capture prompts + recommendations at every pivot

- **Prompt:** "AI needs to include my prompts and their responses, like a summary of the response for key decision points. Not every single transcript of the entire conversation, but any time there was a big critical decision, we have to note what my prompt was that went into that decision and what the agent's summary of the agent's recommendation out of that... only the highlights."
- **Recommendation:** Add a structured **Key decisions** section to the journal template using a three-field format — **Prompt** (verbatim or lightly trimmed), **Recommendation** (1–3 sentence summary), **Outcome** (what got decided, with link if it materialized). Cap at 2–6 entries per session and include explicit "what counts as a pivot" / "what to skip" lists so the agent does not log every greeting or grep call.
- **Outcome:** Implemented in [SKILL.md](../../../../../.agents/skills/agentforge-process-doc/SKILL.md) section 3 and [SESSION-JOURNAL-TEMPLATE.md](../../../../../.agents/skills/agentforge-process-doc/SESSION-JOURNAL-TEMPLATE.md). This very file is the first one written under the rule.

### Decision: split the skill across three files (progressive disclosure)

- **Prompt:** Implicit — the user attached agentskills.io guidance and emphasized "we want to make very simple and easy to understand."
- **Recommendation:** Follow agentskills.io progressive-disclosure pattern — keep `SKILL.md` lean (~110 lines, well under the 500-line spec ceiling) with the workflow and decision rules; push the paste-ready template into `SESSION-JOURNAL-TEMPLATE.md` and the slug/index rules into `MILESTONE-NAMING.md`. Same pattern the existing `improve-codebase-architecture` skill uses (`DEEPENING.md`, `INTERFACE-DESIGN.md`, `LANGUAGE.md`).
- **Outcome:** Three files, 232 lines total. SKILL.md describes the workflow; the other two are loaded only when the agent needs them.

### Decision: do not register this skill in skills-lock.json

- **Prompt:** Implicit — the user asked how the skill installation should work.
- **Recommendation:** [skills-lock.json](../../../../../skills-lock.json) is a hash registry for **remote** skills vendored via `npx skills@latest add` (currently tracks `mattpocock/skills` entries). A local, repo-authored skill does not need an entry. Cursor reads `.agents/skills/` directly; for Claude Code / Kiro mirror the folder to `.claude/skills/` / `.kiro/skills/` (mirroring the pattern already in place for the Pocock skills).
- **Outcome:** No `skills-lock.json` change. Documented in the [02-tooling-and-skills.md](../../02-tooling-and-skills.md) changelog bullet for this date.

## Trade-offs and alternatives

- **One mega-file vs split into three** — One file would have been simpler to discover but blown the agentskills.io progressive-disclosure budget and made the "highlights only" template easy to ignore.
- **Auto-commit after writing** — Considered making the skill commit on the user's behalf at the end. Rejected: matches the existing CLAUDE.md rule that commits only happen when explicitly requested.
- **Auto-add a numbered file every session** — Considered. Rejected because most sessions are tooling churn or partial work, not new milestones; forcing `process/NN-*.md` every time would dilute the trail.

## Tools, dependencies, commands

_None this session._ No installs, no upgrades, no external tooling. All edits were file writes inside the repo.

## Files touched

- **Created:**
  - `.agents/skills/agentforge-process-doc/SKILL.md`
  - `.agents/skills/agentforge-process-doc/SESSION-JOURNAL-TEMPLATE.md`
  - `.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md`
  - `Documentation/AgentForge/process/journal/week-1/0427-T1956-agentforge-process-skill.md` (this file; originally `journal/2026-04-27-agentforge-process-skill.md`, moved/renamed in the next session)
- **Modified:**
  - `README.md` (root) — fixed `docs/agentforge/` → `Documentation/AgentForge/`
  - `Documentation/AgentForge/process/01-agentforge-impressions.md` — fixed `fork_docs_path` frontmatter
  - `Documentation/AgentForge/process/02-tooling-and-skills.md` — fixed stale path on line 25, appended a 2026-04-27 changelog bullet for the new skill

## Outcomes

- A local skill at `.agents/skills/agentforge-process-doc/` is discoverable from any of the three trigger phrases and produces journal entries (and optional numbered milestones) in `Documentation/AgentForge/`.
- The journal-vs-numbered split, slug rules, and README index invariant are now codified, so adding step 4, step 5, etc. is a single skill invocation rather than a manual checklist.
- Repo is internally coherent: every reference to the AgentForge docs uses the canonical `Documentation/AgentForge/` path.

## Next steps

- [ ] Mirror `.agents/skills/agentforge-process-doc/` to `.claude/skills/` and `.kiro/skills/` if those agents are in active use on this fork.
- [ ] Run the skill on a real working session (not its own creation) to validate the Key Decisions cap of 2–6 entries holds without padding.
- [ ] When step 4 of the trail materializes, use this skill to add `process/04-<slug>.md` and a README row in one motion — that is the real DX test.
- [ ] Decide whether to backfill a Decisions section in the existing `01-`/`02-`/`03-` files from any historical journal entries, or leave them as-is (they predate this skill).

## Links

- Skill source: [.agents/skills/agentforge-process-doc/SKILL.md](../../../../../.agents/skills/agentforge-process-doc/SKILL.md)
- Template: [.agents/skills/agentforge-process-doc/SESSION-JOURNAL-TEMPLATE.md](../../../../../.agents/skills/agentforge-process-doc/SESSION-JOURNAL-TEMPLATE.md)
- Naming rules: [.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md](../../../../../.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md)
- Tooling changelog entry: [process/02-tooling-and-skills.md](../../02-tooling-and-skills.md) (Changelog, 2026-04-27)
- Agent Skills spec: <https://agentskills.io/specification>
