# Stage 2 — deployment decision (VPS + Docker Compose)

**Purpose:** Record the **target hosting model** for AgentForge Stage 2 (“live, publicly reachable OpenEMR fork”) and for **later deployment of the clinical agent on the same infrastructure**, without requiring execution notes to exist before the decision is made. This file is the index-worthy summary; session narrative lives in [journal/week-1/0428-T0030-stage2-deployment-decision.md](journal/week-1/0428-T0030-stage2-deployment-decision.md).

**Status:** **Decision locked.** **Provisioning** (VPS, Compose bring-up, HTTPS, stable URL) may follow in a separate execution block.

---

## 1. Decision summary

**Chosen approach:** A **single Linux VPS** running **Docker Compose**, structured to match OpenEMR’s **production-oriented Docker layout** in this fork: an **OpenEMR/PHP application container**, **MariaDB/MySQL** with **persistent volumes**, and (later) **HTTPS termination** via a reverse proxy (e.g. Caddy, Traefik, or nginx + Let’s Encrypt).

**Execution target (cohort, 2026):** **DigitalOcean Droplet** — same mental model as “generic VPS,” with Compose on Ubuntu, DO Cloud Firewall (80/443/SSH only; DB not public), and DNS to the droplet. Locked in [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) for Stage 5.

The **agent** will deploy as **additional Compose services** on the **same host and Docker network**, calling OpenEMR through documented integration surfaces rather than introducing a second hosting paradigm mid-program.

**Explicit exclusions from this decision:**

- **Vercel** (and similar serverless/edge-first hosts) as the **primary** host for full OpenEMR — wrong runtime and persistence model for PHP + MariaDB + durable files/state.
- **Full hyperscale** footprint (**AWS/GCP** “proper” landing zones) as **required** for Stage 2 — deferred unless later constraints demand it.

---

## 2. Circumstances and constraints (this fork / this cohort)

- **Gauntlet Stage 2** requires a **public URL** eventually; documentation stresses choosing stack **thoughtfully** because the **final agent ships on the same infrastructure**.
- **Comfort:** Limited appetite for **AWS/GCP** operational depth during AgentForge; **SSH familiarity exists**; **Railway-class PaaS** is also unfamiliar—trade-off is **learning curve type**, not “zero vs hero.”
- **GitLab:** Gauntlet GitLab at `labs.gauntletai.com`; initial push **HTTPS + Personal Access Token** after creating an **empty** project (SSH optional once keys are registered).
- **Audit trajectory:** Stage 3 work spans **security, performance, architecture, data quality, compliance/regulatory** passes ([03-presearch-checklist.md](03-presearch-checklist.md) informs constraints like latency, reliability, audit/compliance needs). Deployment choice should **not contradict** diagram-level descriptions of where PHI flows and where the agent runs.

---

## 3. Alternatives considered — trade-offs

### 3.1 VPS + Docker Compose (**chosen**)

| Upside | Downside |
| ------ | -------- |
| **Single mental model** — one machine, one Compose graph; agent + DB + app share a **private Docker network**. | **You operate** OS updates, SSH posture, disk snapshots, TLS/DNS. |
| Aligns with **upstream container artifacts** (repo distinguishes dev vs production compose); fewer “platform surprises” vs forcing EMR into odd runtimes. | First deploy can still take **multiple hours** if volumes/network/env mismatch—acceptable as **bounded engineering**, not architectural churn later. |
| Clear path to **optional local inference** (see §5) as extra containers or GPU-class upgrades **without migrating databases between clouds**. | **Firewall** discipline required (expose **80/443**, avoid exposing **3306** publicly; optional SSH IP restriction). |

### 3.2 Managed PaaS (Railway, Render, Fly.io-class)

| Upside | Downside |
| ------ | -------- |
| Often **faster** first HTTPS certificate and **less SSH**. | **OpenEMR-specific** fit must be **validated**: Dockerfile/service boundaries, **MySQL/MariaDB persistence**, timeouts, multi-service wiring via dashboard/env. |
| Multiple services in **one project** can resemble Compose mentally. | **Vendor limits** (plans, disks, cold starts) can force rework **if** assumptions diverge from long-lived PHP + SQL workloads. |

**Verdict:** Reasonable **spike** if Compose-on-VPS looked blocked; not selected as **primary** because **predictability** for **EMR + agent + optional local model** over the week outweighed marginal Day‑1 convenience.

### 3.3 Hyperscale (AWS, GCP)

| Upside | Downside |
| ------ | -------- |
| Enterprise roadmap: IAM, managed RDS, autoscaling, multi-region. | **Higher baseline complexity** (accounts, networking, IAM, billing guardrails) **before** the agent exists—disproportionate to Stage 2 **demo-grade** URL requirement **given cohort constraints**. |

**Verdict:** **Defer** unless scaling/regulatory drivers explicitly require it later.

### 3.4 Edge/serverless-first (e.g. Vercel)

**Verdict:** **Do not use** as the **core OpenEMR deployment**—misaligned with **PHP + MariaDB + persistence**. Any future edge surface would be **additive**, not a replacement tier.

---

## 4. Justification (why this decision holds)

1. **Problem shape:** OpenEMR is a **multi-tier LAMP-class application**, not a single-function serverless worker. **Compose on Linux** matches how contributors already reason about **containers + DB + volumes** in-repo.

2. **Gauntlet coupling:** “Deploy final agent to **same infrastructure**” favors **one Compose stack** that gains services over time rather than splitting EMR (one vendor) and agent (another) without cause.

3. **Operational honesty:** VPS trades **managed polish** for **transparent networking**—useful when reasoning about **agent latency**, **database locality**, and **audit narratives** in Stage 3.

4. **Git hygiene:** Source of truth remains **GitLab**; VPS runs **built images / compose** from tagged revisions—rollback stays **“known-good compose + images”** rather than opaque dashboard-only state.

---

## 5. Future outlook — agent integration and “local” models

### 5.1 Agent service

- Implement as **one or more containers** (API, worker, optional queue consumer) **adjacent to OpenEMR** on the **same Compose network**.
- Prefer **stable internal URLs** (service DNS names) for EMR-facing HTTP calls to reduce coupling to localhost hacks.

### 5.2 Local inference on the VPS (optional later)

- **Motivation:** Real-world deployments increasingly weigh **data residency** and **controlled inference boundaries**; running **Ollama / llama.cpp / vLLM-style** endpoints **on the same VPS** keeps PHI-adjacent payloads **off third-party model APIs** when policy requires—subject to **still** securing the VM, disks, backups, and administrative access.
- **Gauntlet shortcut:** Program materials may assume **agreements** with cloud LLM providers so **training on patient data** is out of scope for classwork—**Stage 3 compliance/regulatory audit** should still **document** logging, retention, breach-notification thinking, and **BAA/subprocessor implications** when cloud APIs are used ([03-presearch-checklist.md](03-presearch-checklist.md) Phase 1 reliability/compliance prompts).
- **Reality check:** **CPU-only** VPS inference works for **narrow demos**; **production-grade latency/concurrency** often implies **GPU-class** instances or smaller models—architecture diagrams can show **“inference endpoint”** abstractly first.

### 5.3 Cloud APIs (OpenAI, Anthropic, etc.)

- Likely **fastest iteration** for agent behavior during development if residency rules relax—design agent **configuration** so **base URL / provider** can swap toward **local HTTP** endpoints later without redoing deployment topology **if** the agent already targets **abstract inference**, not a vendor SDK wired everywhere.

---

## 6. Deferred execution checklist (when implementing)

_This section lists expectations only—no claim these steps are completed._

- [ ] Provision VPS (Ubuntu LTS or similar); harden SSH; configure **host firewall** (UFW or cloud SG): **80/443** public, **DB not** public.
- [ ] Install Docker Engine + Compose plugin.
- [ ] Bring up stack consistent with **`docker/production`** expectations; persistent volumes for DB (and OpenEMR file areas as required).
- [ ] TLS + DNS → capture **Stage 2 submission URL**.

---

## Decisions (lifted from journal)

| Topic | Outcome | Detail |
| ----- | ------- | ------ |
| GitLab auth | HTTPS + PAT (empty project first) | See journal — SSH remains optional. |
| Hosting | VPS + Compose | §1–4 above. |
| Timeline | Decision before live URL | Diagrams target §1 topology without blocking on VPS completion. |

**Journal link:** [0428-T0030-stage2-deployment-decision.md](journal/week-1/0428-T0030-stage2-deployment-decision.md)
