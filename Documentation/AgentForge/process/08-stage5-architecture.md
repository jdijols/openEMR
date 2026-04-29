# Stage 5 — architecture / AI integration plan (process pointer)

**Purpose:** Index entry for the **Gauntlet AgentForge Stage 5 hard-gate deliverable** at [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) (repo root). Stage 5 is the **forward-looking AI integration plan**: where the agent lives, how it accesses patient data, authorization boundaries, risks, and mitigations. The case study asks for a ~1-page **executive summary** of high-level architecture; the current `ARCHITECTURE.md` pairs that with a **“For instructors”** decision table and a shorter body so the doc stays readable.

**Status:** **Linux VPS** (Gauntlet MVP on **Vultr**) + **Docker Compose** ([Stage 2 VPS decision](05-stage2-deployment-decision.md), [live deploy notes](09-vps-live-deployment.md)); **React CUI** (Vite + TypeScript) as a toggleable right-rail iframe inside OpenEMR; **Node + Vercel AI SDK** for `agentforge-api`; **Deepgram** default / **AssemblyAI** acceptable for physician-only streaming STT; bounded **Agent Context Service** in `oe-module-agentforge`; source-pack verification, limited citation navigation, self-hosted **Langfuse**, and milestone-scoped MVP/Final delivery clarified.

---

## 1. How to read `ARCHITECTURE.md`

- **Start here for grading / defense:** **For instructors** table + **Executive summary** (audit + `USERS.md` ties, tradeoffs).
- **Then:** System diagram → three-part mental model → PHP/Node integration seams → Host UX integration → security rules → Context Service + verification → eval/observability → **VPS deployment** → cost/milestones/traceability.
- **Governing inputs:** [`AUDIT.md`](../../../AUDIT.md), [`USERS.md`](../../../USERS.md). Audit links are inline in `ARCHITECTURE.md` where a finding drives a choice.
- **Detailed implementation** (full tool list, long compose YAML, pseudocode) may live in code + future ADRs; this file stays the **instructor-grade** map.

---

## 2. Load-bearing decisions (durable)

| Area | Decision |
| --- | --- |
| **Host** | Linux VPS (e.g. **Vultr**); Ubuntu; Docker Compose; Caddy TLS |
| **CUI** | React (+ TS), iframe inside OpenEMR via custom module; header icon toggles a right rail |
| **Agent API** | Node 20; TypeScript; Vercel AI SDK; Postgres (transcripts, Langfuse DB) |
| **OpenEMR** | Custom module `oe-module-agentforge`; Context Service; write endpoints; GPLv3 |
| **Reads** | Bounded module API + source packs (N+1 / latency cited from audit) |
| **Visit capture** | Physician-only streaming STT; tap start/stop or hold-to-talk; no retained audio |
| **Safety** | Active-chart binding; verification before UI; source-pack citations; limited citation navigation; `admin/super` access is an accepted demo risk |
| **Models** | BAA-class LLM + STT; egress allowlist; keys not in browser; Deepgram default / AssemblyAI acceptable for STT |
| **Observability** | Self-hosted Langfuse on same stack; `agentforge-api` emits traces to Langfuse |
| **Eval** | Synthea + hand-curated fixtures; deterministic checks |

---

## 3. Hard-gate checklist (case study alignment)

- [x] `ARCHITECTURE.md` opens with executive summary (~1 page) — key decisions, considerations, tradeoffs.
- [x] Framework / verification / observability / eval called out with audit citations where load-bearing.
- [x] Traceability: capabilities ↔ UC-A / UC-B / UC-C.
- [x] Cost scale notes (100 → 100K) at high level.
- [x] Deployment concrete: **Linux VPS** + Compose + firewall posture (see [09](09-vps-live-deployment.md)).
- [x] Diagram coherence pass: browser shell vs CUI iframe, Caddy routing, `agentforge-api` → Langfuse traces, STT provider egress, and citation navigation now match the written architecture.

---

## 4. Open threads (Early Submission onward)

- Per-source caching after measured UC-A latency ([`Performance-5`](../../../AUDIT.md#performance-5-caching-and-observability-can-improve-latency-but-are-phi-sensitive-and-invalidation-heavy)).
- Implement first one or two citation-navigation surfaces from source-pack metadata, then expand after the MVP path is proven.
- Patient-switch behavior for the CUI thread: default reset for active-chart binding, revisit if clinicians need cross-chart continuity.
- Confirmation UX details for proposed writes.
- Token/cost numbers refreshed from real traces.
- FHIR-facing facade if agent is extracted from the fork.

---

## 5. Architecture refinement journal

- 2026-04-28 — [`journal/week-1/0428-T2331-architecture-loom-polish.md`](journal/week-1/0428-T2331-architecture-loom-polish.md): Loom-focused pass over the instructor table, CUI right rail, visit capture, citation navigation, Langfuse/Deepgram diagram flow, and MVP vs target V1 scope.

---

## Links

- Hard-gate deliverable: [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)
- [`USERS.md`](../../../USERS.md) · [`AUDIT.md`](../../../AUDIT.md) · [Stage 2](05-stage2-deployment-decision.md) · [VPS live](09-vps-live-deployment.md) · [Presearch](03-presearch-checklist.md) · [`journal/`](journal/)
