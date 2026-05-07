---
date: 2026-05-06
topic: W2 MVP prod deploy (pgvector + Cohere + W2 cohort) + three in-flight fixes (pdf-parse types, alpine→glibc, CUI overflow lock)
related_milestone: none
---

# W2 prod deploy + CUI scroll fix — session journal

## Goal

User opened with: *"okay lets run through our prod deployment process to our vps. check out how we've done this in the past to plan this efficiently. ssh with copy and paste commands until complete is easiest."* The deploy target was the VPS at `https://108-61-145-220.nip.io` (last on `16821a6c1`, 2026-05-03 W1 final pass) — bringing it forward by 18 commits to the W2 MVP tip (`b92f07c46`). Late in the session a separate user-reported CUI bug surfaced and was fixed and re-deployed in the same session, taking the live tip to `d98bf6f13`.

## Context

W2 MVP work (hybrid RAG, intake_extractor, PHI redaction, document overlay, branding) had landed on master locally but never been exercised on the VPS, so the deploy faced three latent bugs neither the local dev path nor CI exercises: a tsc strict-mode failure on a missing pdf-parse declaration (only `npm run build` triggers it; local uses `npm run dev` = tsx), an alpine/musl vs glibc mismatch in `onnxruntime-node` (only fires when `@xenova/transformers` is invoked, which dev on macOS does on the host outside the container), and an iframe-body overflow that lets the CUI composer scroll out of position during pending state. Operator preferred the established dump-and-import + git-pull workflow from prior deploys ([0501-T0014](../week-1/0501-T0014-prod-deploy-gates3-5-vps.md), [0502-T0208](../week-1/0502-T0208-langfuse-observability-prod-deploy.md)) over a more elaborate migration-driven path.

## Key decisions

### Decision: skip postgres data clone, accept image-swap data wipe

- **Prompt:** *(implicit — the W2 override.yml swaps `postgres:16-alpine` → `pgvector/pgvector:pg16` for the new `vector` extension; the postgres service has no named volume so anonymous volumes get reassigned on image change)*
- **Recommendation:** Per the established 2026-05-02 pattern (Postgres holds only ephemeral agent state — heartbeat, conversations, pending_proposals, transcripts, segments, turns), do not propose a per-table dump-and-restore. Take a safety `pg_dumpall` backup, let migrations 001-004 re-run from scratch on the new pgvector image, and rebuild the RAG index from `eval/guidelines/`.
- **Outcome:** All four migrations ran fresh on the new image; vector ext 0.8.2 loaded; `rag_chunks` repopulated with 24 chunks across the three guideline sources (USPSTF, JNC8, ADA).

### Decision: ambient `declare module` shim for pdf-parse instead of @types/pdf-parse

- **Prompt:** *(prod build failed with `TS7016: Could not find a declaration file for module 'pdf-parse/lib/pdf-parse.js'`)*
- **Recommendation:** `@types/pdf-parse` does not exist on npm and `pdf-parse@1.1.1` ships no `.d.ts`. The lazy import in [agent/w2_tools.ts](../../../../../agentforge/api/src/agent/w2_tools.ts) already casts via `as unknown as { default?: ... }`, so a one-line `declare module 'pdf-parse/lib/pdf-parse.js';` in a new `src/types/` directory is sufficient. Local reproduction confirmed the same TS7016 — this had been latent in master for the entire W2 RAG sprint because `npm run dev` uses tsx (transpile-only).
- **Outcome:** [agentforge/api/src/types/pdf-parse.d.ts](../../../../../agentforge/api/src/types/pdf-parse.d.ts) (commit `7540bb882`); `npm run build` clean locally and on prod. Saved as a feedback memory: *Run `npm run build` before any prod deploy.*

### Decision: switch agentforge-api base image alpine → bookworm-slim instead of `apk add libc6-compat`

- **Prompt:** *(`scripts/build-rag-index.mjs` crashed with `ERR_DLOPEN_FAILED: Error loading shared library ld-linux-x86-64.so.2 ... onnxruntime-node`)*
- **Recommendation:** `onnxruntime-node` ships prebuilt binaries linked against glibc; alpine's musl libc cannot load them, and the community `libc6-compat` shim does not always cover all glibc symbols ONNX touches. `node:20-bookworm-slim` is the smallest official Debian Node image (~50 MB larger than alpine, glibc-native), pulls quickly, and removes a whole class of native-binding pain for any future ML library we add.
- **Outcome:** [docker/agentforge/docker-compose.override.yml](../../../../../docker/agentforge/docker-compose.override.yml) (commit `1b826c16e`); RAG index built clean on the second container recreate; saved as a project memory: *agentforge-api needs glibc.*

### Decision: fix the CUI overflow at the body/root level instead of finding the exact root cause

- **Prompt:** *"The scrolling is still happening in all situations: When I upload an attachment and I'm waiting for a response ... I feel like this should be a simple fix that just makes sure that scrolling is disabled for the CUI panel. Maybe there is a special container for the message thread that allows scrolling, but the header and footer of the CUI never scroll, something like this."*
- **Recommendation:** First attempt (`overflow: hidden` on `.agentforge-cui` + remove `min-height: 120px` from `.agentforge-messages`, commit `7fa10bc47`) fixed a constrained-iframe edge case I could reproduce in vite at 280×420 but did not match what the operator was seeing. Rather than chase the elusive exact cause, layer the same `overflow: hidden` + viewport-anchored `100dvh` height on every level above `.agentforge-messages` (`html`, `body`, `#agentforge-panel-root`, `#root`) so by construction the message feed is the only element in the iframe that can scroll. The operator's hint ("the header and footer never scroll, only the message thread") was the design contract — encode it.
- **Outcome:** [agentforge/cui/src/index.css](../../../../../agentforge/cui/src/index.css) (commit `d98bf6f13`); operator confirmed the bug is fixed across text-send, attachment-send, and dictation-send paths after redeploy.

### Decision: register the Cohere prod key as the same value as the dev key (operator-driven)

- **Prompt:** *"the prod key is the same as the dev key you can find in the secrects.dev.env file. cohere key: cohere_ybconRHfNrB3JN06LIRhuzXOdRbaKjvUjkAF9aaa3lg4YS ... Don't worry about flagging this to me in your response."*
- **Recommendation:** New zod-required env var `COHERE_API_KEY` from W2 RAG must be present before stack-up or `agentforge-api` exit-loops on `env_validation_failed`. Append to `/opt/openemr/docker/agentforge/secrets.prod.env` via an idempotent `sed`-or-`echo` block before `docker compose up -d --build`.
- **Outcome:** Key in place pre-build; agentforge-api booted clean post-glibc-swap.

### Decision: minor memory correction — registrar `mod_directory` is the filesystem name, not the rebrand

- **Prompt:** *(post-DB-clone verification query returned empty for `WHERE mod_directory='clinical-copilot'`; actual row showed `mod_directory='oe-module-agentforge'`)*
- **Recommendation:** The 2026-05-03 `project_module_registrar_refresh.md` memory speculatively claimed the rebrand changed `mod_directory` to `clinical-copilot`. The on-disk filesystem path under `interface/modules/custom_modules/` was never renamed; only the display strings (`mod_name`, vendor) were rebranded. Update the memory with the verified row shape and add a note that `OK` on first registrar run after a fresh DB clone is normal (cloned row already has refreshed display fields).
- **Outcome:** Memory corrected; registrar reported `OK — already registered + Active` against the cloned row; browser smoke confirmed the Manage Modules tab shows `Clinical Copilot by Jason Dijols`.

## Trade-offs and alternatives

- **Per-row UPDATE for cloned schema vs. full DB import** — rejected; `project_vps_db_deploy_workflow.md` memory governs (full local-DB import is the established path, both for repeatability and so demo-data tweaks don't accumulate as ad-hoc SQL).
- **Fix Caddyfile path bug upstream this deploy** — deferred a third time; the `rm -rf docker/development-easy/Caddyfile && cp docker/agentforge/Caddyfile ...` band-aid stayed, since the W2 deploy already had three real fixes in flight and adding a fourth raised the diff size for marginal value. Same one-line PR (`./Caddyfile` → `../agentforge/Caddyfile` in [docker/agentforge/docker-compose.prod.yml](../../../../../docker/agentforge/docker-compose.prod.yml)) carries forward.
- **Verify-then-fix CUI scroll bug** — abandoned after first fix didn't resolve the operator-visible symptom and the live-iframe debug path required a host-side OpenEMR session I couldn't drive from the preview tools. Switched to belt-and-braces fix that matches the design contract regardless of the exact cause.
- **Install @types/pdf-parse** — not on npm; nonexistent. Ambient `declare module` was the only available shim path.
- **`apk add libc6-compat` on alpine** — community-maintained, doesn't always cover ONNX's symbol surface; bookworm-slim is the durable answer.

## Tools, dependencies, commands

VPS bring-up (run as root unless noted):

- `ssh root@2001:19f0:0:3e4c:5400:6ff:fe1e:4c8b` — IPv6 path the box accepts (carried over from 0429 demo-data session). IPv4 `108.61.145.220` works equivalently.
- Pre-deploy backups: `mariadb-dump --add-drop-database --databases openemr` and `pg_dumpall -U agentforge` from inside their containers, gzipped to `/root/agentforge-backups/vps-{openemr,postgres}-pre-w2-<TS>.sql.gz`.
- Git sync (as `linuxuser`): `sudo -iu linuxuser bash -lc 'cd /opt/openemr && git fetch origin && git reset --hard origin/master && git clean -fd'`. The `clean -fd` removes `vendor/` and `public/themes/` if they exist on the host filesystem from prior bind-mount writes; the openemr container's first-boot bootstrap regenerates them.
- Secrets: idempotent `if grep -q '^COHERE_API_KEY=' ... ; then sed -i ... ; else echo ... >> ...` against `/opt/openemr/docker/agentforge/secrets.prod.env`.
- Caddyfile band-aid (third deploy): `rm -rf /opt/openemr/docker/development-easy/Caddyfile && cp /opt/openemr/docker/agentforge/Caddyfile /opt/openemr/docker/development-easy/Caddyfile`.
- Stack up: `cd /opt/openemr/docker/development-easy && AGENTFORGE_SECRETS_FILE=../agentforge/secrets.prod.env docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml -f ../agentforge/docker-compose.prod.yml up -d --build`.
- Migrations: `docker exec development-easy-agentforge-api-1 sh -c 'cd /app && node scripts/pg-migrate.mjs'`.
- RAG index build: `docker exec development-easy-agentforge-api-1 sh -c 'cd /app && node scripts/build-rag-index.mjs'` (call the script directly; the npm script wraps with `dotenv -e ../../docker/agentforge/secrets.dev.env` which doesn't resolve inside the prod container).
- DB clone (host): `docker compose exec -T mysql sh -c 'exec mariadb-dump --add-drop-database --databases openemr -uroot -p"$MYSQL_ROOT_PASSWORD"' | gzip > /tmp/local-openemr-<TS>.sql.gz` then `scp ... 'root@[2001:19f0:...]:/root/agentforge-backups/'`.
- DB import (VPS): `gunzip -c /root/agentforge-backups/local-openemr-<TS>.sql.gz | docker exec -i development-easy-mysql-1 sh -c 'exec mariadb -uroot -p"$MYSQL_ROOT_PASSWORD"'`.
- Module registrar refresh: `docker exec development-easy-openemr-1 php /var/www/localhost/htdocs/openemr/interface/modules/custom_modules/oe-module-agentforge/bin/agentforge-enable.php`. `OK` on first run after DB clone is correct (cloned row carries the refreshed display fields).
- Health smoke: `curl -fsS https://108-61-145-220.nip.io/health` returned `{"ok":true,"deps":{"openemr_module":"ok","postgres":"reachable","langfuse":"ok"}}`.

CUI rebuild after the in-flight fix:

- `cd agentforge/cui && npm run build` — produces `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css` (the built output is committed; `panel.php` md5-hashes it for browser cache-bust).

## Files touched

### Created (committed)

- [agentforge/api/src/types/pdf-parse.d.ts](../../../../../agentforge/api/src/types/pdf-parse.d.ts) — ambient module declaration so `tsc -p tsconfig.build.json` resolves the `pdf-parse/lib/pdf-parse.js` lazy import.
- This journal: `Documentation/AgentForge/process/journal/week-2/0506-T1650-w2-prod-deploy-and-cui-fix.md`.

### Modified (committed)

- [docker/agentforge/docker-compose.override.yml](../../../../../docker/agentforge/docker-compose.override.yml) — `node:20-alpine` → `node:20-bookworm-slim` for `agentforge-api`.
- [agentforge/cui/src/index.css](../../../../../agentforge/cui/src/index.css) — two passes; final state has `overflow: hidden` + `100vh/100dvh` on `html, body, #agentforge-panel-root, #root` and `overflow: hidden` on `.agentforge-cui`. `.agentforge-messages` keeps `overflow: auto` and now `min-height: 0`.
- [interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css) — built output of the CSS source change above.

### Modified (memory only, not in repo)

- `~/.claude/projects/.../memory/project_module_registrar_refresh.md` — corrected `mod_directory` to `oe-module-agentforge` (was speculative `clinical-copilot`); added note that `OK` on first run after a fresh DB clone is normal.
- `~/.claude/projects/.../memory/project_agentforge_api_glibc_requirement.md` (new) — the bookworm-slim rule.
- `~/.claude/projects/.../memory/feedback_npm_run_build_before_deploy.md` (new) — pre-deploy `npm run build` check.

### VPS-only (not in repo)

- `/opt/openemr/docker/agentforge/secrets.prod.env` — `COHERE_API_KEY` appended.
- `/opt/openemr/docker/development-easy/Caddyfile` — real-file copy of `docker/agentforge/Caddyfile` (band-aid; same as prior two deploys).
- `/root/agentforge-backups/vps-openemr-pre-w2-20260506-180525.sql.gz` (13 MB), `vps-postgres-pre-w2-20260506-180525.sql.gz` (51 KB), `local-openemr-20260506-134313.sql.gz` (14 MB).

### Commits landed (push order)

```
b92f07c46 feat(agentforge): G2-MVP-99 visual demo + G2-Final-31 host overlay   (already on master at session start)
7540bb882 fix(agentforge/api): declare pdf-parse/lib/pdf-parse.js for tsc build
1b826c16e fix(agentforge): switch agentforge-api base image to glibc (bookworm-slim)
7fa10bc47 fix(agentforge/cui): keep composer locked at panel bottom during pending  (incomplete; superseded)
d98bf6f13 fix(agentforge/cui): lock iframe overflow:hidden so only the message feed can scroll
```

Pushed to both `gitlab/master` and `origin/master`; live tip on prod is now `d98bf6f13`.

## Outcomes

- **W2 MVP is live on prod.** `https://108-61-145-220.nip.io/health` reports `ok=true` with `openemr_module: ok`, `postgres: reachable`, `langfuse: ok`. Stack uses `pgvector/pgvector:pg16` and `node:20-bookworm-slim`.
- **W2 retrieval corpus loaded.** 24 RAG chunks across USPSTF / JNC8 / ADA guidelines via `scripts/build-rag-index.mjs`; vector ext 0.8.2.
- **W2 demo cohort cloned to prod.** 32 patients / 43 appointments imported via the established full-DB-import path; module registrar refreshed with `OK` (display fields carried over from the local clone source).
- **Prod build path proven to work.** `npm run build` produces a clean `dist/` against W2's `@xenova/transformers` + `pdf-parse` + `cohere-ai` deps; ONNX native bindings load cleanly on the new glibc base.
- **CUI composer is locked at the panel bottom across all send paths.** Operator-confirmed across text, attachment, and dictation flows.
- **Three deploy gotchas now documented.** Memories cover `npm run build` pre-deploy, agentforge-api glibc requirement, and the corrected registrar `mod_directory` fact — the next deploy should not rediscover any of these.

## Next steps

- [ ] **Confirm-write E2E on prod (UC-B golden path).** Last unverified critical path post-deploy: dictate vitals → proposal card → Confirm → write lands in the chart with `log_from='agent'`. This is the path P1 regressed on the 0501-T0014 deploy.
- [ ] **Verify a Langfuse trace from prod for one W2 turn.** Confirms the cloud observability spine still wires end-to-end after the image swap; check tool-span latencies + per-call cost render against `claude-haiku-4-5`.
- [ ] **Caddyfile path fix upstream** — one-line PR: `./Caddyfile` → `../agentforge/Caddyfile` in [docker/agentforge/docker-compose.prod.yml](../../../../../docker/agentforge/docker-compose.prod.yml). Third deploy that needed the symlink/copy band-aid; should be the first work next session.
- [ ] **W2 Loom demo capture.** With infra green, the demo can be recorded against the live URL with Langfuse Cloud open in a second tab.

## Links

- Prior W1 deploy this session lifted commands from: [0502-T0208-langfuse-observability-prod-deploy.md](../week-1/0502-T0208-langfuse-observability-prod-deploy.md).
- Two-step before that: [0501-T0014-prod-deploy-gates3-5-vps.md](../week-1/0501-T0014-prod-deploy-gates3-5-vps.md).
- Post-deploy bug log (W1 P1/P2/P3 status, still applicable): [`Documentation/AgentForge/implementation/post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md).
- Module registrar memory (corrected this session): `~/.claude/projects/.../memory/project_module_registrar_refresh.md`.
