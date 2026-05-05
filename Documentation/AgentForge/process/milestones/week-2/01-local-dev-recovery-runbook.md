# Local-dev recovery: `sites/default` reset to baseline

**Purpose:** Recovery procedure for the local Docker dev stack when `localhost:8300` shows OpenEMR's **Pre Install — Checking File and Directory Permissions** wizard instead of the usual login. First observed and resolved 2026-05-04 (start of Week 2). This runbook is the durable form of the session journal at [`../../journal/week-2/0504-T1431-dev-recovery-and-trail-reorg.md`](../../journal/week-2/0504-T1431-dev-recovery-and-trail-reorg.md). VPS deployment is **not** affected by this scenario — see "Why the VPS is unaffected" below.

## Symptom

`http://localhost:8300/` lands on **"OpenEMR Setup → Pre Install — Checking File and Directory Permissions"** with a blue **"Proceed to Step 1"** button. The page reports `sqlconf.php` and `documents/` as ready and invites you to start a fresh install.

## Critical: do NOT click "Proceed to Step 1"

That button runs OpenEMR's SQL bootstrap (`sql_upgrade.php` / fresh-install path) against whatever database `sqlconf.php` points at. If your `databasevolume` still has the AgentForge demo (28 patients, 18 modules incl. `oe-module-agentforge`), the bootstrap will overwrite it. The wizard appears because of a **filesystem-side** reset, not a missing database — confirm DB state before touching anything.

## Root cause

The dev-easy compose mounts `development-easy_sitesvolume` over `/var/www/localhost/htdocs/openemr/sites/`. On a fresh container, that volume is populated from the openemr-flex image baseline, where `sites/default/sqlconf.php` has `$config = 0` (uninitialized) and `$host = 'localhost'`. OpenEMR reads `$config = 0` and shows the install wizard.

The volume can return to baseline if `docker compose down -v` ran (removes named volumes) or if the volume was otherwise dropped. The MariaDB volume (`databasevolume`) is **separate** and is generally untouched by the same operation that wipes `sitesvolume` — confirm before proceeding.

## Diagnostic check (run first, always)

From the repo root:

```bash
# 1. Are the containers up?
docker compose -f docker/development-easy/docker-compose.yml ps

# 2. Is the openemr DB still populated?
docker compose -f docker/development-easy/docker-compose.yml exec -T mysql \
  mariadb -uopenemr -popenemr -e \
  "SELECT COUNT(*) AS patients FROM openemr.patient_data; \
   SELECT COUNT(*) AS modules FROM openemr.modules;"

# 3. Inspect the sites/default/sqlconf.php that OpenEMR is reading
docker compose -f docker/development-easy/docker-compose.yml exec -T openemr \
  cat /var/www/localhost/htdocs/openemr/sites/default/sqlconf.php
```

If patients > 0 and modules > 0, your data is safe — proceed to "Recovery". If patients == 0, this runbook is the wrong tool — you'd be looking at a full DB rebuild instead.

## Recovery

In `sites/default/sqlconf.php`, change two lines:

| Line | From | To |
|---|---|---|
| `$host` | `'localhost'` | `'mysql'` |
| `$config` | `0` | `1` |

`'mysql'` is the docker-compose service name — that's how containers reach MariaDB by DNS. `localhost` is the image baseline and is wrong inside this stack.

```bash
docker compose -f docker/development-easy/docker-compose.yml exec -T openemr sh -c "
  cd /var/www/localhost/htdocs/openemr/sites/default
  cp sqlconf.php sqlconf.php.bak
  sed -i \"s/\\\$host   = 'localhost';/\\\$host   = 'mysql';/\" sqlconf.php
  sed -i 's/\\\$config = 0;/\\\$config = 1;/' sqlconf.php
"
```

Reload `localhost:8300`. You should land on the OpenEMR login page. The backup is at `sites/default/sqlconf.php.bak` inside the volume.

## What may also have been wiped (separately)

The `sitesvolume` reset also blanks:

- `sites/default/documents/` — patient document attachments. The DB still has the metadata rows; the actual files are gone.
- `sites/default/LBF/` — custom layout extras.
- `sites/default/config.php` — site-specific config.

For the AgentForge demo none of these matter (no flow depends on uploaded documents). If you need them, restore from a prior `sitesvolume` snapshot or re-run the relevant seeders.

## Why the VPS is unaffected

The VPS is a separate machine with its own filesystem and DB. The local `sitesvolume` resetting on a developer laptop has no path to production. Our deploy workflow ([`../week-1/09-vps-live-deployment.md`](../week-1/09-vps-live-deployment.md)) imports a **full local DB dump** into the VPS DB — that's DB-only, and `sites/default/documents/` (etc.) are not synced. The VPS keeps its own `sqlconf.php` with the correct values for that host.

The one indirect concern: if a deploy session runs the local stack to refresh demo data and the local stack is in this broken state, the deploy can't seed — fix locally first using this runbook, then deploy.

## Repo-side note

The `sites/default/sqlconf.php` host file is bind-mounted into the container; writes to the container's volume layer can propagate back to the host repo working tree. If `git status` shows `M sites/default/sqlconf.php` after recovery, that's expected — the values are docker-compose-service-specific and should generally **not** be committed. The repo baseline (`$host=localhost`, `$config=0`) stays correct for fresh installs and the live VPS.

## Cross-references

- Full pivot history for this session: [`../../journal/week-2/0504-T1431-dev-recovery-and-trail-reorg.md`](../../journal/week-2/0504-T1431-dev-recovery-and-trail-reorg.md)
- Stage 1 local-dev baseline runbook: [`../week-1/04-stage1-local-dev-runbook.md`](../week-1/04-stage1-local-dev-runbook.md)
- VPS deployment runbook: [`../week-1/09-vps-live-deployment.md`](../week-1/09-vps-live-deployment.md)
- Demo data seeding: see top-level [`Documentation/AgentForge/README.md`](../../../README.md) "Demo data seeding (local Docker)"
