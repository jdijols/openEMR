---
date: 2026-04-28
topic: Vultr VPS live deploy + nip.io submission URL + ARCHITECTURE VPS wording
related_milestone: process/milestones/week-1/09-vps-live-deployment.md
---

# Vultr VPS live deploy — session journal

## Goal

Ship a **live OpenEMR URL** for Gauntlet MVP submission after DigitalOcean account issues; document the path (Vultr, Docker, `development-easy`, GitLab clone, firewall, optional demo data) and **align [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md)** with a **generic VPS** model instead of DigitalOcean-specific wording.

## Context

Initial plan referenced DigitalOcean + Docker Compose ([`05-stage2-deployment-decision.md`](../../milestones/week-1/05-stage2-deployment-decision.md)). DigitalOcean account lockout blocked that path; the user proceeded on **Vultr** with Ubuntu 24.04, Docker Engine + Compose plugin, **`docker/development-easy`**, **`dev-reset-install-demodata`** for curated demo, and **nip.io** for a hostname-based submission URL.

## Key decisions

### Decision: DigitalOcean → alternate VPS provider

- **Prompt:** "my account is locked now... should I find a different solution?"
- **Recommendation:** Do not rely on MCP/CLI to bypass cloud account locks; pursue support or provisionally use **another VPS** (e.g. Vultr, Linode) with the **same Ubuntu + Docker + Compose** shape.
- **Outcome:** Deployed on **Vultr**; docs updated to generic **VPS** language with **Vultr** as the concrete MVP host.

### Decision: Dev stack vs “production” label

- **Prompt:** "`development env` ... I thought production deployment"
- **Recommendation:** **`development-easy`** is intentionally **developer-oriented** (weak defaults, Xdebug, published DB port on host); it is acceptable for **course demo / synthetic data** per scope separation in [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md); real production is a follow-on hardening pass.
- **Outcome:** User accepted **dev-easy** as the expedient public demo; **Caddy/HTTPS** and non-dev compose remain the architecture target for a “production-shaped” URL.

### Decision: Getting code onto the server

- **Prompt:** GitLab fork + local unpushed state; how to sync?
- **Recommendation:** **Push + clone** when possible; **`rsync`** from laptop if needed; **ignore** `.claude/` tooling in Git; use **PAT or deploy key** for private GitLab.
- **Outcome:** Successful **`git clone`** from `labs.gauntletai.com` on the VPS after auth; **`.claude/`** removed from tracking via **`.gitignore`**.

### Decision: Readable URL without buying a domain (yet)

- **Prompt:** IP-only links frustrate graders; options for **free** names on Vultr?
- **Recommendation:** VPS providers rarely bundle free custom TLDs; **nip.io** / **sslip.io** encoding the public IP give a hostname without purchase; optional **DuckDNS**; **proper HTTPS** still ideally needs **reverse proxy + Let’s Encrypt** when time allows.
- **Outcome:** Submission uses **nip.io** style hostname toward the VPS (exact URL not canonicalized in repo).

### Decision: ARCHITECTURE wording pivot

- **Prompt:** Update [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) from DigitalOcean **droplets** to **Vultr or generic VPS**.
- **Recommendation:** Prefer **neutral “single Linux VPS / VM”** language everywhere operationally identical; cite **Vultr** once as the deployed provider for MVP where it adds clarity.
- **Outcome:** See [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) edits in this change; milestone [`09-vps-live-deployment.md`](../../milestones/week-1/09-vps-live-deployment.md).

### Decision: Demo data on fresh VPS

- **Prompt:** Logged in but **no mock data** like local dev.
- **Recommendation:** Run **`docker compose exec openemr /root/devtools dev-reset-install-demodata`** from **`docker/development-easy`** per [`CONTRIBUTING.md`](../../../../../CONTRIBUTING.md); destructive reset of DB — expected for empty → demo.
- **Outcome:** Documented as the standard path; user ran against live stack.

## Trade-offs and alternatives

- **Linode / Hetzner / Lightsail** — Same shape; not chosen after Vultr signup succeeded.
- **DigitalOcean** — Original plan; blocked by account lock.
- **Production Docker compose** — Stronger posture; deferred vs deadline and dev-easy velocity.

## Tools, dependencies, commands

- Ubuntu 24.04 LTS on Vultr; **Docker Engine** + **Compose plugin** (official Docker apt repo).
- **UFW:** `22`, `80`, `443`, **`8300`** for `development-easy` HTTP; **do not** expose **8320** (MySQL) to WAN — use **Vultr cloud firewall** if UFW + Docker interact oddly.
- **Clone:** `git clone https://labs.gauntletai.com/jasondijols/openemr.git` (auth via GitLab user/PAT as required).
- **Stack:** `cd /opt/openemr/docker/development-easy && docker compose up --detach --wait`
- **Demo data:** `docker compose exec openemr /root/devtools dev-reset-install-demodata`

## Files touched

- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T2115-vultr-vps-deployment.md`
- **Created:** `Documentation/AgentForge/process/milestones/week-1/09-vps-live-deployment.md`
- **Modified:** `Documentation/AgentForge/README.md`
- **Modified:** `ARCHITECTURE.md`

## Outcomes

- Process trail has **milestone 09** for VPS live deployment; journal captures DO → Vultr pivot, dev-easy caveats, GitLab + firewall notes, and demo-data command.
- **`ARCHITECTURE.md`** describes **generic VPS** hosting (Vultr named where useful) instead of DigitalOcean-only framing.

## Next steps

- [ ] Add **Caddy** (or nginx) on **80/443** reverse-proxying to **`127.0.0.1:8300`** with **Let’s Encrypt** when DNS or hostname is stable; align with executive summary “HTTPS deployment.”
- [ ] Tighten **Vultr firewall**: confirm **8320** / **8310** not world-open.
- [ ] Optional: migrate from **dev-easy** to a **production-shaped** compose when agent stack (`agentforge-api`, Langfuse Postgres) lands.

## Links

- Numbered milestone: [process/milestones/week-1/09-vps-live-deployment.md](../../milestones/week-1/09-vps-live-deployment.md)
- Related: [process/milestones/week-1/05-stage2-deployment-decision.md](../../milestones/week-1/05-stage2-deployment-decision.md)
