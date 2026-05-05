---
date: 2026-04-30
topic: Gate 2 — session handoff (historical; G2-12 closed 2026-04-30)
superseded_by: 0430-T0830-gate2-closed-g212-manual-smoke.md
related_docs:
  - TASKS.md
  - PRD.md (Gate 2 spine)
---

# Gate 2 session handoff — what landed, what’s left

**Update:** **G2-12 closed** and Gate 2 marked **CLOSED** in `TASKS.md` with live smoke evidence in [`0430-T0830-gate2-closed-g212-manual-smoke.md`](./0430-T0830-gate2-closed-g212-manual-smoke.md). **Follow-up:** active chart ↔ rail sync is **G3-12** (Gate 3) in the task list (historical notes below may say “G2-14”).

## Goal of this session

Unblock the Clinical Copilot **end-to-end read slice**: rail + `panel.php` + CUI handshake + Agent API chat + OpenEMR context endpoints + Anthropic LLM, with dev ergonomics and prod-shaped API exposure. Close gaps blocking **G2-12** manual smoke; host UX for patient switches without reload is now **G3-12** (Gate 3).

## Summary — what we shipped or fixed

### Host / rail (OpenEMR module)

- **Lazy-load rail iframe** (`templates/rail_container.html.twig`): iframe starts `about:blank` and loads `panel.php` on **first** rail open so session `pid` / patient UUID are present (avoids “open chart” empty state when outer frame rendered before chart selection).
- **Context Service bootstrap for S2S** (`public/context/identity.php`, `public/context/allergies.php`): call `agentforge_require_globals(ignoreAuthForRequest: true)` so Agent API POSTs with `X-Internal-Auth` are not rejected with HTML `Site ID is missing from session data!` (parity with `handshake_redeem.php`).

### Agent API (`agentforge/api`)

- **Local dev env loading**: `package.json` `dev` script uses `dotenv-cli` to load `docker/agentforge/secrets.dev.env` so `npm run dev` matches Docker-injected env.
- **Anthropic model id**: replaced retired `claude-3-5-haiku-20241022` (API `404 not_found_error`) with **`claude-haiku-4-5`** (`src/agent/model.ts`).
- **Model output parsing**: `parseBlocksFromModelText` strips optional **Markdown code fences** around JSON so `claim` + `citation_ids` render correctly (`src/agent/orchestrator.ts`); regression test added.
- **Tests / typecheck**: orchestrator observability test helper fixed for `exactOptionalPropertyTypes`; tool test cast tightened. Focused Vitest + `tsc` green on touched areas.

### Infra / docs (from earlier in the same initiative)

- **Dev vs prod secrets**: `secrets.dev.env` / `secrets.prod.env`, `AGENTFORGE_SECRETS_FILE` in compose override.
- **Prod API**: Caddy TLS reverse proxy; API not published on host `3000` in prod overlay.
- **`OPENEMR_MODULE_BASE_URL`**: internal `http://openemr/...` for container API; dev uses `http://localhost:8300/...`; `openemr` on `agentforge_internal` network.

### Task list (`TASKS.md`)

- **G2-12** row points to an **operator checklist** (stack, host API, one patient, rail order, allergy + citation, S1 cross-patient note, journal path).
- **Active chart sync** (now **G3-12**): reload `panel.php` / re-handshake when `pid` changes; was deferred post–G2-12; documents current `panelLoaded` single-load behavior.
- Gate 2 **Status**: G2-12 journal pending at time of handoff → since closed (`0430-T1830-…`).

## Evidence the user already saw (informal)

- OpenEMR + rail: allergy question returned a **Claim** with a trailing **citation UUID** (provenance id from `source_pack.uuid`, not a deep link yet).
- **Visit / encounter** questions: model correctly stated **no tool** for encounters — expected for Gate 2 (more endpoints in Gate 3).
- **Patient switch without reload**: copilot can stay on **first-loaded** patient until **G3-12**; workaround: **full page reload** after opening another chart before relying on rail context.

## Key decisions (prompt → outcome)

| Topic | Decision |
| ----- | -------- |
| Rail empty / no input | Lazy-load iframe on first open so `panel.php` sees chart session. |
| `npm run dev` missing env | Load `secrets.dev.env` via `dotenv-cli` in `dev` script. |
| Chat 500 / “message could not be sent” | Root causes: bad Anthropic model id; context endpoints returning HTML without `ignoreAuth`; then fenced JSON parsing. |
| Citation string in UI | UUID is **citation / source_pack id**; navigation links are future (e.g. Gate 3 CUI tasks). |
| Stale patient after chart switch | **G3-12** in Gate 3; until then use full reload for clean A/B. |
| Gate 2 vs demo polish | Gate 2 closes on **G2-12**; optional **G3-12** for multi-patient demo without reload. |

## What’s explicitly **not** done (next chat)

### G2-12 — close the gate

1. Run operator checklist in `TASKS.md` (**G2-12 operator checklist**).
2. Capture **journal** under this folder: cited allergy answer; **S1** cross-patient attempt (document refusal / mismatch / no leak; use **full reload** between patients for a strict A→B check if needed).
3. In `TASKS.md`: mark **G2-12** `[x]`, set Gate 2 **Status** to **CLOSED** with date.

### G3-12 — active chart sync (Gate 3)

- On OpenEMR active patient change: reset iframe/`panelLoaded` or set `frame.src` to `panel.php` again (or `postMessage` + re-handshake), so CUI `data-patient-uuid` and token binding match the main chart **without** full page reload. (`TASKS.md` — **G3-12**.)

## Files touched in this workstream (reference)

**PHP / Twig**

- `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig`
- `interface/modules/custom_modules/oe-module-agentforge/public/context/identity.php`
- `interface/modules/custom_modules/oe-module-agentforge/public/context/allergies.php`

**Agent API**

- `agentforge/api/package.json` (dev script, `dotenv-cli`)
- `agentforge/api/src/agent/model.ts`
- `agentforge/api/src/agent/orchestrator.ts`
- `agentforge/api/test/agent/orchestrator.test.ts`
- `agentforge/api/test/tools/get-identity-and-allergies.test.ts`

**Docs**

- `TASKS.md`
- This journal file

## Quick commands (next session)

```bash
# Terminal 1 — stack
cd docker/development-easy
docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml up -d

# Terminal 2 — API on host
cd agentforge/api
npm install
npm run dev

# Sanity
curl -fsS http://localhost:3000/health
```

OpenEMR: open **one** patient chart → open rail → allergy question → then run S1 / journal steps per checklist.

---

*Historical handoff. Gate 2 closed with G2-12; execute **G3-12** under Gate 3 when starting UC-A completeness / multi-patient rehearsal.*
