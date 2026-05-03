---
date: 2026-04-30
topic: Prod deploy on Vultr VPS — Gate 2 smoke green; G6-18 added
related_milestone: process/11-gate0-complete.md
---

# Prod deploy + Gate 2 smoke on VPS — session journal

## Goal

Push the AgentForge Clinical Copilot stack to the Vultr VPS (`108-61-145-220.nip.io`) and reproduce the dev Gate 2 smoke (cited allergy/identity read + S1 cross-patient probe) in production. Take it one step at a time so any issue surfaces a single clean signal.

## Context

Earlier today: Gate 2 closed in dev (G2-12 smoke), and G2-14 was renamed/moved to Gate 3 as **G3-12** (active chart sync). VPS clone at `/opt/openemr` was on a stale commit and dirty (mixed root/linuxuser ownership, untracked cohort/journal artifacts). Production overlay (`docker-compose.prod.yml`, `Caddyfile`, `secrets.env.example`) only landed on `origin/master` after the user pushed the latest local commits to GitLab mid-session.

## Key decisions

### Decision: tighten step pacing on remote ops

- **Prompt:** "We need to take this slow, step by step. In fact, make your responses one step at a time. Until I confirm that step, don't move forward."
- **Recommendation:** Switch to a strict one-command-per-turn loop with explicit “paste output, then I’ll send next step”; avoid combo commands when ownership/state is uncertain.
- **Outcome:** Used through the entire VPS bring-up; surfaced root vs `linuxuser`, ownership churn, and missing prod files cleanly without compounding errors.

### Decision: hard-reset VPS working tree to `origin/master`

- **Prompt:** "Before I go ahead and submit this command, I just want to make sure that the database... will be on the new version."
- **Recommendation:** Confirm OpenEMR data lives in the **`development-easy_databasevolume`** Docker volume (untouched by Git ops), back up both the dev migration `.sql.gz` *and* a fresh VPS `mariadb-dump --all-databases` to `/root/agentforge-backups/`, then run `chown -R linuxuser:lxd /opt/openemr && git reset --hard origin/master && git clean -fd`.
- **Outcome:** DB volume preserved (28 patients, 177 appointments verified pre/post). Backups landed at `/root/agentforge-backups/local-openemr-20260429-183359.sql.gz` and `vps-openemr-pre-merge.sql.gz` (10.4 MB). Tree fast-forwarded to `400db2336`, exposing `docker/agentforge/`.

### Decision: replace mistakenly-created `Caddyfile` directory with a symlink

- **Prompt:** *(implicit — Docker error: "not a directory: Are you trying to mount a directory onto a file…")*
- **Recommendation:** Convention is `docker/development-easy/Caddyfile` → host bind path. The real config lives at `docker/agentforge/Caddyfile`; a stray empty directory at the dev path was created when a prior step shelled in as root. Symlink the dev path to the real prod Caddyfile rather than duplicate config.
- **Outcome:** `ln -sf /opt/openemr/docker/agentforge/Caddyfile /opt/openemr/docker/development-easy/Caddyfile`; Caddy started, ACME succeeded against `108-61-145-220.nip.io`.

### Decision: add `contracts/` mount to `agentforge-api` prod service

- **Prompt:** *(implicit — `tsc` failure: "Cannot find module '../../../contracts/module-http-paths.json'")*
- **Recommendation:** `docker-compose.prod.yml` only mounted `agentforge/api` → `/app`, but `src/openemr/types.ts` imports `../../../contracts/module-http-paths.json` (one level above). Add a second bind mount: `../../agentforge/contracts:/contracts`.
- **Outcome:** `agentforge-api` build cleared, container started, `agentforge-api listening on 3000`. Edited live in `/opt/openemr/docker/agentforge/docker-compose.prod.yml`; **same change must be committed upstream** so future VPSs don’t repeat the diagnosis.

### Decision: keep module activation manual; track auto-enable as G6-18

- **Prompt:** "Should we add a task to the task list that tries to make the module enabled by default? Do we have that ability to do that in production…"
- **Recommendation:** OpenEMR doesn’t block self-registration, but bypassing **Modules → Manage Modules** risks surprising admins, clobbering ACLs, and tangling with future upgrades. Best path: idempotent ops script (e.g. `bin/agentforge-enable.php` or `sql/002_module_register.sql`) that inserts the `modules` + `modules_hooks` rows on a fresh DB and is a no-op on re-runs. Schedule under **Gate 6 / deploy hardening**, not pre-submission.
- **Outcome:** Added **`G6-18`** to `TASKS.md` with depends `G2-01..G2-03, G6-05`, criticality High, cut tier 6.

### Decision: HTTPS curl `verify result` warning on VPS is benign

- **Prompt:** *(implicit — `curl -fsS https://...` failed with `tlsv1 alert internal error`, then `curl -vk` showed valid LE cert + 502)*
- **Recommendation:** TLS handshake completes against a real Let’s Encrypt cert; the local CA bundle on this VPS just can’t verify level-1 chain. The 502 is a real upstream error, separate from the TLS warning. Address by debugging `agentforge-api`, not the cert.
- **Outcome:** After fixing the contracts mount the same `curl -k …/health` returned `{"ok":true,...}`. Browser smoke (chart icon, allergy/identity prompt with citation, Raymond Cooper cross-patient refusal) all green after enabling the module via Manage Modules.

## Trade-offs and alternatives

- **Auto-register module via `Bootstrap` self-install** — rejected as too magical; obscures admin install path and risks ACL drift. Captured under G6-18 alternative-considered.
- **Don’t back up DB before `git reset --hard`** — rejected; cheap insurance vs the ambiguous mixed-ownership state.
- **Edit `docker-compose.prod.yml` only on the VPS** — partly accepted to unblock tonight; followed up by adding a TODO to commit the `contracts/` mount upstream.

## Tools, dependencies, commands

- VPS shell loop:
  - `sudo -iu linuxuser bash -lc 'cd /opt/openemr && git fetch origin && git reset --hard origin/master && git clean -fd'`
  - `chown -R linuxuser:lxd /opt/openemr`
  - `docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml -f ../agentforge/docker-compose.prod.yml up -d --build`
  - `docker compose ... up -d --build --force-recreate agentforge-api`
  - `docker compose ... logs --tail=120 agentforge-api`
  - `curl -k https://108-61-145-220.nip.io/health` → `{"ok":true,...}`
- Local backups: `mariadb-dump --all-databases | gzip > /root/agentforge-backups/vps-openemr-pre-merge.sql.gz`.

## Files touched

- **Modified:** [`TASKS.md`](../../../../../TASKS.md) — added **G6-18** under Gate 6.
- **Created (this file):** `Documentation/AgentForge/process/journal/week-1/0430-T0213-prod-deploy-vps-smoke.md`.
- **VPS-only (not in repo this session):** `/opt/openemr/docker/agentforge/docker-compose.prod.yml` (added `../../agentforge/contracts:/contracts` mount), `/opt/openemr/docker/development-easy/Caddyfile` (symlink to `agentforge/Caddyfile`), `/opt/openemr/docker/agentforge/secrets.prod.env` (filled).

## Outcomes

- AgentForge production stack is **live** at `https://108-61-145-220.nip.io`; `/health` returns `ok:true`; rail + cited allergy/identity read + S1 cross-patient (Raymond Cooper) probe all green in the browser via OpenEMR on `http://108-61-145-220.nip.io:8300`.
- VPS DB integrity preserved through the ownership/reset churn; pre-merge `.sql.gz` archived at `/root/agentforge-backups/`.
- Task list now tracks **G6-18** (auto-enable module) so module activation will not require a manual click on future deploys.

## Next steps

- [ ] Commit the `contracts:/contracts` bind mount in `docker/agentforge/docker-compose.prod.yml` upstream so the next VPS bring-up doesn’t need to rediscover this.
- [ ] Land **G3-12** (active chart sync) when starting Gate 3 work; remove the “use full reload between A/B” caveat from the operator checklist.
- [ ] Implement **G6-18** when starting Gate 6 deploy hardening; pair with `preflight.sh` so a fresh box reaches a working rail with zero manual clicks.
- [ ] Rotate `OPENEMR_MODULE_SHARED_SECRET` / `SESSION_TOKEN_SECRET` if the values placed on the VPS were ever transmitted in plaintext outside this session.

## Links

- Task list: [`TASKS.md`](../../../../../TASKS.md) — see **Gate 6 / G6-18**.
- Earlier same-day journals: [`0430-T0050-gate2-session-handoff-g212-g214.md`](./0430-T0050-gate2-session-handoff-g212-g214.md), [`0430-T1830-gate2-closed-g212-manual-smoke.md`](./0430-T1830-gate2-closed-g212-manual-smoke.md).
- Prior VPS deploy reference: [`process/09-vps-live-deployment.md`](../../09-vps-live-deployment.md).
