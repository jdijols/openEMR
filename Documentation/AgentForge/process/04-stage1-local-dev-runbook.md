# Stage 1 — Local OpenEMR (easy dev + demo data)

Runbook for Gauntlet Stage 1: OpenEMR running locally with the curated development demo dataset. Upstream docs: [CONTRIBUTING.md](../../../CONTRIBUTING.md) (local development + devtools).

## Why Docker easy-dev (for now)

The **Easy Development Docker** stack (`docker/development-easy`) is what OpenEMR documents for contributors. The `flex` image bundles PHP 8.2+, required extensions, MariaDB wiring, CouchDB, and `/root/devtools` (including `dev-reset-install-demodata`). A native LAMP install is possible but means installing many PHP extensions and services yourself. **Deploy shape (Docker vs bare metal) is TBD** until the Presearch checklist ([03-presearch-checklist.md](03-presearch-checklist.md)).

## Prerequisites (your machine)

- **Git** — repo already cloned at `openEMR/`.
- **Docker Engine + Docker Compose v2** — e.g. [Docker Desktop](https://docs.docker.com/desktop/) on macOS. Ensure Docker is **running** (`docker version` succeeds in Terminal).
- **Resources** — first image pull is large; allow several GB disk and enough RAM for MariaDB + OpenEMR containers.

> **Cursor agent note:** Automated execution from this workspace failed with `docker: command not found` — run the commands below in **your local Terminal**, not only inside the IDE, if Docker is installed for your user.

### If Terminal says `command not found: docker`

Docker is not installed or not on your PATH. On macOS, install and start **[Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/)**, wait until the engine is running, open a **new** Terminal tab, then `docker --version` should succeed.

## One-time: bring the stack up

From the **repository root** (adjust path if your clone lives elsewhere):

```bash
cd /Users/jasondijols/Documents/Code-Projects/openEMR/docker/development-easy
docker compose up --detach --wait
```

Wait until containers are healthy. Logs should eventually show Apache/cron starting (see CONTRIBUTING).

### URLs and ports (defaults)

| Service    | URL / connection |
| ---------- | ---------------- |
| OpenEMR HTTP  | http://localhost:8300/ |
| OpenEMR HTTPS | https://localhost:9300/ (browser may warn on cert) |
| phpMyAdmin | http://localhost:8310/ |
| MariaDB    | `localhost:8320` (TLS — see compose volume mounts) |

Override ports if needed with env vars `WT_HTTP_PORT`, `WT_HTTPS_PORT`, `WT_MYSQL_PORT` (see [docker/development-easy/docker-compose.yml](../../../docker/development-easy/docker-compose.yml)).

### First login (before demo reset)

- **Username:** `admin`
- **Password:** `pass`

(From `OE_USER` / `OE_PASS` in the compose file.)

If login fails before demo load, double-check lowercase `admin` / `pass`, wait for the `openemr` container to finish first-time setup, or inspect logs: `docker compose logs openemr`.

### Staff demo users (after demo data load)

Official list: [Development Demo — Demo Credentials](https://www.open-emr.org/wiki/index.php/Development_Demo#Demo_Credentials). Staff accounts include `admin`, `physician`, `clinician`, `accountant`, `receptionist` (password often matches username for role accounts). These align well with **future MVP user stories** by role. **Patient portal** logins are documented on the same wiki page but are **out of scope** for current AgentForge scope (staff / practitioner only).

## Load curated demo data (Option A)

**Warning:** This **wipes and reinstalls** the dev database. Safe for empty dev only; never use on real PHI.

With the stack running, still in `docker/development-easy`:

```bash
docker compose exec openemr /root/devtools dev-reset-install-demodata
```

After it completes, log in with **`admin` / `pass`** or any **staff demo user** from the wiki (see [Staff demo users](#staff-demo-users-after-demo-data-load) above). **Without this command,** the database may be nearly empty—**Finder** and searches can look blank even though the app works.

## Finding demo patients and providers in the UI

After demo data is loaded:

1. Use the top tab **Finder** (standard menu) or **Patient → Find Patient** (e.g. front-office style menus). Both target the dynamic patient finder (`interface/main/finder/dynamic_finder.php`).
2. Search by name or other demographics; open a row to view the **patient chart** (demographics, encounters, etc.).
3. Use **`admin`** or **`physician`** while exploring if menu items seem missing—narrower roles hide some ACL-gated areas.

**Layout:** The login page is a narrow centered card; after sign-in, the main EHR uses a wider desktop-style layout (tabs, nav). The UI is responsive down to mobile but is primarily a desktop staff workflow.

## Verification checklist

- [x] http://localhost:8300/ loads. _(verified 2026-04-27)_
- [x] After demo load: **Finder** lists demo patients / providers and clients visible in the app. _(verified 2026-04-27)_
- [x] Open at least one patient chart without errors. _(verified 2026-04-27)_
- [ ] (Optional) Log in as a non-admin demo user and confirm UI differences.

## Teardown

- **Stop, keep data:** `docker compose down`
- **Stop and delete volumes (full reset):** `docker compose down -v`

## Optional: refresh images later

```bash
docker compose pull
```

## Not in scope for Stage 1

- **Synthea** (`import-random-patients`) — deferred.
- **Production compose** — see [docker/production/docker-compose.yml](../../../docker/production/docker-compose.yml) when you define deploy; it uses `openemr/openemr:latest`, not the `flex` dev image.

## Session log

| Field | Value |
| ----- | ----- |
| Date | 2026-04-27 |
| Docker | _(optional: `docker --version` on your machine)_ |
| Compose | _(optional: `docker compose version`)_ |
| Data path | `dev-reset-install-demodata` (curated demo) |
| Status | Stage 1 deliverable met locally: stack up, demo loaded, patients visible via Finder. See [journal entry](../journal/week-1/0427-T2145-stage1-openemr-demo-verified.md). |
