---
date: 2026-05-01
topic: Prod VPS deploy of Gates 3–5 + STT (commit `d2b8f3621`); manual smoke surfaced 3 agent-side bugs
related_milestone: process/milestones/week-1/14-gate4-complete.md
---

# Prod VPS deploy of Gates 3–5 + AssemblyAI STT — session journal

## Goal

Land the local-green Gates 3 → 4 → 5 work (auto case presentation, write actions, dictation via AssemblyAI) on the existing Vultr VPS at `108-61-145-220.nip.io` as one squashed commit + push + pull, then run a manual smoke. User opened with: *"Everything in my dev environment looks great. We need to go ahead and deploy to my VPS… Help me make this as easy as possible."* The "as easy as possible" framing set the tone for the whole session.

## Context

Earlier in the day Gates 3, 4, and the Gate 5 STT polish all closed in dev (see same-day journals from `0430-T1334` through `0430-T2314`). VPS was last deployed at [`0430-T0213-prod-deploy-vps-smoke.md`](./0430-T0213-prod-deploy-vps-smoke.md) on commit `400db2336` (Gate 2 only). Local working tree had ~150 uncommitted files since then; `gitlab/master` was 0 ahead. AgentForge stack on the VPS had been "Up 22 hours" healthy on the old code.

## Key decisions

### Decision: commit the contracts-mount fix upstream (option A) instead of re-applying on the VPS

- **Prompt:** *(planning gate before commit)* "Commit the fix now, option A."
- **Recommendation:** This morning's deploy fixed `agentforge/api/src/openemr/types.ts` import (`../../../contracts/module-http-paths.json`) by adding `../../agentforge/contracts:/contracts` to the `agentforge-api` service in `docker/agentforge/docker-compose.prod.yml` *on the VPS only*. Without committing the fix, every `git reset --hard` on the VPS rediscovers the same TS2307 + container exit-loop. Cost is one volume line + a comment.
- **Outcome:** Edited [`docker/agentforge/docker-compose.prod.yml`](../../../../../docker/agentforge/docker-compose.prod.yml); `tsc -p tsconfig.build.json` clean, `vitest` 90/91 (1 skipped pg-integration test). Landed in the squash commit `d2b8f3621`.

### Decision: squash 150+ files into one commit instead of splitting per gate

- **Prompt:** "Squash into one commit."
- **Recommendation:** GitLab history value of per-gate commits is small here because the [process docs 12–14](../../milestones/week-1/14-gate4-complete.md) and the dated journals already give a richer audit trail than git commits would. Squash keeps focus on the deploy tonight; we can rewrite history later if it ever matters.
- **Outcome:** `d2b8f3621 feat(agentforge): close Gates 3-5 — auto case presentation, write actions, dictation via AssemblyAI` (157 files, +14,795 / −296). `Assisted-by: Cursor` trailer per CLAUDE.md.

### Decision: symlink-band-aid the Caddyfile path again (option B) instead of fixing it upstream

- **Prompt:** "Option B, Symlink, go."
- **Recommendation:** Same Compose path-resolution bug as this morning: `./Caddyfile` in `docker/agentforge/docker-compose.prod.yml` resolves against the **first** stacked compose file's directory (`docker/development-easy/`), not the prod overlay's directory. The contracts mount we just committed gets it right (`../../agentforge/contracts`); the Caddyfile mount uses the still-broken `./Caddyfile`. Right fix is `../agentforge/Caddyfile`. User chose the symlink to keep deploy momentum; net-effect is identical for tonight.
- **Outcome:** Caddyfile symlink → real-file copy after the symlink failed (see next decision). Upstream prod-compose fix logged in **Next steps** below; should be a one-line PR tomorrow so the next deploy doesn't rediscover this *for a third time*.

### Decision: replace the Caddyfile symlink with a real file copy after Docker auto-created a stray directory

- **Prompt:** *(implicit — Docker error: "not a directory: Are you trying to mount a directory onto a file (or vice-versa)?")*
- **Recommendation:** The first failed `up -d --build` taught us a new failure mode the morning's session didn't see: when bind-mount source doesn't exist, Docker creates an **empty directory** at the source path as a fallback. Then `ln -sf TARGET /opt/.../Caddyfile` saw a directory at the destination and put the symlink *inside* it (`Caddyfile/Caddyfile`). The dead giveaway was `ls -la <path>` showing `total 8` and `.`/`..` entries — i.e. directory listing format, not a single-file `ls`. `rm -rf` the stray dir, then `cp` the real Caddyfile in its place.
- **Outcome:** Caddy started clean; ACME cert reused from `caddy_data` volume; verified TLS curl to `/health` worked **without** `-k` (cleaner than this morning's deploy, which needed `-k`).

### Decision: run Postgres migrations from inside the `agentforge-api` container, not the host

- **Prompt:** *(planning gate before B6)*
- **Recommendation:** The README's recommended path is `POSTGRES_URL_MIGRATE='...' npm run db:migrate` from the host, but the VPS has no Node installed and we don't want to install one just for migrations. The container already has `pg`, the migration script, and the right `POSTGRES_URL` (resolves on the internal Compose network). One gotcha: `npm run db:migrate` wraps with `dotenv -e ../../docker/agentforge/secrets.dev.env`, which doesn't resolve inside the container — call `node scripts/pg-migrate.mjs` directly.
- **Outcome:** All 3 migrations applied cleanly (`001` no-op, `002` + `003` net-new). 7 tables verified. `/health` flipped from "would degrade chat" to `postgres: reachable`.

### Decision: defer all 3 user-flow bugs to a fresh session; capture in a bug log instead of fixing tonight

- **Prompt:** "I really don't plan on fixing them. I'll list them off here, and maybe we can make a note of them for when we pick this up tomorrow… these are some of the issues that we're having. It seems that there needs to be more agent hardening, so make a note of that as a separate note related to the problems with the deployment."
- **Recommendation:** The infra side of the deploy is 100% green; the bugs are all agent-loop / write-path issues that need fresh investigation, not a tired triage. A single dated bug log file with severity, repro, and "likely culprits to investigate" gives tomorrow's session a cold-start pickup point without polluting the task list.
- **Outcome:** [`Documentation/AgentForge/implementation/post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md) created with **P1** confirmed-write-fails / **P2** dictation false "no encounter" / **P3** brief intermittently blank, plus an **M1** meta-note on agent hardening for prod-parity (proposed as `G6-19` next time the task list is open).

## Trade-offs and alternatives

- **Per-gate commit split** — rejected. Real cost vs marginal-history-value didn't pencil out tonight; journals carry the per-gate story.
- **Land Caddyfile path fix upstream tonight (option A again)** — rejected by user for momentum. Tracked in Next steps.
- **Run migrations from a freshly-installed Node on the VPS host** — rejected. Adds a tool we don't otherwise need; container path is one line and uses the env we already validated.
- **Re-apply the morning's `chown -R linuxuser:lxd /opt/openemr`** — skipped; ownership was already `linuxuser:lxd` from the morning's session. `git config --global --add safe.directory /opt/openemr` for root unblocked inspection commands without taking ownership.

## Tools, dependencies, commands

- **Local prep:**
  - `cd agentforge/api && npm run build` → `tsc -p tsconfig.build.json` (clean).
  - `cd agentforge/api && npm test` → 90/91 pass (1 skipped pg integration).
  - `git add -A && git commit -m '<heredoc>'` (no pre-commit hooks installed locally).
  - `git push gitlab master`.
- **VPS bring-up loop (run as root unless noted):**
  - Backups: `mariadb-dump --all-databases` → `vps-openemr-pre-gate5-*.sql.gz` (10M); `pg_dumpall -U agentforge` → `vps-postgres-pre-gate5-*.sql.gz` (38K).
  - Git sync (as `linuxuser`): `sudo -iu linuxuser bash -lc 'cd /opt/openemr && git fetch origin && git reset --hard origin/master && git clean -fd'`.
  - Secrets: `sed -i 's|^STT_PROVIDER=.*|STT_PROVIDER=assemblyai|' /opt/openemr/docker/agentforge/secrets.prod.env` (and matching `STT_API_KEY`).
  - Caddyfile workaround (until the upstream path fix lands): `rm -rf /opt/openemr/docker/development-easy/Caddyfile && cp /opt/openemr/docker/agentforge/Caddyfile /opt/openemr/docker/development-easy/Caddyfile`.
  - Stack: `cd /opt/openemr/docker/development-easy && AGENTFORGE_SECRETS_FILE=../agentforge/secrets.prod.env docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml -f ../agentforge/docker-compose.prod.yml up -d --build`.
  - Migrations (from inside container, not host): `docker exec development-easy-agentforge-api-1 sh -c 'cd /app && node scripts/pg-migrate.mjs'`.
  - Smoke: `curl -fsS https://108-61-145-220.nip.io/health`.

## Files touched

- **Modified (committed in `d2b8f3621`):**
  - [`docker/agentforge/docker-compose.prod.yml`](../../../../../docker/agentforge/docker-compose.prod.yml) — added `../../agentforge/contracts:/contracts` bind mount on `agentforge-api` (closes the morning's hand-edit loop).
  - 156 other files representing the Gates 3–5 + STT work; full list in the commit body.
- **Created (this session):**
  - [`Documentation/AgentForge/process/journal/week-1/0501-T0014-prod-deploy-gates3-5-vps.md`](./0501-T0014-prod-deploy-gates3-5-vps.md) — this file.
  - [`Documentation/AgentForge/implementation/post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md) — P1/P2/P3 + M1 meta.
- **VPS-only (not in repo):**
  - `/opt/openemr/docker/agentforge/secrets.prod.env` — `STT_PROVIDER=assemblyai`, `STT_API_KEY=<rotated value lives here>`.
  - `/opt/openemr/docker/development-easy/Caddyfile` — real-file copy of `docker/agentforge/Caddyfile` (band-aid; upstream fix tomorrow).
  - `/root/agentforge-backups/vps-openemr-pre-gate5-20260501-042822.sql.gz` (10M).
  - `/root/agentforge-backups/vps-postgres-pre-gate5-20260501-042950.sql.gz` (38K).

## Outcomes

- AgentForge prod stack on `https://108-61-145-220.nip.io` is now on commit `d2b8f3621`. Public `/health` returns `{"ok":true,"providers":{"llm":"anthropic","stt":"assemblyai"},"deps":{"postgres":"reachable",…}}` — first time this VPS has served verified TLS without needing `-k` (CA bundle situation has resolved itself since this morning).
- Postgres schema is at the Gate 5 baseline: 7 tables (`heartbeat`, `conversations`, `pending_proposals`, `transcripts`, `transcript_segments`, `turns`, `schema_migrations`) — all 3 migrations applied; existing data preserved (verified via pre-deploy backups).
- Manual smoke ran and surfaced 3 agent-side bugs (P1 confirmed-write-denied, P2 false "no recent encounter", P3 brief sometimes blank). Cataloged in the bug log; deploy itself is **not** the cause — infra is clean.
- Deploy cadence held: one strict step at a time, paste-back-and-confirm on each. The "Caddyfile is actually a directory now" diagnosis was the only real surprise and was resolved in two turns.

## Next steps

- [ ] **Prod-compose Caddyfile path fix (one-line PR)** — change `./Caddyfile` to `../agentforge/Caddyfile` in [`docker/agentforge/docker-compose.prod.yml`](../../../../../docker/agentforge/docker-compose.prod.yml). Commit + push + pull to retire the symlink/copy band-aid permanently. *Should be the first work next session.*
- [ ] **Triage bug log** — work [`Documentation/AgentForge/implementation/post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md) in P1 → P2 → P3 order; capture findings as a new dated journal.
- [ ] **Open `G6-19 — agent hardening for prod parity`** in [`TASKS.md`](../../../../../TASKS.md) covering the M1 hardening targets (typed error frames on every failure path, server-side correlation IDs over WS, cache invalidation on Refresh chart, structured per-turn agent-decision log line).
- [ ] **Mark G5-08 status carefully:** dictation pipeline is live on prod and AssemblyAI is confirmed via `/health`, but **end-to-end smoke is not green** because P2 blocks the encounter-bound dictation flow. Do not mark `[x]` until P2 is resolved on prod.
- [ ] **Rotate the AssemblyAI key** if the value ever transited a chat transcript or screen-share outside the deploy session.

## Links

- Prior deploy: [`0430-T0213-prod-deploy-vps-smoke.md`](./0430-T0213-prod-deploy-vps-smoke.md) — Gate 2 close on the same VPS.
- Same-day Gate-close journals (the work that was being deployed):
  - Gate 3: [`0430-T1558-gate3-closed-session-summary.md`](./0430-T1558-gate3-closed-session-summary.md)
  - Gate 4: [`0430-T2230-gate4-g410-uc-b-smoke.md`](./0430-T2230-gate4-g410-uc-b-smoke.md)
  - Gate 5: [`0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md`](./0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md), [`0430-T2314-dictation-agent-parity.md`](./0430-T2314-dictation-agent-parity.md)
- Bug log this deploy spawned: [`implementation/post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md)
- Milestones: [`process/milestones/week-1/14-gate4-complete.md`](../../milestones/week-1/14-gate4-complete.md).
