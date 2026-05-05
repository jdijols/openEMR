# Milestone Naming and "Journal vs Numbered"

Quick reference for the AgentForge process trail. The README index is the source of truth; this doc only restates the rules so the agent does not have to re-derive them.

## Numbered process file: `process/milestones/week-N/NN-<slug>.md`

- **Week directory `week-N`** — same `N` as the journal directory; computed from `course-start` (see "Dated journal" section below). Numbering restarts at `01` per week, so `process/milestones/week-1/01-...md` and `process/milestones/week-2/01-...md` both exist as distinct files.
- **NN** — two digits, zero-padded (`01`, `02`, …). Next index = `max(#)` **within the current week's sub-table** in the README + 1.
- **slug** — kebab-case, 2–4 words, lowercase, ASCII only. Examples: `users-and-workflow`, `data-model-v1`, `agent-eval-harness`.
- **One row per file in the README** — same `#`, same path, one-line purpose, in the matching week's sub-table. Never let a file exist without a row, and never let a row point at a missing file.
- **First version stays small** — title + one-paragraph purpose + whatever decisions exist now. Do not pre-fill empty headings.
- **Splitting:** if a numbered file grows past ~300 lines or covers two distinct topics, split with a `b` suffix (e.g. `02b-skills-changelog.md`) in the same week directory and add a new row.

## Dated journal: `process/journal/week-N/MMDD-THHMM-<short-topic>.md`

- **Week directory `week-N`** — `N` is computed from the `course-start` date in [Documentation/AgentForge/README.md](../../../Documentation/AgentForge/README.md) frontmatter:
  - Formula: `N = max(1, floor((today - course-start) / 7) + 1)`.
  - **`today`** is the calendar date in **US Central** (`TZ=America/Chicago date +"%Y-%m-%d"`), same as journal filenames — independent of the machine’s local timezone.
  - Worked example: `course-start: 2026-04-27`, today is `2026-05-08` → `floor(11 / 7) + 1 = 2` → `week-2`.
  - **Lazy creation** — create the `week-N/` directory only when writing the first entry for that week. Never proactively scaffold future weeks.
  - If the README has no `course-start` frontmatter, ask the user once and write it before continuing.
- **`MMDD`** — 2-digit month + 2-digit day, no separator (`0427` for April 27). Year is implicit from `week-N/`.
- **`T`** — literal separator between the date and time portions (ISO-style time marker).
- **`HHMM`** — 24-hour time in **US Central** (`America/Chicago`), 2-digit hour + 2-digit minute, no separator (`2030` for 8:30pm Central). Multiple sessions in one day sort by time.
  - **How to obtain:** Run `TZ=America/Chicago date +"%m%d-T%H%M"` in the workspace shell and use that output verbatim for the `MMDD-THHMM` portion of the filename. Models must not infer time from context alone — see the main skill **Journal filename timestamp**.
- **`<short-topic>`** — kebab-case, 2–4 words. Examples: `agentforge-process-skill`, `presearch-checklist-fill`, `tooling-fix`.
- **Full example:** `process/journal/week-1/0427-T2030-flatten-journal-restructure.md`.
- **Not in the README table.** Journals are the long-form record; the numbered files are the index. Cross-link from numbered → journal when a decision is durable enough to surface.

## When to write a journal vs a numbered file

| Situation | Write |
|---|---|
| End of a chat session, want a durable record | journal |
| Tooling/dependency churn (no new milestone) | journal **+** changelog bullet in `02-tooling-and-skills.md` |
| Reached a meaningful new step in the trail | numbered file **+** journal entry that links to it |
| Decision worth surfacing without a whole new step | journal **+** add a "Decisions" bullet to the relevant existing numbered file |

## Things that should never happen

- A numbered file with no README row.
- A README row with no file.
- A numbered file that duplicates the entire journal verbatim. (Lift summaries, link the journal.)
- Writing under `docs/agentforge/` instead of `Documentation/AgentForge/`.
- Writing a numbered file at the legacy flat path `process/NN-<slug>.md` instead of `process/milestones/week-N/NN-<slug>.md`.
- Continuing Week 1's numbering into Week 2 (each week's sub-table restarts at `01`).
- Writing a journal entry without consulting `course-start` in the AgentForge README to compute the week.
- Proactively creating `milestones/week-N/` or `journal/week-N/` for a future week before the first entry for that week is being written.
- Using a date-only filename (`YYYY-MM-DD-topic.md`) — the convention is `MMDD-THHMM-topic.md` so multiple sessions per day stay distinguishable.
