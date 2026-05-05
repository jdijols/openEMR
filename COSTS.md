# Clinical Copilot — Cost Analysis

> Built on OpenEMR. Developed during the Gauntlet AI AgentForge program. Submission Requirements row 7 ("AI Cost Analysis") deliverable.
>
> **Source of measured data:** Anthropic API console (`openEMR` API key, Apr 27 – May 3 2026), Langfuse traces (`https://us.cloud.langfuse.com` → OpenEMR → AgentForge), AssemblyAI dashboard, Vultr billing portal, Cursor + Claude.ai subscription dashboards. Companion files: [Documentation/AgentForge/implementation/dev-spend-log.md](Documentation/AgentForge/implementation/dev-spend-log.md), [TASKS.md § Gate 7](TASKS.md#gate-7--submission-bundle).
>
> **Compliance note:** All rates and projections below assume the Gauntlet "act as if BAA is in place" posture for all LLM and STT providers. PHI never appears in this document. Real-PHI deployments require a documented BAA per [AUDIT.md Compliance-2](AUDIT.md).

---

## 1. Executive summary

The Clinical Copilot's cost surface separates cleanly into two questions: **what did it cost to build**, and **what would it cost to run at scale**. The two answers diverge by roughly seven orders of magnitude — small enough that one developer with a $200 Cursor plan and a $200 Claude.ai plan built the whole thing, large enough that a 100,000-clinician deployment is a $60M/year line item — which is the exact spread the case-study brief asks the deliverable to defend.

**Build cost (Apr 27 – May 3, 2026):** the agent's runtime LLM spend totaled **$3.34** (Anthropic Claude Haiku 4.5, billed against the `openEMR` API key). AssemblyAI streaming STT consumed zero billable hours — the free-tier allowance covered all dictation testing. The Vultr VPS hosting OpenEMR + agentforge-api + Postgres + Langfuse charged less than **$15** for the week. Developer-side AI assistance (Cursor Ultra and Claude.ai Max 20x) added a flat ~$200 each as monthly subscriptions; prorated to the AgentForge project window the attributable portion is roughly **$240**, paid as flat subscriptions whether used or not. Total build cost ≈ **$258**, of which only $3.34 is variable per-LLM-call and would scale with users.

**Per-encounter unit economics:** a single physician–patient encounter end-to-end (UC-A pre-room brief + UC-B in-room dictation/proposal/confirm + UC-C post-room follow-up) costs roughly **$0.10–$0.15** at current published rates: ≈$0.04 in LLM calls and ≈$0.08 in STT, with the rest absorbed by infrastructure. A primary-care physician with a 20-patient day is a **$2–$3/day** marginal user; ≈**$500–$750/year** at 250 working days.

**Scale projections.** Cost is dominated by LLM and STT, both of which scale linearly with visit count. Infrastructure and observability scale super-linearly only at the top tier where tenant isolation forces per-tenant compute. Headline annual figures, no-volume-discount, no-prompt-caching:

| Tier | Visits / year | LLM | STT | Infra + observability | **Total / year** |
|---|---|---|---|---|---|
| **100 clinicians** | 500K | $20K | $37K | $15K | **≈$72K** |
| **1,000** | 5M | $200K | $370K | $80K | **≈$650K** |
| **10,000** | 50M | $2.0M | $3.7M | $400K | **≈$6.1M** |
| **100,000** | 500M | $20M | $37M | $2.5M | **≈$60M** |

**The architectural inflection points are not what the bill is, but what changes shape between tiers.** At 100 clinicians the present single-VPS topology runs unchanged. At 1K, `agentforge-api` goes horizontal behind Caddy and Postgres needs a real connection pooler. At 10K, Anthropic prompt caching becomes a $200K/year line item, model-tier routing diverts trivial turns away from Haiku, and US East/West regional deployments matter for dictation latency. At 100K, hospital systems demand tenant isolation, enterprise LLM contracts priced under list, and a credible BYO-LLM path for compliance teams that reject external inference. These are described in §6.

Mitigations already shipped — encounter-keyed brief cache (server + client, 2-hour TTL), in-flight dedupe, refusal-before-LLM for cross-patient and out-of-scope queries, deterministic verification that strips uncited claims rather than retrying the model — meaningfully reduce the marginal per-turn budget. The remaining high-leverage optimizations at scale are (1) Anthropic-native prompt caching on the chart-context block (which today rebuilds for every turn), and (2) tier-routed model selection so trivial turns do not pay headline-model rates. Both are V2 work, not blockers.

The full §3 spend reconciliation, §4 unit economics, §5 scaled projections with public-rate citations, §6 architectural-change paragraphs per tier, and §7 mitigations follow.

---

## 2. Methodology and assumptions

**Measurement window.** Dev spend in §3 captures the period from project start (**Apr 27, 2026**) through final submission (**May 3, 2026**) — seven calendar days. LLM spend is measured from the Anthropic API console "Cost" view filtered by the `openEMR` API key, which the agent uses exclusively. STT, hosting, and tooling are measured from each provider's dashboard or billing portal.

**Provider rates** (per 1M tokens, USD, as observed against Langfuse Cloud's price database — these match Anthropic's published rates for `claude-haiku-4-5`):

| Provider / model | Input | Output |
|---|---|---|
| Anthropic `claude-haiku-4-5` (default) | $1.00 | $5.00 |
| Azure OpenAI (deployment-id varies; conservative GPT-4-class default) | $5.00 | $15.00 |

> The in-repo heuristic in [agentforge/api/src/agent/cost_estimate.ts](agentforge/api/src/agent/cost_estimate.ts) uses **$1 / $5 per Mtok input/output for `anthropic`** (matches `claude-haiku-4-5` published rates) and **$5 / $15 for Azure OpenAI** (conservative GPT-4-class default until a per-deployment table is added). Structured-log `cost_usd` values align with these rates. Langfuse Cloud's price database remains the authoritative invoicing-grade number per [OBSERVABILITY.md](OBSERVABILITY.md) §Q4.

**STT rates** (public list prices, no negotiated tier):

| Provider | Rate | Source |
|---|---|---|
| AssemblyAI streaming (default) | ~$0.37/hour, billed in 1-second increments | [assemblyai.com/pricing](https://www.assemblyai.com/pricing) |
| Deepgram Nova-2 (acceptable substitute) | ~$0.0043/min ≈ $0.26/hour | [deepgram.com/pricing](https://deepgram.com/pricing) |

**Hosting and observability rates** (public list prices):

| Component | Rate | Source |
|---|---|---|
| Vultr High Frequency 4 vCPU / 16 GB RAM / 256 GB NVMe | ~$48/month | [vultr.com/pricing](https://www.vultr.com/pricing/) |
| Vultr Optimized Cloud Compute 8 vCPU / 32 GB | ~$192/month | same |
| Langfuse Cloud Hobby | $0/month | [langfuse.com/pricing](https://langfuse.com/pricing) |
| Langfuse Cloud Core | $59/month + ingestion overage | same |
| Langfuse Cloud Pro | $399/month + ingestion overage | same |
| Langfuse self-hosted | $0 license; pay your own VPS | same |

**Workflow assumptions** (sourced from [USERS.md](USERS.md) §2.1 and the V1 use cases in §4):

| Variable | Value | Source |
|---|---|---|
| Patients per physician per day | 20 | USERS.md §2.1 (range 18–24) |
| Working days per year | 250 | Standard US clinical assumption |
| LLM turns per visit | ~9 | 1 UC-A brief + 4 UC-B dictations (≈ 1 propose-write each) + ~4 UC-C follow-up |
| Dictation minutes per visit | ~12 | UC-B "tap start/stop" or "hold-to-talk", physician dictation only — see [USERS.md §3.2](USERS.md) |
| Tokens per UC-A brief | ~7,000 input / ~400 output | Empirical: 14,450 tokens across 2 traced briefs ÷ 2 |
| Tokens per UC-B/UC-C chat turn | ~3,500 input / ~75 output | Empirical: traced single chat turn |

**Out of scope for these projections** (per [USERS.md §7.1 "V1 does not include"](USERS.md)): immunizations, orders, note drafting, ambient recording, allergy delete, day-view across-patient prep, specialist subspecialty workflows. Adding any of them changes the per-encounter token budget and would require a fresh projection.

**What this document does not claim:**
- Numbers are list-rate estimates without volume discounts or BAA-tier pricing — real enterprise contracts at 10K+ scale should see 30–60% reductions, not included here so projections stay defensible.
- Anthropic prompt caching is *not* applied to projections in §5; it is treated as a §7 mitigation candidate, not a baseline assumption.
- "Storage at rest" for transcripts and traces is sized by retention windows the V1 deploy has not yet operationalized in production; sized rough at the 10K+ tier and ignored at 100/1K.

---

## 3. Actual dev spend

### 3.1 Agent runtime LLM (Anthropic API)

**Total: $3.34** (Apr 27 – May 3, 2026; Anthropic console "Cost" view, `openEMR` API key, Claude Haiku 4.5 only).

| Date | Cost | Phase |
|---|---|---|
| Apr 27 | ~$0.00 | Gate 0 — scaffolding, no LLM calls |
| Apr 28 | ~$0.00 | Gate 1 — security primitives, no LLM calls |
| Apr 29 | ~$0.60 | Gate 2 — first vertical slice, end-to-end UC-A briefs, allergy Q&A |
| Apr 30 | ~$0.00 | Gate 3 (read completeness) — auto-fired briefs, citation enforcement |
| May 01 | ~$1.25 | Gate 4 (UC-B writes) + Gate 5 (STT + UC-C) + Gate 6 deploy — peak development day |
| May 02 | ~$1.25 | Gate 6 (eval + observability) + Langfuse cloud wiring + prod redeploy |
| May 03 | ~$0.30 | Gate 7 — submission verification, demo rehearsal, final smokes |
| **Total** | **$3.34** | |

**Implied turn count:** at a blended ~$0.006/turn (mix of UC-A briefs at $0.009 and chat turns at $0.0039), $3.34 ≈ **~550 LLM turns** across the dev window. That tracks: ~80 turns/day during active feature development, peaking at ~200/day during Gate 5 dictation testing.

**Per-developer-day:** ≈$0.50/day median, $1.25/day peak. Lower than the original envelope ($0.50–$2.00/day) because the cache hit rate during prompt iteration is higher than worst-case modeling assumed.

### 3.2 Agent runtime STT (AssemblyAI)

**Total: $0.00.** AssemblyAI's free tier covers ~3 hours of streaming per month at the development account's plan. UC-B and UC-C dictation testing across the week consumed less than the free-tier allowance. The streaming relay itself in [agentforge/api/src/stt/](agentforge/api/src/stt/) was tested against actual AssemblyAI streaming, not a mock — but volume stayed under the threshold that triggers billing.

**At production scale this changes immediately;** see §5.

### 3.3 Hosting (Vultr VPS)

**Total: <$15.** The single Vultr VPS (running OpenEMR + MariaDB + agentforge-api + Postgres + Langfuse self-hosted via Docker Compose) was provisioned during Gate 6 deployment (per [Documentation/AgentForge/process/milestones/week-1/09-vps-live-deployment.md](Documentation/AgentForge/process/milestones/week-1/09-vps-live-deployment.md)). One week prorated against a ~$48/month High Frequency 4 vCPU / 16 GB instance ≈ $11–14, consistent with the user-reported balance.

### 3.4 Observability (Langfuse Cloud Hobby)

**Total: $0.00.** Langfuse Cloud's Hobby tier was used during dev; usage stayed well under the free trace-event allowance. Self-hosted Langfuse is the production posture per [ARCHITECTURE.md](ARCHITECTURE.md) §Observability and would replace the cloud account at any tier above Hobby.

### 3.5 Developer-side AI assistance (Cursor + Claude.ai)

These are flat-rate developer tools used to *build* AgentForge, not part of the agent's runtime. They count as build cost but do not scale with users — production-deployment cost projections in §5 explicitly exclude them.

| Tool | Subscription | Utilization (May cycle) | Attribution rationale | Attributable cost |
|---|---|---|---|---|
| **Cursor Ultra** | $200/month flat | 43% of monthly plan consumed (74% of $400 API allowance ≈ $296 retail value) | AgentForge has been the user's primary work this past week per project timeline | ~$190 (utilization-weighted) |
| **Claude.ai Max 20x** | $200/month flat | 16% of weekly all-models limit used | One week of subscription window devoted to AgentForge documentation, code review, planning | ~$50 (1 of 4 weeks prorated) |

**Combined developer-side AI: ~$240 attributable** to AgentForge project work, paid as flat subscriptions. The marginal cost of *using* these tools more this past week was zero — they are sunk subscription costs, and the utilization figure is provided for transparency rather than as an incremental bill.

### 3.6 Total dev spend

| Stream | Cost | Notes |
|---|---|---|
| Agent runtime LLM (Anthropic) | $3.34 | Variable; scales with users |
| Agent runtime STT (AssemblyAI) | $0.00 | Free tier; first variable cost at production scale |
| Hosting (Vultr) | <$15 | Roughly flat at this size; scales with infra tier |
| Observability (Langfuse Cloud Hobby) | $0.00 | Free tier; replaced by self-hosted at production |
| Developer AI assistance (Cursor + Claude.ai) | ~$240 | Flat subscriptions; does not scale with users |
| **Total** | **≈$258** | Of which **$3.34 is variable** with usage |

**The honest read:** ~99% of the build budget went to developer-side AI assistance subscriptions, which the user pays whether or not they touch this project. The actual marginal cost to run the agent for a week of intensive testing was **$3.34 in LLM calls, $0 in STT, ~$13 in hosting**. That's the number to bring to the AI Interview when asked "what did this cost to build."

---

## 4. Unit economics

Working forward from the §2 rates and workflow assumptions:

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

These are gross marginal costs. Cache hits on the brief (encounter-scoped, 2-hour TTL — see [agentforge/api/src/agent/case_presentation_cache.ts](agentforge/api/src/agent/case_presentation_cache.ts)) and refusal-before-LLM paths (security guard, cross-patient block, internal-disclosure refusal, vitals out-of-range) reduce the *expected* per-visit number meaningfully — see §7.

**Sensitivity:** the per-visit number is most sensitive to **dictation minutes** (STT is ~70% of the cost) and **brief cache hit rate** (a missed cache doubles the LLM portion of a visit). A 50% increase in dictation length pushes per-visit to ~$0.18; a 50% drop in brief cache hits lifts it to ~$0.13.

---

## 5. Projections at scale

**Headline table** (no volume discount, no prompt caching, list rates only):

| Concurrent / MAU clinicians | Visits / year | LLM USD / year | STT USD / year | Infra USD / year (estimated) | **Total / year** |
|---|---|---|---|---|---|
| **100** | 500K | $20K | $37K | $15K (single VPS class scaled up; Postgres + Langfuse + API on one node) | **≈$72K** |
| **1,000** | 5M | $200K | $370K | $80K (3–5 API replicas, dedicated Postgres, self-hosted Langfuse cluster) | **≈$650K** |
| **10,000** | 50M | $2.0M | $3.7M | $400K (regional deployments, Postgres read replicas, dedicated STT egress) | **≈$6.1M** |
| **100,000** | 500M | $20M | $37M | $2.5M (multi-tenant or per-tenant stacks, enterprise observability, BYO-LLM option for some tenants) | **≈$60M** |

**Per-clinician annual cost** ($/clinician/year): $720 at 100, $650 at 1K, $610 at 10K, $600 at 100K. Modest sub-linear improvement comes from amortizing infra across more users; LLM and STT remain linear in visits.

**Assumptions encoded in the table:**
1. **Linear in visits-per-clinician** — no super-linear chat behavior at scale (no group consults, no patient-portal traffic in V1 scope per [USERS.md §7](USERS.md)).
2. **No volume discount** on LLM or STT. Real enterprise contracts at 10K+ scale should see 30–60% reduction; that headroom is **not** included so the projections stay defensible.
3. **No prompt caching** — Anthropic native cache control could cut LLM column 30–50% at 10K+ scale (see §7). Treated as upside, not baseline.
4. **Infra cost dominated by API replicas + Postgres + Langfuse self-host.** STT egress bandwidth becomes non-trivial at 10K+ and shows up under "regional deployments."
5. **STT savings from the physician-only, no-audio-retention stance** ([USERS.md §3.2](USERS.md)) are already priced in — no audio storage cost line.
6. **Tooling/dev-assistance costs (Cursor + Claude.ai) are not in the projection** — those are a build-time line item that does not scale with deployed users.

**What changes between tiers** is described in §6.

---

## 6. Architectural inflection points by tier

The brief specifically asks what *changes architecturally* at each scale, not just what the bill is. The following are the load-bearing transitions.

### 100 clinicians (≈ 500K visits/year)

- **No code changes required.** Current single-VPS topology (OpenEMR + agentforge-api + Postgres + Langfuse on one host) handles this comfortably with the 8 GB RAM minimum from [ARCHITECTURE.md](ARCHITECTURE.md) §VPS deployment.
- **Add per-clinician rate limiting** in `agentforge-api` (currently absent — relies on OpenEMR session). One or two abusive accounts at this scale can still spike LLM bills; a token-bucket per `user_id` upstream of `runChatTurn` is cheap insurance.
- **Move STT keys behind tenant-scoped secret rotation;** AssemblyAI keys are currently a single shared dev/prod credential.
- **VPS class:** scale up to a Vultr Optimized Cloud Compute 8 vCPU / 32 GB ($192/month) or equivalent — handles 100 concurrent clinicians × ~10 in-flight LLM/STT calls comfortably with headroom for spikes.

### 1,000 clinicians (≈ 5M visits/year)

- **Horizontal `agentforge-api`.** Single Node process saturates around a few hundred concurrent in-flight LLM calls (event loop + outbound HTTPS). Move to 3–5 stateless replicas behind Caddy (already a load-balancer-ready reverse proxy). The in-process brief cache becomes per-replica — fine, because the server-side cache is a hint, not a correctness requirement (the client-side cache survives reload anyway).
- **Postgres connection pooling.** The `pg.Pool({ max: 10 })` in [agentforge/api/src/index.ts](agentforge/api/src/index.ts) is a per-process limit; 5 replicas × 10 = 50 connections, manageable but borderline. Add PgBouncer in transaction mode and lower per-replica `max` to 5.
- **Self-hosted Langfuse cluster.** Hobby Cloud is no longer cost-effective at this scale; per [ARCHITECTURE.md](ARCHITECTURE.md) the production posture is self-hosted on the same Compose stack. At 1K users, Langfuse needs its own dedicated compute (separate from the agent API) and an external Postgres for trace storage with retention policy.
- **Add an LLM call budget alarm.** Wire a cumulative-cost guard into observability so a runaway prompt cannot burn $100K overnight before someone notices.
- **STT provider: re-evaluate.** AssemblyAI streaming free-tier overflows immediately at this scale; lock in a paid tier or evaluate Deepgram Nova-2 for the ~30% rate advantage.

### 10,000 clinicians (≈ 50M visits/year)

- **Anthropic prompt caching, urgently.** Each chat turn currently rebuilds the full chart-context prompt (~3,500 input tokens) from scratch. Anthropic's native prompt caching (`cache_control` on the system + chart-context block) cuts that to ~10% of the cost on repeat turns within a 5-minute window. At 50M visits/year × ~8 turns = 400M turns, even a 30% cache hit rate is **≈$200K/year saved**.
- **Model-tier routing.** Not every turn needs Haiku 4.5. Trivial refusals, vitals confirms, and "what's the chief complaint" lookups can route to a cheaper SLM (or a deterministic rule). Inversely, complex multi-tool reasoning turns (UC-B propose with conflicting source rows) might warrant Sonnet for safety. A small router model in front of `getChatModel(env)` is the right shape.
- **Regional API deployments.** US East/West clinic distributions add 40–80ms TLS RTT to a single-region API, which is felt in UC-B dictation latency. Deploy regional `agentforge-api` clusters; Langfuse and Postgres can stay centralized initially.
- **Pre-computed morning brief queue.** UC-A briefs for tomorrow's schedule can be pre-warmed overnight using the appointment table — turning a synchronous LLM call at chart-open into a cache hit. **Saves 1 LLM call × ~$0.009 × 50M = $450K/year.**
- **Postgres read replicas** for chart-context endpoints and the `pending_proposals` query path.
- **STT provider: enterprise contract.** $3.7M/year list price is high enough that AssemblyAI or Deepgram should be on a negotiated rate, likely 30–40% below list.

### 100,000 clinicians (≈ 500M visits/year)

- **Tenant isolation.** Hospital systems will not share a Postgres or a Langfuse with peer institutions. The deployment shape becomes per-tenant Compose stacks (or per-tenant Kubernetes namespaces) with a thin shared control plane for auth, billing, and aggregate observability. The `oe-module-agentforge` boundary already enforces a per-call shared secret + session-token binding, which makes this transition mostly an infra concern rather than a code rewrite.
- **Enterprise LLM contracts and BYO-LLM.** At this scale the marginal LLM bill is ~$57M/year — large enough that hospitals will demand either an enterprise Anthropic / Azure contract priced under list, or a BYO-LLM path where they bring their own Bedrock / private endpoint. The provider-swap surface (`LLM_PROVIDER` env + cross-field validation in [agentforge/api/src/agent/model.ts](agentforge/api/src/agent/model.ts)) was deliberately built shallow for exactly this reason.
- **Regional Langfuse plus aggregate rollup.** Trace volume at this scale (~500M trace events/day at the §11.2 spec'd shape) forces regional ingestion + a periodic aggregate rollup for cross-regional dashboards. Trace-body redaction (the existing [agentforge/api/src/observability/redact.ts](agentforge/api/src/observability/redact.ts) deny-list) becomes a critical compliance surface, not just a hygiene one.
- **Ambient noise pipeline / hospital STT options.** At this scale some buyers will reject AssemblyAI/Deepgram in favor of an on-prem STT or a dedicated medical-vocabulary model. The streaming relay shape in `agentforge-api` already abstracts the provider — extending it to a third option is the same level of work as adding Deepgram alongside AssemblyAI.
- **Enterprise pricing inversion.** At ~$57M/year LLM + $37M/year STT, *the per-clinician cost is below $600/year*. Some hospital systems will want a flat-rate per-seat license priced in that range; the operational margin is the negotiated discount on LLM + STT contracts.

---

## 7. Cost mitigations already in place

These are not future work — they are shipped and contributing to the §4 numbers being lower than a naive per-token estimate would suggest.

| Mitigation | Mechanism | Savings shape |
|---|---|---|
| **Encounter-scoped brief cache (server + client, 2h TTL)** | [agentforge/api/src/agent/case_presentation_cache.ts](agentforge/api/src/agent/case_presentation_cache.ts) + `brief_cache.ts`. Same `(patient, encounter, session)` returns the cached brief without an LLM call. | Removes most refresh-driven UC-A re-fires. Empirically ~30–50% of UC-A calls in dev. |
| **In-flight dedupe** | `inflight: Map<key, Promise>` in [agentforge/api/src/agent/case_presentation.ts](agentforge/api/src/agent/case_presentation.ts). Two simultaneous chart-open pings produce one LLM call. | Eliminates the rail's auto-fire double-trigger pattern. |
| **Refusal-before-LLM** | Internal-disclosure block in [agentforge/api/src/agent/orchestrator.ts](agentforge/api/src/agent/orchestrator.ts), cross-patient binding check in `_binding.ts`, vitals impossible-range parse in `verification.ts`. | Bad-input turns short-circuit before any LLM cost. |
| **Verification strip-uncited** | [agentforge/api/src/agent/verification.ts](agentforge/api/src/agent/verification.ts) `verifyClinicalBlocks` removes uncited claim blocks deterministically; we do not retry the LLM to "fix" the response. | Avoids the ×2–3 cost spike of "ask the model again" reflex. |
| **Tool-result citation reuse** | Same `source_pack.uuid` referenced across multiple claims pays for one tool call, not many. | Already-fetched chart context is not re-fetched within a turn. |
| **Empty/refusal-only briefs not cached** | `isCacheable()` guard. Avoids pinning a transient empty brief for the full 2h TTL — which would have been a cost-leakage path during retries. | Prevents pathological "blank brief, retry, blank brief, retry" loops. |
| **Eval suite is no-LLM** | [EVALUATION.md](EVALUATION.md) `## The runner` — 39-case eval suite runs in 6ms with deterministic rules, no LLM in the loop. | Adding eval coverage costs nothing at runtime; CI gate is free. |

---

## 8. Risks and sensitivities

- **Rate change risk.** A 50% Anthropic price rise (or a forced upgrade to a higher model tier for accuracy reasons) shifts the §5 LLM column proportionally. Mitigated by the provider-swap (`LLM_PROVIDER` env); not eliminated.
- **Prompt-length drift.** UC-A briefs trend toward "include more context" pressure. Each 1K input tokens added to the brief is +$0.001 × all UC-A calls/year. At 10K users that's **+$50K/year per 1K tokens**. Watch the `context/*` endpoints for size growth.
- **Retry behavior.** A poorly-tuned Vercel AI SDK retry policy on `generateText` can silently 2× cost during provider hiccups. Currently relies on SDK defaults; worth pinning retries explicitly at scale.
- **STT minutes inflation.** UC-B "hold-to-talk" reduces minutes vs. continuous recording, but a UI regression that toggles to continuous recording would 2–3× STT cost.
- **Cache invalidation drift.** The 2-hour brief TTL is a tradeoff: too short and cache hit rate drops; too long and stale chart data gets served. A change to encounter-state semantics (e.g. "vitals updated mid-visit should invalidate the brief") would shift the §7 mitigation savings.
- **Eval-suite cost is currently zero** ([EVALUATION.md `## The runner`](EVALUATION.md): no LLM in the loop, 6ms runtime). If a future eval expansion adds live-LLM cases for paraphrase coverage, that becomes a CI-time line item — modest at V1 size, $0.30 × N PRs/day at 10K-engineer scale.

---

## 9. Open questions for production deployment

1. **BAA negotiations.** Anthropic, Azure OpenAI, AssemblyAI, and Deepgram each require their own BAA before real PHI flows. Cost negotiations and BAA negotiations are usually the same conversation — start early.
2. **Eval-driven cost regression alarms.** Should the eval runner trip a budget alarm if a PR increases per-case cost by >X%? Cheap to add, useful guard against silent prompt bloat.
3. **Per-tenant cost attribution.** At 1K+ users, hospital admins will want to see *their* clinicians' usage, not the global rollup. The `correlation_id` and `physician_user_id` fields already in trace metadata ([PRD.md §11.2](PRD.md)) make this possible, but the Langfuse dashboards need explicit per-tenant filtering.
4. **Day-view across-patient prep** (post-MVP per [USERS.md §7](USERS.md)): pre-warming UC-A briefs for the morning's schedule is in scope for §6's 10K-user tier as a cost optimization, but rollout depends on [USERS.md](USERS.md) being expanded to include the day-view scope.
5. **Prompt caching adoption timing.** §6 calls prompt caching urgent at 10K users. The decision is not technical — it is about when to commit to a `cache_control` block shape that the upstream Anthropic SDK has stabilized for production. As of submission date, the API supports it; the in-repo orchestrator does not yet use it.
6. **BYO-LLM economics.** At 100K scale, hospital systems running on AWS Bedrock or Azure OpenAI via private endpoint may see ~50% cost reduction vs list rates but introduce per-tenant compliance and operational complexity. The shallow provider-swap surface is built for this; the contract math is not.

---

## 10. Cross-references

- [Documentation/AgentForge/references/Week 1 - AgentForge.pdf](Documentation/AgentForge/references/Week%201%20-%20AgentForge.pdf) — original case-study brief; cost analysis is one of the listed Submission Requirements deliverables.
- [USERS.md](USERS.md) — workflow assumptions feeding §2, §4 (visits per day, dictation minutes, turn count per visit).
- [ARCHITECTURE.md](ARCHITECTURE.md) — VPS topology, cost-snapshot section, observability posture.
- [EVALUATION.md](EVALUATION.md) — confirms the eval suite has no LLM in the loop (§7 row, §8 risk note).
- [OBSERVABILITY.md](OBSERVABILITY.md) §Q4 — Langfuse cost-tracking path that produces the per-turn USD field this document aggregates.
- [PRD.md](PRD.md) §11.2 — per-turn trace content shape feeding §1's "what we measured" claim.
- [AUDIT.md](AUDIT.md) — Compliance-2 (LLM PHI boundary) and Performance-7 (N+1 patterns) inform cost-mitigation choices.
- [Documentation/AgentForge/implementation/dev-spend-log.md](Documentation/AgentForge/implementation/dev-spend-log.md) — the running per-gate token tally that feeds the §3 totals.
- [agentforge/api/src/agent/cost_estimate.ts](agentforge/api/src/agent/cost_estimate.ts) — current in-repo heuristic rates: $1 / $5 per Mtok for `anthropic` (Haiku 4.5), $5 / $15 for Azure OpenAI / OpenAI.
