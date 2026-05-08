# 05 — HTTPS retrofit + W2 final VPS deploy

## Purpose

Bring the live VPS forward from the 5/6 W2 MVP tip (`d98bf6f13`) to the W2 final-pass tip (`a3b954ab6`) and add a second Caddy site so the deployed OpenEMR is reachable over HTTPS at `https://oe.108-61-145-220.nip.io` — the URL that goes into the Gauntlet submission form. Same session also refreshed the demo DB to match local (cohort window shift to 5/9–5/12, W2 pubpid renumber to 0029–0032, sidecar marker table replacing the demographics-widget leak), and shipped a one-line fix for a latent TypeScript bug that only surfaced when `tsc -p tsconfig.build.json` ran inside the prod container. End state: VPS, gitlab/master, and origin/master all at `a3b954ab6`; working tree clean; no other branches, worktrees, or stashes.

## Decisions

Lifted from [process/journal/week-2/0508-T0111-https-retrofit-vps-deploy.md](../../journal/week-2/0508-T0111-https-retrofit-vps-deploy.md). Full context and prompts in the journal.

### Sequence the deploy with rollback safety first

Standard hygiene from the 5/6 deploy journal — `mariadb-dump` of openemr + `pg_dumpall` of postgres into `/root/agentforge-backups/vps-*-pre-https-${TS}.sql.gz` *before* any state change. 14 MB + 107 KB; cost negligible vs an unrecoverable demo loss if a downstream step fails. Not needed for rollback this session, but the discipline is worth keeping.

### Symlink workaround for Caddyfile compose-path resolution mismatch

[docker/agentforge/docker-compose.prod.yml:29](../../../../../docker/agentforge/docker-compose.prod.yml) declares `./Caddyfile:/etc/caddy/Caddyfile:ro`, and Compose v2 resolves `./` against the **project directory** (the first `-f` file's location → `docker/development-easy/`), not against the override file's own directory. The 5/6 deploy had an untracked symlink at `docker/development-easy/Caddyfile` → `../agentforge/Caddyfile`; tonight's `git clean -fd` after the fetch removed it, and Docker auto-created an empty *directory* at the bind-mount source on the next `up`, producing `mount … not a directory` on the caddy container. Patch: `rmdir` the stub and recreate the symlink. The deeper fix (commit the symlink, change the prod.yml volume to absolute, or co-locate compose files) deferred to post-deploy cleanup; this is a real bug in the compose configuration that any future operator will hit.

### Fix the latent TS2379 in the prod build path, not patch around it

[`agentforge/api/src/tools/attach_and_extract.ts:248`](../../../../../agentforge/api/src/tools/attach_and_extract.ts) declared the `visit()` callback's parameter as `{ confidence?: number } | undefined`, but every call site passes a citation whose `confidence` field is Zod-emitted as `number | undefined` from `z.number().min(0).max(1).optional()` in [`schemas/extraction.ts:31`](../../../../../agentforge/api/src/schemas/extraction.ts). Under `exactOptionalPropertyTypes: true` (active in `tsconfig.build.json`), `confidence?: number` and `confidence?: number | undefined` are not assignable — six TS2379 errors at lines 262–269. The container's startup command is `sh -c 'cd /app && npm ci && npm run build && PORT=3000 node dist/index.js'`, so when `npm run build` exits non-zero, `node` never starts and the API is down with no restart-loop. Latent locally because `npm run dev` uses `tsx` (transpile-only, no type-check) — exactly the failure mode the standing memory note about `npm run build` before deploy was written for. Fix is the minimum-diff widen of the parameter signature; function body already handles undefined at line 251. Shipped as `a3b954ab6`, verified via `npx tsc -p tsconfig.build.json --noEmit` locally before push.

### Skip pg-migrate, run the standard local→VPS dump-and-import for demo DB

`/health` on the API hostname returned `postgres: reachable` (not `degraded_chat_requires_migrations_or_url`), confirming no new migrations between this batch and the prior live tip. Demo DB refresh follows the standing pattern: dump from laptop's `mysql` container with `--add-drop-database --databases openemr`, gzip, scp to VPS backups dir, gunzip-pipe through `docker exec -i mariadb`. `--add-drop-database` makes the import atomic. Three verification queries returned exactly the values the local demo seeders produced: `marker_kind` cohort=14 / scheduled=15, W2 patients at pubpids 0029–0032 (Chen / Whitaker / Reyes / Kowalski), `total_demo_patients=32`.

## Outcomes

- `https://oe.108-61-145-220.nip.io` is the live submission URL: TLS 1.3 via Let's Encrypt, reverse-proxying to the OpenEMR Apache container on the internal Docker network. The Gauntlet form's HTTPS-only constraint is now satisfied.
- The existing `https://108-61-145-220.nip.io` API hostname is unchanged; `CUI_ALLOWED_ORIGINS` extended to include both legacy `http://108-61-145-220.nip.io:8300` and the new HTTPS origin so the rail handshake works regardless of how OpenEMR is reached.
- Demo DB on VPS now matches local: cohort window 5/9–5/12, W2 cohort patients at 0029–0032, `agentforge_demo_patient_markers` sidecar table populated (29 rows total), 32 demo patients across stock 1–3 + W1 cohort 4–13 + AF-SCHEDULED 14–28 + W2 cohort 29–32.
- 18 commits brought across in the pull (`d98bf6f13` → `3456a4e42`) plus the in-deploy fix `a3b954ab6` — VPS, `gitlab/master`, and `origin/master` all at the same tip.
- agentforge-api rebuilt clean (`npm ci` 16s, `tsc` no errors, `agentforge-api listening on 3000`); `/health` reports `ok: true` with `openemr_module: ok`, `postgres: reachable`, `langfuse: ok`.

## Post-deploy hardening (logged for after Sunday)

1. **Caddyfile compose path mismatch** — committing a `docker/development-easy/Caddyfile` symlink, changing the prod.yml volume declaration to an absolute-from-repo path, or relocating the override to be co-located with `docker-compose.yml`. Pick one and remove the foot-gun.
2. **Prod-tsc gap in dev workflow** — add `tsc -p tsconfig.build.json --noEmit` (or the equivalent `npm run typecheck`) to the prek pre-commit hook so prod-only type errors cannot stay latent through a `git push` again.
3. **agentforge-api dependency drift** — `npm audit` reports 10 vulns (4 critical); pdfjs-dist@5.7.284 wants Node ≥22 but the runtime is on Node 20. Either bump Node or pin pdfjs-dist to a Node-20-compatible release.

## Links

- Session journal: [process/journal/week-2/0508-T0111-https-retrofit-vps-deploy.md](../../journal/week-2/0508-T0111-https-retrofit-vps-deploy.md)
- HTTPS-retrofit runbook: [docker/agentforge/README.md §"Adding HTTPS to OpenEMR on an existing VPS deploy"](../../../../../docker/agentforge/README.md)
- Predecessor prep journals (same calendar day): [0508-T0000](../../journal/week-2/0508-T0000-w2-lab-extractor-cross-check-fix.md), [0508-T0009](../../journal/week-2/0508-T0009-citation-tuning-and-https-deploy.md), [0508-T0010](../../journal/week-2/0508-T0010-demo-cohort-shift-and-marker-table.md)
- Prior VPS deploy milestone reference: [04-g2-early-gate-completion.md](04-g2-early-gate-completion.md)
- Submission scoreboard: [Documentation/AgentForge/submission.md](../../../submission.md)
