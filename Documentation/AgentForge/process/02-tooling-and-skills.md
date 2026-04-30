# Tooling and agent workflow (Cursor)

This fork uses two layers of **agent skills**: **gstack** (global, engineering workflow) and **Matt Pocock** skills (project-local, planning and language). This doc records what was set up so the process trail stays reproducible on GitLab.

## gstack (global)

- **Role:** Development-side harness (planning, review, QA, ship)—not part of OpenEMR runtime.
- **Install:** Clone [garrytan/gstack](https://github.com/garrytan/gstack), run `./setup --host claude` from that repo so **browse** and dependencies build. For **Cursor**, generated skills target `~/.cursor/skills/` (see gstack docs / `bun run gen:skill-docs --host cursor`); runtime symlinks under `~/.cursor/skills/gstack` must include `bin`, `browse/dist`, etc., per gstack’s Cursor layout.
- **Bun:** gstack expects **Bun** on `PATH` (e.g. `export BUN_INSTALL="$HOME/.bun"` and `PATH="$BUN_INSTALL/bin:$PATH"` in `~/.zprofile` or `~/.zshrc`).
- **Slash menu duplicates:** `~/.claude/skills/` may show both a **flat** `office-hours` entry and a path under **`gstack/office-hours`**—same skill, two discovery paths for Claude Code + gstack’s bundle. Safe to ignore one in the UI or prefer the entry under `~/.cursor/skills` when working in Cursor.
- **Do not** vendor the full gstack **source repo** inside this fork; keep gstack outside OpenEMR and document the install here.

## Matt Pocock skills (this repo)

Installed from the **OpenEMR fork root** with non-interactive flags:

```bash
npx skills@latest add mattpocock/skills/grill-me -y
npx skills@latest add mattpocock/skills/ubiquitous-language -y
npx skills@latest add mattpocock/skills/improve-codebase-architecture -y
```

- **Project location:** Universal install goes to **`.agents/skills/<skill-name>/`** (Cursor picks this up). The `npx skills` CLI may also create symlinks for **Claude Code** and **Kiro** under their own skill dirs—expected.
- **Without `-y`:** the installer prompts for target agents; use **`-y`** in scripts or CI.
- **GitLab:** Skills that **file GitHub issues** (e.g. `to-prd`, `to-issues`) assume GitHub APIs. For this course, prefer outputs as **markdown in `Documentation/AgentForge/`** or GitLab issues manually unless you adapt those skills.

## Suggested workflow order

1. **[01-agentforge-impressions.md](01-agentforge-impressions.md)** — context on the case study.  
2. **gstack `/office-hours`** (or equivalent) — sharpen problem and users.  
3. **[03-presearch-checklist.md](03-presearch-checklist.md)** — constraints and architecture discovery.  
4. **`grill-me`** (Pocock) — stress-test the plan before locking architecture.  
5. **gstack `/plan-eng-review`** (or similar) — architecture, edge cases, tests.

## Changelog

- **2026-04-27** — Initial tooling doc: gstack global + Cursor; Pocock `grill-me`, `ubiquitous-language`, `improve-codebase-architecture` in `.agents/skills/`.
- **2026-04-27** — Added local skill `.agents/skills/agentforge-process-doc/` (SKILL.md + `SESSION-JOURNAL-TEMPLATE.md` + `MILESTONE-NAMING.md`). Triggers: "process documentation", "add process file to documentation", "compact and document". Picked up by Cursor automatically; for Claude Code / Kiro mirror the folder to `.claude/skills/` / `.kiro/skills/` if you want them to see it. Not tracked in `skills-lock.json` (local skill, not vendored from a remote source). Also fixed stale `docs/agentforge/` paths in the root README and `01-agentforge-impressions.md` frontmatter to point at `Documentation/AgentForge/`.
- **2026-04-27** — Restructured journal: `process/journal/` now uses `week-N/MMDD-THHMM-topic.md` so multiple chats per day stay distinguishable and chronologically ordered across the 3-week course. Week `N` computed from `course-start` in the AgentForge README frontmatter (added today, set to `2026-04-27`). Existing entry moved to `process/journal/week-1/0427-T1956-agentforge-process-skill.md`. Skill files (SKILL.md, MILESTONE-NAMING.md, SESSION-JOURNAL-TEMPLATE.md) updated to match.
- **2026-04-30** — OpenEMR fork host setup for Gate 0 verification: `composer install` requires PHP **`ext-redis`** (Homebrew PHP → `pecl install redis` / `pecl install -n redis`; avoid typing `[no]` at PECL prompts — use `no` or Enter). Isolated PHPUnit: use **`php vendor/bin/phpunit -c phpunit-isolated.xml …`** from repo root (composer script `phpunit-isolated` calls bare `phpunit`, often not on PATH). `agentforge/api` `npm run dev` needs **`export`** of all vars in `docker/agentforge/secrets.env.example` (no auto `.env` load in Gate 0).
