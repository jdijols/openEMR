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
copilot iframe makes CORS-allowed cross-origin fetches to `https://${HOST}` (Caddy → API).

## VPS production runbook (Gate 2 smoke–level)

Do this on the server where Docker runs (same layout as `development-easy` + overrides).

1. **DNS / ports** — both `AGENTFORGE_PUBLIC_HOSTNAME` and `OPENEMR_PUBLIC_HOSTNAME` (e.g. `YOUR_IP.nip.io` and `oe.YOUR_IP.nip.io`) must resolve to the VPS; inbound **80** and **443** open (Let’s Encrypt HTTP-01 for both certs).

2. **`secrets.prod.env` on the VPS** (copy from `secrets.env.example`, never commit):
   - `AGENTFORGE_PUBLIC_HOSTNAME` — hostname Caddy will obtain a cert for (no `https://`). Used by the Agent API site.
   - `AGENTFORGE_API_PUBLIC_URL` — `https://` + that same hostname (what the **browser** calls; `panel.php` injects this).
   - `OPENEMR_PUBLIC_HOSTNAME` — hostname Caddy will obtain a second cert for, fronting OpenEMR. **This is the URL the Gauntlet submission form requires** (HTTPS-only). Optional: omit to keep OpenEMR on plain HTTP via its host port mapping (the rail still works since the API has its own HTTPS hostname).
   - `CUI_ALLOWED_ORIGINS` — **exact** Origin for OpenEMR as seen in DevTools (scheme + host + port). When using the new HTTPS proxy, set to `https://${OPENEMR_PUBLIC_HOSTNAME}` (no port — Caddy listens on 443). For backward compatibility you can list both old and new origins comma-separated, e.g. `http://YOUR_IP.nip.io:8300,https://oe.YOUR_IP.nip.io`. A mismatch → CORS failures in the rail.
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

5. **OpenEMR smoke (browser)** — log in → open **one** demo/cohort chart → open Clinical Copilot rail → allergy or identity prompt with cited **Claim**(s). If handshake fails, check CORS Origin, HTTPS vs HTTP mix, and that `OPENEMR_MODULE_SHARED_SECRET` matches between PHP and API.

6. **Logs** — `docker compose logs -f agentforge-api caddy openemr` (service names may vary slightly by profile).

Rotate any API keys or shared secrets if they appeared in plaintext outside the VPS.

### Adding HTTPS to OpenEMR on an existing VPS deploy

If your existing prod deploy has Caddy fronting only the Agent API and OpenEMR is reachable on plain HTTP at port 8300 (the W1 baseline), follow these steps to add a second HTTPS site for OpenEMR. The Gauntlet submission form requires the deployed-app URL to be HTTPS, and graders open this URL directly to test — bare IP + port + http does not satisfy the requirement.

**On your laptop:** the Caddyfile change ships in `docker/agentforge/Caddyfile` (Site 2 block keyed on `OPENEMR_PUBLIC_HOSTNAME`). Pull the latest master on the VPS, and the new config is in place.

**On the VPS** (ssh in first):

1. **Pick the OpenEMR hostname.** With nip.io, no DNS work is needed — any subdomain prefix resolves to the encoded IP. Example: VPS public IP `108.61.145.220` → use `oe.108-61-145-220.nip.io`.

2. **Edit `docker/agentforge/secrets.prod.env`**:
   ```env
   # add this line:
   OPENEMR_PUBLIC_HOSTNAME=oe.108-61-145-220.nip.io
   # update CUI_ALLOWED_ORIGINS to include the new HTTPS origin:
   CUI_ALLOWED_ORIGINS=http://108-61-145-220.nip.io:8300,https://oe.108-61-145-220.nip.io
   ```
   Listing both origins lets the legacy HTTP path keep working while the HTTPS path comes online — no flag-day cutover required.

3. **Pull master on the VPS** (if not already):
   ```bash
   git pull origin master
   ```

4. **Restart Caddy with the new config** — from `docker/development-easy`:
   ```bash
   AGENTFORGE_SECRETS_FILE=../agentforge/secrets.prod.env docker compose \
     -f docker-compose.yml \
     -f ../agentforge/docker-compose.override.yml \
     -f ../agentforge/docker-compose.prod.yml \
     up -d caddy
   ```
   Caddy will request a Let's Encrypt cert for the new OpenEMR hostname via HTTP-01 challenge. The first request takes a few seconds while the cert is issued; subsequent requests are instant.

5. **Verify** (from your laptop):
   ```bash
   # cert issued and serving:
   curl -fsS "https://${OPENEMR_PUBLIC_HOSTNAME}/" -o /dev/null -w "%{http_code}\n"
   # expect 200 or 302 (OpenEMR redirect to login)

   # the Agent API HTTPS site is unaffected:
   curl -fsS "https://${AGENTFORGE_PUBLIC_HOSTNAME}/health"
   # expect ok: true
   ```

6. **Smoke in browser** — open `https://${OPENEMR_PUBLIC_HOSTNAME}/` directly. Login, open a cohort chart, the rail should load with no mixed-content warnings (the rail's own fetches go to the API HTTPS hostname). The footer EvalGate + PHI badges should be green.

**Use this URL** in the Gauntlet submission form. Keep the legacy `http://...:8300` URL for any internal smoke that isn't graded.

If `https://${OPENEMR_PUBLIC_HOSTNAME}/` returns connection refused or a Caddy error page, check `docker compose logs caddy` for ACME challenge failures (most common cause: port 80 not reachable from the public internet — confirm the VPS firewall allows inbound 80 and 443).

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
