---
name: agentforge-process-doc
description: Capture AgentForge process documentation at the end of a chat or when adding a new numbered process file. Use when the user says "process documentation", "add process file to documentation", "compact and document", "document this session", or asks to update the AgentForge process trail. Summarizes user goals, trade-offs, tools/dependencies, files touched, and a Key Decisions log (user prompt + agent recommendation summary at each pivot). Adds the next `process/NN-<slug>.md` and keeps the README trail table coherent under `Documentation/AgentForge/`.
---

# AgentForge process documentation

This skill keeps the **AgentForge process trail** in [Documentation/AgentForge/](../../../Documentation/AgentForge/) honest and easy to extend. It runs in two situations (often together):

- **Compact and document** — end of a chat session: distill what happened into a dated journal entry.
- **Add process file** — promote work into the numbered trail (`process/NN-<slug>.md`) and update the README index.

> Canonical root for everything in this skill: `Documentation/AgentForge/`. Never write to `docs/agentforge/`. If you find that path in any file, fix it (see "Repo hygiene").

## 1. Classify intent

Pick one (the user may ask for both):

- **Session wrap only** — phrases like "compact and document", "document this session", "summarize what we did".
- **New milestone only** — phrases like "add process file", "add the next step", "promote this to the trail".
- **Both** — e.g. "document this session and add step 4".

If unclear, ask one question. Otherwise proceed.

### Journal filename timestamp (mandatory — no hallucinated times)

The model does **not** have a trustworthy wall clock. Guessing “about now” produces wrong filenames (wrong hour, wrong day boundary, or nonsense future times).

**Rules:**

1. **Timezone (fixed):** All journal clock fields use **US Central Time** via the IANA zone **`America/Chicago`** (CST/CDT handled automatically). Always pass `TZ=America/Chicago` on the commands below — do **not** rely on the shell’s default timezone.

2. **Primary source:** Immediately before naming the journal file, run this in the user’s workspace shell:

   ```bash
   TZ=America/Chicago date +"%m%d-T%H%M"
   ```

   Use the **entire output** as the `MMDD-THHMM` prefix of the filename. Do not tweak the digits.

3. **Frontmatter `date:`** — Run `TZ=America/Chicago date +"%Y-%m-%d"` and use that value so the YAML `date` matches the same **Central** calendar day as the filename’s `MMDD`.

4. **Forbidden:** Do not derive `HHMM` from chat “feeling”, training data, unrelated examples, conversation order, or the `Today's date` line in user info when it has **no time** (that field is date-only unless the user pasted a timestamp). Do not reuse times from older journal entries as a pattern.

5. **If the shell cannot run:** Ask the user once for **US Central** wall time in 24-hour form (`HHMM`) and the calendar day if needed (`MMDD`), then use exactly what they give. Do not substitute a guessed time.

## 2. Session wrap (compact and document)

1. **Compute the course week.** Read `course-start` (ISO `YYYY-MM-DD`) from the YAML frontmatter at the top of [Documentation/AgentForge/README.md](../../../Documentation/AgentForge/README.md). Take **`today`** as the calendar date from `TZ=America/Chicago date +"%Y-%m-%d"` (same zone as journal filenames). Compute `N = max(1, floor((today - course-start) / 7) + 1)`. If the frontmatter is missing, ask the user once for the course start date and write it into the README before continuing.
2. **Ensure the week directory exists.** `Documentation/AgentForge/process/journal/week-N/` — create silently if missing. Do not create future weeks proactively.
3. **Create the journal file** as `process/journal/week-N/MMDD-THHMM-<short-topic>.md` using `SESSION-JOURNAL-TEMPLATE.md` in this skill folder. **`MMDD` and `HHMM` must come from an authoritative clock — never invent, estimate, or round times.** Follow **Journal filename timestamp** (§1 above) before picking the filename. `T` is a literal separator between date and time. Slug is 2–4 words, kebab-case. Example shape: `0427-T2030-flatten-journal-restructure.md` (the digits must match what you measured, not this example).
4. Fill every section. **Highlights only — never paste full transcripts.** Aim for one screen of content; expand only when there is real signal.
5. Always include a **Key decisions** subsection (see next section). This is the part future readers will care about most.
6. If the session changed any file, list them under **Files touched** with full repo-relative paths.

## 3. Key decisions log (the important part)

At every **pivot point** in the session, write one entry with three fields:

- **Prompt** — the user's prompt that triggered the decision, verbatim or lightly trimmed (1–3 lines).
- **Recommendation** — 1–3 sentence summary of the agent's answer or the option chosen. Capture the *why*, not the full reasoning chain.
- **Outcome** — what actually got decided. Link to the file/line if it materialized in code or docs.

**What counts as a pivot** (include):

- Scope changes (expansion, reduction, deferral).
- Architecture, library, framework, or tooling choices.
- Trade-off rulings (e.g. canonical path, naming convention, install location).
- Explicit user overrides of an agent recommendation.
- Anything a future reader of the numbered process file would be surprised to learn was decided this session.

**What to skip** (do not include):

- Routine reads, greps, or file lookups.
- Formatting tweaks and typo fixes.
- Clarifying back-and-forth that did not change the plan.
- Internal agent self-correction.

Target **2–6 entries per session**. If you have more than 8, you are probably logging non-pivots — re-read the "skip" list.

Format example (also in `SESSION-JOURNAL-TEMPLATE.md`):

```markdown
### Decision: canonical AgentForge docs path

- **Prompt:** "option A (Documentation/AgentForge) since I made that change to the file structure and if it conflicts with the current readme text, then update the readme as necessary to make it coherent"
- **Recommendation:** Treat `Documentation/AgentForge/` as the single source of truth and patch any stale `docs/agentforge/` references (root README, process frontmatter) to match.
- **Outcome:** Root [README.md](../../../../README.md) and [process/02-tooling-and-skills.md](../../02-tooling-and-skills.md) updated.
```

> Relative links inside a journal entry are written from `Documentation/AgentForge/process/journal/week-N/`. From there: repo root is `../../../../`, the AgentForge folder is `../../../`, the `process/` folder is `../../`, and the parent `journal/` folder is `../`.

## 4. New milestone (add process file)

1. Read the **Process trail** table in [Documentation/AgentForge/README.md](../../../Documentation/AgentForge/README.md). The next index is `max(#) + 1`.
2. Create `Documentation/AgentForge/process/NN-<slug>.md`. Slug rules in `MILESTONE-NAMING.md`.
3. Keep the first version small: title, one-paragraph purpose, the decisions/sections that exist *now*. Do not pad.
4. Insert a new row in the README table (one line: `| NN | [process/NN-slug.md](process/NN-slug.md) | <one-line purpose> |`). The README table is the **single index** of the trail — never let a numbered file exist without a row, and never let a row point at a missing file.

## 5. Cross-linking journal ↔ numbered trail

If a Key Decisions entry from the journal is durable enough to belong in the numbered trail:

- Lift the entry (or a one-line summary of it) into the relevant numbered file under a **Decisions** heading.
- Link back to the journal entry so the full context is one click away.
- Do **not** copy the whole journal into the numbered file — the journal is the long-form record, the numbered file is the index-worthy summary.

This implements README "How to extend this folder" item 3 without duplicating content.

## 6. Tooling churn → 02 changelog

If the session installed/removed/upgraded a skill, gstack tool, or other dev-side dependency, append a dated bullet to the **Changelog** at the bottom of [process/02-tooling-and-skills.md](../../../Documentation/AgentForge/process/02-tooling-and-skills.md). Use **`TZ=America/Chicago date +"%Y-%m-%d"`** for the bullet’s calendar date so it matches journal convention.

```markdown
- **YYYY-MM-DD** — <one-line summary of what changed>.
```

This keeps tooling history reproducible without forcing a new milestone every time.

## 7. Repo hygiene (always check)

While writing, if you encounter any of these, fix in the same change:

- Stale `docs/agentforge/` paths anywhere in the repo (canonical is `Documentation/AgentForge/`).
- README trail table out of sync with files in `process/`.
- A numbered file with no purpose line in the README table.

## Outputs and limits

- Total writes per invocation: typically 1–3 files (journal + optional numbered file + optional README/02 update).
- Never commit on the user's behalf unless they ask.
- Never invent decisions that did not happen. If a section has no content, write `_None this session._` rather than padding.

## Reference files

- `SESSION-JOURNAL-TEMPLATE.md` — copy-paste template for `process/journal/week-N/MMDD-THHMM-*.md` (filename prefix from `TZ=America/Chicago date +"%m%d-T%H%M"`, not invented).
- `MILESTONE-NAMING.md` — slug rules, week computation, journal naming, and the "journal vs numbered" decision.
