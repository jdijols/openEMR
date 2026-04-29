# VPS live deployment (Gauntlet MVP)

**Purpose:** Record how the **public OpenEMR demo** is reached for MVP submission — **Docker Compose on a Linux VPS**, after the original DigitalOcean plan was blocked. Long-form pivots live in [`journal/week-1/0428-T2115-vultr-vps-deployment.md`](journal/week-1/0428-T2115-vultr-vps-deployment.md).

**MVP host:** A **single Linux VPS** deployed on **Vultr** (Ubuntu LTS); the same steps transfer to Linode, AWS Lightsail, etc. **`docker/development-easy`** is the expedient upstream stack documented in [`CONTRIBUTING.md`](../../../CONTRIBUTING.md); it is **dev-oriented** (easy credentials, tooling) — adequate for synthetic/course demos, not regulated production without hardening ([`ARCHITECTURE.md`](../../../ARCHITECTURE.md)).

## Decisions

- **Provider:** Moved from unavailable DigitalOcean to **Vultr**; architecture text uses **neutral “VPS”** so the host can change without rewriting integration assumptions.
- **Source of truth on the server:** `git clone` from **Gauntlet GitLab** (`labs.gauntletai.com/...`) with PAT/SSH deploy key as appropriate.
- **Public URL:** Grader-facing link may use **`http://PUBLIC_IP:8300`** or a **nip.io** hostname resolving to that IP until **Caddy/nginx + HTTPS + DNS** are wired per [`ARCHITECTURE.md`](../../../ARCHITECTURE.md).
- **Demo data:** **`docker compose exec openemr /root/devtools dev-reset-install-demodata`** from **`docker/development-easy`** (resets DB; see wiki demo credentials linked from **`CONTRIBUTING.md`**).

## Operational sketch

1. **OS + Docker:** Ubuntu LTS; Docker Engine + Compose plugin (Docker upstream install docs).
2. **Firewall:** **UFW:** allow **SSH**, **8300** (dev-easy HTTP), **80/443** (future reverse proxy); **never** advertise **8320** (MariaDB mapped to host) to the internet — use **provider firewall** to deny WAN on DB/phpMyAdmin ports when possible.
3. **Repo:** `cd /opt && git clone <fork-url> openemr`
4. **Stack:** `cd openemr/docker/development-easy && docker compose up --detach --wait`
5. **Data:** optionally **`dev-reset-install-demodata`** after containers are healthy.

---

*Cross-link: [`0428-T2115-vultr-vps-deployment.md`](journal/week-1/0428-T2115-vultr-vps-deployment.md)*
