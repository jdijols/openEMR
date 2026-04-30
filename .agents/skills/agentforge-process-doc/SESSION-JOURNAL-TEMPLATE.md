# Session Journal Template

Copy this file to `Documentation/AgentForge/process/journal/week-N/MMDD-THHMM-<short-topic>.md` and fill in. The week number `N` comes from `course-start` in the AgentForge README frontmatter. **The `MMDD-THHMM` prefix and YAML `date:` must come from US Central (`America/Chicago`) via the main skill’s shell commands — never guessed.** Highlights only — no full transcripts. Aim for one screen.

---

```markdown
---
date: YYYY-MM-DD
topic: <one-line topic>
related_milestone: <e.g. process/04-users-and-workflow.md, or "none">
---

# <Topic> — session journal

## Goal

<1–3 sentences on what the user wanted out of this session. Quote a key prompt if it sharpens the goal.>

## Context

<Optional. Anything a future reader needs to understand why this session happened — prior decisions, constraints, recent commits. Skip if obvious from the milestone link.>

## Key decisions

<2–6 entries. Each entry covers one pivot point. Skip routine reads, formatting tweaks, and clarifying back-and-forth.>

### Decision: <short name>

- **Prompt:** "<user prompt verbatim or lightly trimmed, 1–3 lines>"
- **Recommendation:** <1–3 sentence summary of the agent's answer or chosen option, including the *why*.>
- **Outcome:** <what was decided. Link to file/line if it materialized in code or docs.>

### Decision: <short name>

- **Prompt:** "..."
- **Recommendation:** ...
- **Outcome:** ...

## Trade-offs and alternatives

<Bullet list of options considered but not taken, with one-line reason. Skip if all decisions above already capture this.>

- <Option A> — <why not>
- <Option B> — <why not>

## Tools, dependencies, commands

<Anything installed, upgraded, removed, or invoked that future runs need to reproduce. Include exact commands. Skip if none.>

- `npx skills@latest add ...`
- `composer require ...`
- `docker compose ...`

## Files touched

<Full repo-relative paths. Group by created / modified / deleted.>

- **Created:** `path/to/file`
- **Modified:** `path/to/file`
- **Deleted:** `path/to/file`

## Outcomes

<1–3 sentences on what is now true that was not true before this session. Be concrete (e.g. "skill X is installed", "README points to canonical path", "step 4 of the trail exists").>

## Next steps

<Bullet list. Each item is actionable and small enough to be the seed of a future session. If a next step is big enough to be a milestone, note that — the next invocation of this skill will likely add it as `process/NN-<slug>.md`.>

- [ ] <next step>
- [ ] <next step>

## Links

- Numbered milestone (if any): [process/NN-...](../NN-....md)
- Related ADR / external doc: <url>
```

---

## Notes for the agent filling this in

- **Filename and frontmatter dates:** Run `TZ=America/Chicago date +"%m%d-T%H%M"` for the prefix and `TZ=America/Chicago date +"%Y-%m-%d"` for YAML `date:`; do not invent `HHMM`.
- **Highlights only.** If a section has no content, write `_None this session._` instead of padding.
- **Decision count target:** 2–6. If you have more than 8, you are probably logging non-pivots.
- **Do not paste full transcripts** under any section. Quote the prompt that mattered, summarize the answer.
- **File paths must be real and repo-relative.** Verify before committing.
