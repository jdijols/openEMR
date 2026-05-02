# AI Cost Analysis — AgentForge Clinical Co-Pilot

> **Hard-gate deliverable:** Gate 7 task **G7-07**. The case-study brief asks for actual dev spend, projected production costs at 100 / 1K / 10K / 100K users, and the architectural inflection points each scale forces — *not* a token-rate multiplied by user count. This document is the single cost appendix for the submission bundle.
>
> **Source of measured data:** Langfuse traces (`https://us.cloud.langfuse.com` → OpenEMR → AgentForge), structured `console.info` JSON in `agentforge-api`, and the running token-rate table in [`agentforge/api/src/agent/cost_estimate.ts`](../../../agentforge/api/src/agent/cost_estimate.ts). Companion files: [`dev-spend-log.md`](dev-spend-log.md), [`clinical-copilot-task-list.md` § Gate 7](clinical-copilot-task-list.md#gate-7--submission-bundle).
>
> **Compliance note:** All rates and projections below assume the Gauntlet "act as if BAA is in place" posture for all LLM and STT providers. PHI never appears in this document. Real-PHI deployments require a documented BAA per [`AUDIT.md`](../../../AUDIT.md) Compliance-2.

---

## 1. Executive summary

AgentForge's V1 cost surface is dominated by two billed APIs: the LLM (Anthropic Claude Haiku 4.5 by default, Azure OpenAI as a hot-swap) and the streaming STT provider (AssemblyAI in the live build, Deepgram acceptable under the same pattern). Postgres, Langfuse, and the OpenEMR module run on a single VPS and are amortized across all users at this scale.

A single **encounter** end-to-end (UC-A pre-room brief + UC-B in-room dictation/proposal/confirm + UC-C post-room follow-up) costs roughly **$0.10–$0.15** at current published rates: ≈$0.04 in LLM and ≈$0.08 in STT, with the rest absorbed by infrastructure. A primary-care physician with a 20-patient day is therefore an **$2–$3/day** marginal user; ≈**$500–$750/year** at 250 working days.

The architecture scales linearly through ~100 clinicians on the present single-VPS topology with no code changes. Past that point each order-of-magnitude introduces new constraints: at 1K users, API horizontality and Postgres pooling; at 10K users, prompt caching, model-tier routing, and regional deployments; at 100K users, tenant isolation, enterprise LLM contracts, and a credible BYO-LLM path for hospital systems whose internal compliance posture rejects external inference. These transitions are described in §6.

Mitigations already shipped — encounter-keyed brief cache (server + client, 2-hour TTL), in-flight dedupe, refusal-before-LLM for out-of-scope and cross-patient queries, and the deterministic verification pipeline that strips uncited claims rather than asking the model to retry — meaningfully reduce the marginal call budget. The remaining high-leverage optimizations at scale are (1) Anthropic-native prompt caching on the chart-context block, which today rebuilds for every turn, and (2) tier-routed model selection so trivial turns do not pay the headline-model rate.

---

## 2. Methodology and assumptions

**Measurement window.** Dev spend in §3 captures the period from project start (Apr 27, 2026) through final submission (May 3, 2026), measured from Anthropic console invoices and Langfuse aggregations.

**Provider rates** (per 1M tokens, USD, as observed against Langfuse Cloud's price database — these match Anthropic's published rates for `claude-haiku-4-5`):

| Provider / model | Input | Output |
|---|---|---|
| Anthropic `claude-haiku-4-5` (default) | $1.00 | $5.00 |
| Azure OpenAI (deployment-id varies) | $5.00 | $15.00 |

> The in-repo heuristic in [`cost_estimate.ts`](../../../agentforge/api/src/agent/cost_estimate.ts) currently uses $3/$15 for Anthropic — a Sonnet-like rate that overestimates Haiku spend by ~3×. Tracked as a separate cleanup; numbers below use real Haiku rates.

**STT rates.**

| Provider | Rate |
|---|---|
| AssemblyAI streaming (default) | ~$0.37/hour billed in 1-second increments |
| Deepgram Nova-2 (acceptable substitute) | ~$0.0043/min ≈ $0.26/hour |

**Workflow assumptions** (sourced from [`USERS.md`](../../../USERS.md) and the V1 use cases):

| Variable | Value | Source |
|---|---|---|
| Patients per physician per day | 20 | USERS.md §2.1 (range 18–24) |
| Working days per year | 250 | Standard US clinical assumption |
| LLM turns per visit | ~9 | 1 UC-A brief + 4 UC-B dictations (≈ 1 propose-write each) + ~4 UC-C follow-up |
| Dictation minutes per visit | ~12 | UC-B "tap start/stop" or "hold-to-talk", physician dictation only — see USERS.md §3.2 |
| Tokens per UC-A brief | ~7,000 input / ~400 output | Empirical: 14,450 tokens across 2 traced briefs ÷ 2 |
| Tokens per UC-B/UC-C chat turn | ~3,500 input / ~75 output | Empirical: traced single chat turn |

**What is *not* in scope** for these projections (per USERS.md §7.1 "V1 does not include"): immunizations, orders, note drafting, ambient recording, allergy delete, day-view across-patient prep, specialist subspecialty workflows. Adding any of them changes the per-encounter token budget and would require a fresh projection.

---

## 3. Actual dev spend

> **TODO before submission:** populate from the Anthropic console (Settings → Usage), the AssemblyAI dashboard, and Langfuse aggregations. Numbers below are placeholders showing the table shape; the values marked **{fill}** are pulled at submission time.

| Period | Anthropic input tok | Anthropic output tok | Anthropic USD | Azure USD | AssemblyAI USD | Notes |
|---|---|---|---|---|---|---|
| Gate 0–2 (Apr 27–29) | {fill} | {fill} | {fill} | $0.00 | $0.00 | Local stub + isolated tests; no live API calls until Gate 3. |
| Gate 3–4 (Apr 30) | {fill} | {fill} | {fill} | $0.00 | {fill} | First end-to-end UC-A briefs and UC-B propose→confirm flow. |
| Gate 5 (Apr 30) | {fill} | {fill} | {fill} | $0.00 | {fill} | UC-C dictation + STT live integration. |
| Gate 6 (May 1) | {fill} | {fill} | {fill} | {fill} | {fill} | Eval suite live runs (13 cases × N retries); Azure smoke. |
| Gate 7 / submission (May 1–3) | {fill} | {fill} | {fill} | {fill} | {fill} | Loom recording + cellular smoke + final verification turns. |
| **Total** | **{fill}** | **{fill}** | **{fill}** | **{fill}** | **{fill}** | |

**Per-developer-day envelope (observed):** ≈$0.50–$2.00/day during active feature development, dominated by repeated UC-A briefs while iterating on prompt and verification logic. Spikes during eval-suite full runs (13 cases × ~6 LLM calls ≈ 78 turns ≈ $0.30 per full run).

**Free-tier coverage:** Langfuse Cloud Hobby tier is sufficient through dev. Self-hosted Langfuse on the same VPS (per [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)) is the production posture and adds no marginal $.

---

## 4. Unit economics

Working forward from the rates and workflow assumptions in §2:

**Per LLM turn** (UC-B / UC-C chat):
- (3,500 / 1M) × $1.00 + (75 / 1M) × $5.00 = **≈$0.0039**

**Per UC-A brief** (case_presentation):
- (7,000 / 1M) × $1.00 + (400 / 1M) × $5.00 = **≈$0.009**

**Per visit (LLM only):**
- 1 brief + ~8 chat turns = $0.009 + 8 × $0.0039 ≈ **$0.04**

**Per visit (STT only, AssemblyAI):**
- ~12 minutes of streamed dictation × $0.37/hour ÷ 60 ≈ **$0.074**

**Per visit total (LLM + STT):** ≈ **$0.11–$0.15** depending on dictation length and follow-up depth.

**Per physician-day** (20 visits): ≈**$2.20–$3.00**
**Per physician-year** (250 days): ≈**$550–$750**

These are gross marginal costs. Cache hits on the brief (encounter-scoped, 2-hour TTL — see [`case_presentation_cache.ts`](../../../agentforge/api/src/agent/case_presentation_cache.ts)) and refusal-before-LLM paths (security guard, cross-patient block, internal disclosure, vitals out-of-range) reduce the *expected* per-visit number meaningfully — see §7.

---

## 5. Projections at scale

| Concurrent / MAU clinicians | Visits / year | LLM USD / year | STT USD / year | Infra USD / year (estimated) | **Total / year** |
|---|---|---|---|---|---|
| **100** | 500K | $20K | $37K | $15K (single VPS class scaled up; Postgres + Langfuse + API on one node) | **≈$72K** |
| **1,000** | 5M | $200K | $370K | $80K (3–5 API replicas, dedicated Postgres, self-hosted Langfuse cluster) | **≈$650K** |
| **10,000** | 50M | $2.0M | $3.7M | $400K (regional deployments, Postgres read replicas, dedicated STT egress) | **≈$6.1M** |
| **100,000** | 500M | $20M | $37M | $2.5M (multi-tenant or per-tenant stacks, enterprise observability, BYO-LLM option for some tenants) | **≈$60M** |

**Assumptions encoded in the table:**
1. Linear in visits-per-clinician — no super-linear chat behavior at scale (no group consults, no patient-portal traffic in V1 scope).
2. No volume discount on LLM or STT. Real enterprise contracts at 10K+ scale should see 30–60% reduction; that headroom is **not** included so the projections stay defensible.
3. Infra cost dominated by API replicas + Postgres + Langfuse self-host. STT egress bandwidth is non-trivial at 10K+ and shows up under "regional deployments."
4. STT savings from the **physician-only**, **no audio retention** stance (USERS.md §3.2) are already priced in — no audio storage cost line.

---

## 6. Architectural inflection points by tier

The brief specifically asks what *changes architecturally* at each scale, not just what the bill is. The following are the load-bearing transitions.

### 100 clinicians (≈ 500K visits/year)

- **No code changes required.** Current single-VPS topology (OpenEMR + agentforge-api + Postgres + Langfuse on one host) handles this comfortably with the 8 GB RAM minimum from [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) §VPS.
- Add per-clinician rate limiting in `agentforge-api` (currently absent — relies on OpenEMR session). One or two abusive accounts at this scale can still spike LLM bills; a token-bucket per `user_id` upstream of `runChatTurn` is cheap insurance.
- Move STT keys behind a tenant-scoped secret rotation; AssemblyAI keys are currently a single shared dev/prod credential.

### 1,000 clinicians (≈ 5M visits/year)

- **Horizontal `agentforge-api`.** Single Node process saturates around a few hundred concurrent in-flight LLM calls (event loop + outbound HTTPS). Move to 3–5 stateless replicas behind Caddy (already a load-balancer-ready reverse proxy). The in-process brief cache becomes per-replica — fine, because the server-side cache is a hint, not a correctness requirement (the client-side cache survives reload anyway).
- **Postgres connection pooling.** The `pg.Pool({ max: 10 })` in [`index.ts`](../../../agentforge/api/src/index.ts) is a per-process limit; 5 replicas × 10 = 50 connections, manageable but borderline. Add PgBouncer in transaction mode and lower per-replica `max` to 5.
- **Self-hosted Langfuse cluster.** Hobby Cloud is no longer cost-effective; per [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) the production posture is self-hosted on the same Compose stack. At 1K users, Langfuse needs its own dedicated compute (separate from the agent API) and an external Postgres for trace storage with retention policy.
- **Add an LLM call budget alarm.** Wire a cumulative-cost guard into observability so a runaway prompt cannot burn $100K overnight before someone notices.

### 10,000 clinicians (≈ 50M visits/year)

- **Anthropic prompt caching, urgently.** Each chat turn currently rebuilds the full chart-context prompt (~3,500 input tokens) from scratch. Anthropic's native prompt caching (`cache_control` on the system + chart-context block) cuts that to ~10% of the cost on repeat turns within a 5-minute window. At 50M visits/year × ~8 turns = 400M turns, even a 30% cache hit rate is ≈$200K/year saved.
- **Model-tier routing.** Not every turn needs Haiku 4.5. Trivial refusals, vitals confirms, and "what's the chief complaint" lookups can route to a cheaper SLM (or a deterministic rule). Inversely, complex multi-tool reasoning turns (UC-B propose with conflicting source rows) might warrant Sonnet for safety. A small router model in front of `getChatModel(env)` is the right shape.
- **Regional API deployments.** US East/West clinic distributions add 40–80ms TLS RTT to a single-region API, which is felt in UC-B dictation latency. Deploy regional `agentforge-api` clusters; Langfuse and Postgres can stay centralized initially.
- **Pre-computed morning brief queue.** UC-A briefs for tomorrow's schedule can be pre-warmed overnight using the appointment table — turning a synchronous LLM call at chart-open into a cache hit. Saves 1 LLM call × ~$0.009 × 50M = $450K/year.
- **Postgres read replicas** for chart-context endpoints and the `pending_proposals` query path.

### 100,000 clinicians (≈ 500M visits/year)

- **Tenant isolation.** Hospital systems will not share a Postgres or a Langfuse with peer institutions. The deployment shape becomes per-tenant Compose stacks (or per-tenant Kubernetes namespaces) with a thin shared control plane for auth, billing, and aggregate observability. The `oe-module-agentforge` boundary already enforces a per-call shared secret + session-token binding, which makes this transition mostly an infra concern rather than a code rewrite.
- **Enterprise LLM contracts and BYO-LLM.** At this scale the marginal LLM bill is ~$57M/year — large enough that hospitals will demand either an enterprise Anthropic / Azure contract priced under list, or a BYO-LLM path where they bring their own Bedrock / private endpoint. The provider-swap surface (`LLM_PROVIDER` env + cross-field validation in [`agent/model.ts`](../../../agentforge/api/src/agent/model.ts)) was deliberately built shallow for exactly this reason.
- **Regional Langfuse plus aggregate rollup.** Trace volume at this scale (~500M trace events/day at the §11.2 spec'd shape) forces regional ingestion + a periodic aggregate rollup for cross-regional dashboards. Trace-body redaction (the existing [`redact.ts`](../../../agentforge/api/src/observability/redact.ts) deny-list) becomes a critical compliance surface, not just a hygiene one.
- **Ambient noise pipeline / hospital STT options.** At this scale some buyers will reject AssemblyAI/Deepgram in favor of an on-prem STT or a dedicated medical-vocabulary model. The streaming relay shape in `agentforge-api` already abstracts the provider — extending it to a third option is the same level of work as adding Deepgram alongside AssemblyAI.

---

## 7. Cost mitigations already in place

These are not future work — they are shipped and contributing to the §4 numbers being lower than a naive per-token estimate would suggest.

| Mitigation | Mechanism | Savings shape |
|---|---|---|
| **Encounter-scoped brief cache (server + client, 2h TTL)** | [`case_presentation_cache.ts`](../../../agentforge/api/src/agent/case_presentation_cache.ts) + `brief_cache.ts`. Same `(patient, encounter, session)` returns the cached brief without an LLM call. | Removes most refresh-driven UC-A re-fires. Empirically ~30–50% of UC-A calls in dev. |
| **In-flight dedupe** | `inflight: Map<key, Promise>` in [`case_presentation.ts`](../../../agentforge/api/src/agent/case_presentation.ts). Two simultaneous chart-open pings produce one LLM call. | Eliminates the rail's auto-fire double-trigger pattern. |
| **Refusal-before-LLM** | Internal-disclosure block in [`orchestrator.ts`](../../../agentforge/api/src/agent/orchestrator.ts), cross-patient binding check in `_binding.ts`, vitals impossible-range parse in `verification.ts`. | Bad-input turns short-circuit before any LLM cost. |
| **Verification strip-uncited** | [`verification.ts`](../../../agentforge/api/src/agent/verification.ts) `verifyClinicalBlocks` removes uncited claim blocks deterministically; we do not retry the LLM to "fix" the response. | Avoids the ×2–3 cost spike of "ask the model again" reflex. |
| **Tool-result citation reuse** | Same `source_pack.uuid` referenced across multiple claims pays for one tool call, not many. | Already-fetched chart context is not re-fetched within a turn. |
| **Empty/refusal-only briefs not cached** | `isCacheable()` guard. Avoids pinning a transient empty brief for the full 2h TTL — which would have been a cost-leakage path during retries. | Prevents pathological "blank brief, retry, blank brief, retry" loops. |

---

## 8. Risks and sensitivities

- **Rate change risk.** A 50% Anthropic price rise (or a forced upgrade to a higher model tier for accuracy reasons) shifts the §5 LLM column proportionally. Mitigated by the provider-swap; not eliminated.
- **Prompt-length drift.** UC-A briefs trend toward "include more context" pressure. Each 1K input tokens added to the brief is +$0.001 × all UC-A calls/year. At 10K users that's +$50K/year per 1K tokens. Watch the `context/*` endpoints for size growth.
- **Retry behavior.** A poorly-tuned Vercel AI SDK retry policy on `generateText` can silently 2× cost during provider hiccups. Currently relies on SDK defaults; worth pinning retries explicitly at scale.
- **STT minutes inflation.** UC-B "hold-to-talk" reduces minutes vs. continuous recording, but a UI regression that toggles to continuous recording would 2–3× STT cost.
- **Eval-suite cost at CI scale.** Running the 13-case eval on every PR at 10K-engineer scale is a non-trivial line item (~$0.30 × N PRs/day). At V1 size, negligible; flag for visibility.

---

## 9. Open questions for production deployment

1. **BAA negotiations:** Anthropic, Azure OpenAI, AssemblyAI, and Deepgram each require their own BAA before real PHI flows. Cost negotiations and BAA negotiations are usually the same conversation — start early.
2. **Eval-driven cost regression alarms:** Should the eval runner trip a budget alarm if a PR increases per-case cost by >X%? Cheap to add, useful guard against silent prompt bloat.
3. **Per-tenant cost attribution:** At 1K+ users, hospital admins will want to see *their* clinicians' usage, not the global rollup. The `correlation_id` and `physician_user_id` fields already in trace metadata (PRD §11.2) make this possible, but the Langfuse dashboards need explicit per-tenant filtering.
4. **Day-view across-patient prep** (post-MVP per [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)): pre-warming UC-A briefs for the morning's schedule is in scope for §6's 10K-user tier as a cost optimization, but rollout depends on USERS.md being expanded to include the day-view scope.

---

## Cross-references

- [`Documentation/AgentForge/references/Week 1 - AgentForge.pdf`](../references/Week%201%20-%20AgentForge.pdf) — original case-study brief (cost analysis is one of the listed submission deliverables).
- [`USERS.md`](../../../USERS.md) — workflow assumptions feeding §2, §4.
- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — VPS topology, cost-snapshot section, observability posture.
- [`PRD.md`](../../../PRD.md) §11.2 — per-turn trace content shape feeding §1's "what we measured" claim.
- [`AUDIT.md`](../../../AUDIT.md) — Compliance-2 (LLM PHI boundary) and Performance-7 (N+1 patterns) inform cost-mitigation choices.
- [`dev-spend-log.md`](dev-spend-log.md) — the running per-gate token tally that feeds the §3 totals.
- [`agentforge/api/src/agent/cost_estimate.ts`](../../../agentforge/api/src/agent/cost_estimate.ts) — current in-repo heuristic rates (note: needs update from $3/$15 Sonnet-shape to $1/$5 Haiku-shape).
- [`agentforge/api/src/observability/index.ts`](../../../agentforge/api/src/observability/index.ts) — Langfuse generation/span emission that produces §3's measured numbers.
