Compose stack extension for AgentForge (`PRD.md` §7). The override picks the
secrets file via `${AGENTFORGE_SECRETS_FILE}`, defaulting to dev:

```bash
cd docker/development-easy
docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml config --services
```

For a full merge dump locally, use `config` without `--services`; do **not** paste that output publicly — it expands values from the loaded secrets file.

## Secrets

Two files, one per environment (both gitignored via `*.env`):

- `docker/agentforge/secrets.dev.env` — local dev. Browser-facing values point at
  `http://localhost:3000` (Agent API) and `http://localhost:8300` (OpenEMR origin).
- `docker/agentforge/secrets.prod.env` — production. Browser-facing values point at
  the public host where the Agent API and OpenEMR are reachable. **Use unique strong
  values** for `OPENEMR_MODULE_SHARED_SECRET` and `SESSION_TOKEN_SECRET` (`openssl rand -hex 32`).

`secrets.env.example` documents the full key set; copy it to either env file when
adding new keys. The override attaches whichever file `AGENTFORGE_SECRETS_FILE`
selects to **`openemr`** (PHP `getenv` for the module) and **`agentforge-api`**.

## Bring the stack up

**Dev** (default — uses `secrets.dev.env`):

```bash
cd docker/development-easy
docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml up -d
```

In dev, run the Agent API on the host so the browser can reach `http://localhost:3000`:
`cd agentforge/api && npm run dev:host`. That overrides `POSTGRES_URL` to **`127.0.0.1:15432`**
(Postgres published on the loopback). Plain `npm run dev` keeps `secrets.dev.env`’s
`@postgres:5432`, which **does not resolve on the Mac**, so `/health` shows Postgres
degraded and `/chat` fails. The compose `agentforge-api` container is a placeholder
(`sleep infinity`).

**macOS (`mounts denied` / File Sharing):** If Compose fails with `mounts denied` for paths under this repo (e.g. `.../docker/library/sql-ssl-certs-keys/easy/ca.pem`), open **Docker Desktop → Settings → Resources → File Sharing** and add the **parent directory** that contains the repo (often `/Users/<you>/Documents` or **`/Users`**). Use normal macOS casing when `cd`-ing (**`/Users/...`**). Apply & restart Docker, then run `compose up -d` again.

**Prod** — adds `docker-compose.prod.yml`, which runs the Agent API in the
container and fronts it with Caddy as a TLS reverse proxy. The Hono API is
**never published to the host**; only Caddy is reachable from the internet
(`80` for ACME HTTP-01, `443` for HTTPS):

```bash
cd docker/development-easy
AGENTFORGE_SECRETS_FILE=../agentforge/secrets.prod.env \
  docker compose \
    -f docker-compose.yml \
    -f ../agentforge/docker-compose.override.yml \
    -f ../agentforge/docker-compose.prod.yml \
    up -d
```

Caddy reads `AGENTFORGE_PUBLIC_HOSTNAME` from the prod secrets file and serves
that hostname with automatic HTTPS via Let's Encrypt (`docker/agentforge/Caddyfile`).
Cert/state lives in the `caddy_data` named volume so renewals survive restarts.

Requirements on the prod host:
- Ports **80** and **443** free and publicly reachable (HTTP-01 challenge needs `:80`).
- Public DNS for `AGENTFORGE_PUBLIC_HOSTNAME` resolving to this host (`nip.io` works out of the box).

Browser flow in prod: OpenEMR on `http://${HOST}:8300` (origin); the embedded
co-pilot iframe makes CORS-allowed cross-origin fetches to `https://${HOST}` (Caddy → API).

## VPS production runbook (Gate 2 smoke–level)

Do this on the server where Docker runs (same layout as `development-easy` + overrides).

1. **DNS / ports** — `AGENTFORGE_PUBLIC_HOSTNAME` (e.g. `YOUR_IP.nip.io`) must resolve to the VPS; inbound **80** and **443** open (Let’s Encrypt HTTP-01).

2. **`secrets.prod.env` on the VPS** (copy from `secrets.env.example`, never commit):
   - `AGENTFORGE_PUBLIC_HOSTNAME` — hostname Caddy will obtain a cert for (no `https://`).
   - `AGENTFORGE_API_PUBLIC_URL` — `https://` + that same hostname (what the **browser** calls; `panel.php` injects this).
   - `CUI_ALLOWED_ORIGINS` — **exact** Origin for OpenEMR as seen in DevTools (scheme + host + port), e.g. `http://YOUR_IP.nip.io:8300`. A mismatch → CORS failures in the rail.
   - `OPENEMR_MODULE_BASE_URL` — keep **`http://openemr/interface/.../public`** (Docker service name; Agent API reaches OpenEMR on the internal network).
   - `POSTGRES_URL` — must match `postgres` service credentials in `docker-compose.override.yml` (default user/db `agentforge` / password `agentforge`).
   - `OPENEMR_MODULE_SHARED_SECRET` and `SESSION_TOKEN_SECRET` — strong unique values; **identical** meanings in OpenEMR PHP env and Agent API (both services load the same `env_file`).
   - `LLM_*` / `LANGFUSE_*` / `STT_*` — satisfy `agentforge/api/src/env.ts`; API will `exit 1` on boot if validation fails.

3. **Bring the stack up (prod)** — from repo `docker/development-easy`:
   ```bash
   AGENTFORGE_SECRETS_FILE=../agentforge/secrets.prod.env docker compose \
     -f docker-compose.yml \
     -f ../agentforge/docker-compose.override.yml \
     -f ../agentforge/docker-compose.prod.yml \
     up -d --build
   ```
   Wait for **`agentforge-api`** to finish `npm ci && build` on first boot (minutes). **`caddy`** must start after the API.

4. **Sanity curls (on laptop or VPS)**:
   ```bash
   curl -fsS "https://${AGENTFORGE_PUBLIC_HOSTNAME}/health"
   ```
   Expect JSON `ok: true`, `deps.postgres: "reachable"`. **`ok:false`** with `postgres: "degraded_chat_requires_migrations_or_url"` usually means **`002_gate4_conversations.sql`** was not applied (`cd agentforge/api && npm run db:migrate`). Symptom: **case presentation works** (no DB) but **chat send fails with a server error**.

5. **OpenEMR smoke (browser)** — log in → open **one** demo/cohort chart → open Clinical Co-Pilot rail → allergy or identity prompt with cited **Claim**(s). If handshake fails, check CORS Origin, HTTPS vs HTTP mix, and that `OPENEMR_MODULE_SHARED_SECRET` matches between PHP and API.

6. **Logs** — `docker compose logs -f agentforge-api caddy openemr` (service names may vary slightly by profile).

Rotate any API keys or shared secrets if they appeared in plaintext outside the VPS.

### Agent Postgres baseline (Gate G3-00)

`POSTGRES_URL` uses hostname **`postgres`** so it works **inside** Compose (API container, Langfuse). On your Mac, that hostname does not resolve (`ENOTFOUND`), so host-run scripts use **`POSTGRES_URL_MIGRATE`** aimed at **localhost**.

1. **`docker-compose.override.yml`** maps Postgres to **`127.0.0.1:15432`** → container port `5432`. Recreate the stack after pulling:
   ```bash
   cd docker/development-easy
   docker compose -f docker-compose.yml -f ../agentforge/docker-compose.override.yml up -d
   ```

2. **Run migrations from the host** (dotenv-cli does **not** override vars already set in the shell):

   ```bash
   cd agentforge/api
   POSTGRES_URL_MIGRATE='postgresql://agentforge:agentforge@127.0.0.1:15432/agentforge' npm run db:migrate
   ```

   Optionally add `POSTGRES_URL_MIGRATE` to `secrets.dev.env`; keep **`POSTGRES_URL`** as `...@postgres:5432/...` for containers.

Creates the `agentforge` schema + heartbeat table via `agentforge/api/db/migrations/001_agentforge_init.sql`.

**Alternative (no localhost port):** run SQL from inside the network with `docker compose exec postgres psql …` against the same migrations (not scripted here).

**Langfuse DB sharing:** both can use the same Postgres instance; Langfuse uses its own schema/tables — keep the **`agentforge`** schema for API-owned data so migrations do not collide.
