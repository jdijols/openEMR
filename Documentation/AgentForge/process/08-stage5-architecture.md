# Stage 5 — architecture / AI integration plan (process pointer)

**Purpose:** Index entry for the **Gauntlet AgentForge Stage 5 hard-gate deliverable** at [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) (repo root). Stage 5 is the **forward-looking AI integration plan**: where the agent lives, how it accesses patient data, authorization boundaries, risks, and mitigations. The case study asks for a ~1-page **executive summary** of high-level architecture; the current `ARCHITECTURE.md` pairs that with a **“For instructors”** decision table and a shorter body so the doc stays readable.

**Status:** Aligned with cohort critique (2026): **DigitalOcean Droplet** + **Docker Compose** (concrete VPS choice under the [Stage 2 VPS decision](05-stage2-deployment-decision.md)); **React** (Vite + TypeScript) for the iframe panel; **Node + Vercel AI SDK** for `agentforge-api`; bounded **Agent Context Service** in `oe-module-agentforge`; **verification**, **traceability**, **audit**, **eval**, and **DO deploy** steps retained in condensed form.

---

## 1. How to read `ARCHITECTURE.md`

- **Start here for grading / defense:** **For instructors** table + **Executive summary** (audit + `USERS.md` ties, tradeoffs).
- **Then:** System diagram → three-part mental model → security rules → Context Service + verification → eval/observability → **DigitalOcean deployment** → cost/milestones/traceability.
- **Governing inputs:** [`AUDIT.md`](../../../AUDIT.md), [`USERS.md`](../../../USERS.md). Audit links are inline in `ARCHITECTURE.md` where a finding drives a choice.
- **Detailed implementation** (full tool list, long compose YAML, pseudocode) may live in code + future ADRs; this file stays the **instructor-grade** map.

---

## 2. Load-bearing decisions (durable)

| Area | Decision |
| --- | --- |
| **Host** | DigitalOcean Droplet; Ubuntu; Docker Compose; Caddy TLS |
| **Panel** | React (+ TS), iframe inside OpenEMR via custom module |
| **Agent API** | Node 20; TypeScript; Vercel AI SDK; Postgres (transcripts, Langfuse DB) |
| **OpenEMR** | Custom module `oe-module-agentforge`; Context Service; write endpoints; GPLv3 |
| **Reads** | Bounded module API + source packs (N+1 / latency cited from audit) |
| **Safety** | Active-chart binding; verification before UI; no admin/super co-pilot |
| **Models** | BAA-class LLM + STT; egress allowlist; keys not in browser |
| **Observability** | Self-hosted Langfuse on same stack |
| **Eval** | Synthea + hand-curated fixtures; deterministic checks |

---

## 3. Hard-gate checklist (case study alignment)

- [x] `ARCHITECTURE.md` opens with executive summary (~1 page) — key decisions, considerations, tradeoffs.
- [x] Framework / verification / observability / eval called out with audit citations where load-bearing.
- [x] Traceability: capabilities ↔ UC-A / UC-B / UC-C.
- [x] Cost scale notes (100 → 100K) at high level.
- [x] Deployment concrete: DigitalOcean + Compose + firewall posture.

---

## 4. Open threads (Early Submission onward)

- Per-source caching after measured UC-A latency ([`Performance-5`](../../../AUDIT.md#performance-5-caching-and-observability-can-improve-latency-but-are-phi-sensitive-and-invalidation-heavy)).
- Voice vs click confirm UX.
- Token/cost numbers refreshed from real traces.
- FHIR-facing facade if agent is extracted from the fork.

---

## Links

- Hard-gate deliverable: [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)
- [`USERS.md`](../../../USERS.md) · [`AUDIT.md`](../../../AUDIT.md) · [Stage 2](05-stage2-deployment-decision.md) · [Presearch](03-presearch-checklist.md) · [`journal/`](journal/)
