---
date: 2026-04-27
topic: flatten journal restructure
related_milestone: none (tooling change; logged in process/02-tooling-and-skills.md changelog)
---

# Journal restructure: `week-N/MMDD-THHMM-topic.md` — session journal

## Goal

Make the AgentForge journal scannable and chronologically unambiguous across 3 weeks of frequent multi-chat days. Resolve whether the `process/journal/` subdirectory was earning its keep, and adopt a filename convention that distinguishes multiple chats on the same day.

## Context

After dogfooding the new `agentforge-process-doc` skill in the previous session ([0427-T1956-agentforge-process-skill.md](0427-T1956-agentforge-process-skill.md)), only one journal entry existed at `process/journal/2026-04-27-...md`. With one file in the subdirectory next to three numbered files, the layout looked top-heavy. The user surfaced this and asked whether the journal subdirectory was needed at all — but framed the question as "tell me if I'm thinking about this wrong" rather than a directive, which forced a real design conversation rather than a reflexive flatten.

## Key decisions

### Decision: keep `journal/` subdirectory (reversed an earlier wrong recommendation)

- **Prompt:** "I'm not sure which one is actually better. We can always change the README file or change the skill to match what is best. What we actually need to figure out is what's best for this project, which we're going to work on over the course of three weeks. These chat logs are going to be quite numerous and long, and the journal aspect of this will grow in size. I just want to make it easy for myself and AI to understand what was going on chronologically. What is the best approach for this?"
- **Recommendation:** Owned the earlier mistake of recommending flatten — that recommendation optimized for the cosmetic complaint at 4-file scale and ignored the projected ~50–90 files at end of week 3. At that scale, `ls process/` becomes a wall, AI context gets burned listing it, and the directory split actually earns its keep because numbered files (curated, ~10) and journal entries (chronological, ~70) have genuinely different cardinality, change frequency, and read patterns.
- **Outcome:** Subdirectory kept. The user accepted the reversal: _"Yeah, I agree. This sounds way better."_ No file moves required for this decision alone — the subdirectory already existed.

### Decision: sub-group journal by week (`journal/week-N/`)

- **Prompt:** Same prompt as above; the user explicitly added _"I'm even fine with the week-by-week subgrouping."_
- **Recommendation:** Match the natural cadence of the 3-week course (the [Week 1 PDF](../../../references/Week%201%20-%20AgentForge.pdf) already establishes weeks as the unit). Each week directory is bounded to ~10–25 entries — still scannable, easy to grep, easy for AI to load `journal/week-2/` as "current state" without pulling in unrelated noise from earlier weeks. Also gives a natural retro boundary at the end of each week.
- **Outcome:** Layout is now `process/journal/week-N/<file>.md`. Existing entry moved to [process/journal/week-1/0427-T1956-agentforge-process-skill.md](0427-T1956-agentforge-process-skill.md). Future weeks (`week-2/`, `week-3/`) are created lazily by the skill on first write.

### Decision: filename format `MMDD-THHMM-topic.md`

- **Prompt:** "we should actually change the day formatting to be daytime and condense it a little bit, just so we can clearly see that one chat was after another"
- **Recommendation:** Offered three formats — compact (`20260427-2012-...`), dashed (`2026-04-27-2012-...`), and ISO-ish (`2026-04-27T20-12-...`). User picked a fourth shape — `MMDD-THHMM` — which drops the year entirely (year is implicit from the `week-N/` parent) and uses `T` as an ISO-style time separator. Most condensed of all options; sorts lexically; multiple chats per day are distinguishable by the time portion.
- **Outcome:** Convention codified in [SKILL.md](../../../../../.agents/skills/agentforge-process-doc/SKILL.md) Section 2 and [MILESTONE-NAMING.md](../../../../../.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md). This file (`0427-T2030-...`) and the moved earlier entry (`0427-T1956-...`) are the first two entries under the rule, demonstrating chronological sort within a single day.

### Decision: store `course-start` in AgentForge README frontmatter

- **Prompt:** Implicit in the week-grouping decision — the skill needs to compute `N` from somewhere.
- **Recommendation:** Use YAML frontmatter at the top of [Documentation/AgentForge/README.md](../../../README.md) instead of a new dotfile. The README is already the canonical "what is this project" file, frontmatter precedent exists in [process/01-agentforge-impressions.md](../../01-agentforge-impressions.md), and a typo or off-by-one is fixable in one line. The skill reads `course-start`, computes `N = max(1, floor((today - course-start) / 7) + 1)`, and asks the user once if the frontmatter is missing.
- **Outcome:** `course-start: 2026-04-27` added to the AgentForge README. The clamp to `>= 1` means any stray pre-course journal entry would still get `week-1` rather than `week-0` or negative.

## Trade-offs and alternatives

- **Flat `process/` with bare date prefix** — Considered and initially recommended. Rejected after thinking about scale: at 50–90 files in one directory, it becomes a wall regardless of prefix scheme.
- **Dropped numbered convention entirely (everything date-prefixed)** — Considered. Rejected because the numbered files signal "milestone, read in order" and the dated files signal "chronological log entry" — collapsing them loses the milestone signal and forces every reader to consult the README to know which files are curated vs raw.
- **Auto-week subdirectories scaffolded upfront** (`week-2/`, `week-3/` empty at start) — Rejected. Lazy creation means an empty subdirectory never appears in `ls` until there's something to put in it.
- **Week metadata in a new dotfile (`.agentforge.yml`)** — Rejected in favor of README frontmatter to avoid adding a new file the user has to remember exists.

## Tools, dependencies, commands

_None this session._ All changes were file moves and content edits. The journal move used `mv` (the file wasn't yet tracked by git, so `git mv` failed with `fatal: not under version control` — switched to plain `mv`).

## Files touched

- **Created:**
  - `Documentation/AgentForge/process/journal/week-1/` (directory)
  - `Documentation/AgentForge/process/journal/week-1/0427-T2030-flatten-journal-restructure.md` (this file)
- **Moved/renamed:**
  - `Documentation/AgentForge/process/journal/2026-04-27-agentforge-process-skill.md` → `Documentation/AgentForge/process/journal/week-1/0427-T1956-agentforge-process-skill.md`; all internal relative links bumped by one extra `../` since the file is now one directory deeper
- **Modified:**
  - `Documentation/AgentForge/README.md` — added `course-start: 2026-04-27` YAML frontmatter; rewrote "How to extend" item 3 for the new path; added a one-line note under the Process trail table explaining that dated entries are not in the index
  - `.agents/skills/agentforge-process-doc/SKILL.md` — Section 2 rewritten to compute week from frontmatter and write to `week-N/MMDD-THHMM-topic.md`; example link paths bumped to reflect the new journal depth; added a note explaining how relative links work from `journal/week-N/`
  - `.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md` — replaced the "Dated journal" section with the new path, week-computation formula, and lazy-creation rule; expanded "Things that should never happen" with three new entries (no `course-start` consultation, no proactive future-week scaffolding, no date-only filenames)
  - `.agents/skills/agentforge-process-doc/SESSION-JOURNAL-TEMPLATE.md` — opening line updated to new path
  - `Documentation/AgentForge/process/02-tooling-and-skills.md` — second `2026-04-27` changelog bullet appended describing the restructure

## Outcomes

- Journal layout is now `Documentation/AgentForge/process/journal/week-N/MMDD-THHMM-topic.md` — bounded directories, chronological filenames, year implied by the parent.
- Multiple chats on the same day are visually distinguishable in `ls` and sort correctly.
- The skill computes `week-N` automatically from `course-start` in the AgentForge README frontmatter; no manual week-tracking required.
- Existing journal entry moved cleanly to the new location with all relative links rewritten and validated.
- The 02 changelog now records both the skill creation (this morning's pivot) and the restructure (this evening's pivot) — two end-of-chat journal entries already shape the trail.

## Next steps

- [ ] Next session: verify `week-N/` lazy creation works on the first entry written after the date crosses into week 2 (or just bump `course-start` to test).
- [ ] Confirm the relative-link convention scales cleanly when journal entries cross-link to *each other* (e.g. this entry already links back to `0427-T1956-...md` as a sibling — pattern works, but worth re-checking when a week-2 entry references a week-1 entry).
- [ ] Mirror `.agents/skills/agentforge-process-doc/` to `.claude/skills/` and `.kiro/skills/` if those agents come into active use.
- [ ] Consider whether `course-start` should also appear in the root [CLAUDE.md](../../../../../CLAUDE.md) for redundancy, or whether the frontmatter-in-AgentForge-README is enough.

## Links

- Previous journal entry (skill creation): [0427-T1956-agentforge-process-skill.md](0427-T1956-agentforge-process-skill.md)
- Skill source: [.agents/skills/agentforge-process-doc/SKILL.md](../../../../../.agents/skills/agentforge-process-doc/SKILL.md)
- Naming and week-computation rules: [.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md](../../../../../.agents/skills/agentforge-process-doc/MILESTONE-NAMING.md)
- Tooling changelog entry: [process/02-tooling-and-skills.md](../../02-tooling-and-skills.md) (Changelog, second 2026-04-27 bullet)
- AgentForge README (with `course-start` frontmatter): [Documentation/AgentForge/README.md](../../../README.md)
