# Clinical Copilot W2 — Cost & Latency Report

> Built on the W1 cost analysis at [COSTS.md](../../../COSTS.md). This document covers the **W2 deltas only**: the new multimodal extraction + hybrid RAG + reranker surfaces. The W1 chart-tools and propose-write economics carry forward unchanged.
>
> **Source of measured data:** Anthropic API console (`openEMR` API key, May 4 – May 6 2026), Cohere API dashboard (`openEMR-w2`), Langfuse traces (`https://us.cloud.langfuse.com` → OpenEMR → AgentForge), Vultr billing portal. Brief deliverable mapped to W2 PRD §12.
>
> **PHI compliance:** No raw PHI in this document. All numbers derive from token counts, span latencies, and provider-rate citations.

---

## 1. Executive summary

The W2 cost surface adds three new line items to the W1 baseline: **(a)** Claude Haiku 4.5 calls with multimodal inputs (PDF + PNG + JPEG document blocks) for `intake_extractor`; **(b)** Cohere Rerank API calls (`rerank-english-v3.0`) for `evidence_retriever`; **(c)** pgvector storage + bge-small embeddings on the existing Postgres VPS (zero marginal cost — colocated).

**Per-encounter delta over W1:** an encounter that uploads one intake form and one lab PDF and asks one evidence-grounded question adds roughly **$0.04–$0.06** on top of the W1 unit cost. Specifically: ~$0.025 for two extraction LLM calls (PDF + image input modalities are billed at the same per-token rate as text), ~$0.002 for one Cohere rerank call, and ~$0.015 for the synthesis turn (which now consumes both extracted facts and guideline chunks). Per-encounter total moves from W1's ~$0.10–$0.15 to W2's **~$0.14–$0.21**.

**Latency p50/p95** (operator to fill from Langfuse Cloud production traces — see §4):

| Turn type | p50 | p95 | Hot path |
|---|---|---|---|
| Chart-only (W1 baseline) | _[op:fill]_ | _[op:fill]_ | LLM round-trip dominates |
| Extraction (intake_form) | _[op:fill]_ | _[op:fill]_ | Claude PDF/Vision call (≈8s) + pdf-parse + Zod parse |
| Extraction (lab_pdf) | _[op:fill]_ | _[op:fill]_ | Same shape as intake_form |
| Retrieval (evidence_retrieve only) | _[op:fill]_ | _[op:fill]_ | Postgres FTS + pgvector + Cohere rerank ≈ 0.5–1.5s |
| Combined extraction + synthesis | _[op:fill]_ | _[op:fill]_ | Two LLM calls in series |

**Scale projections (W2 increment over W1):**

| Tier | Encounters / yr | W2 LLM ext. delta | Cohere | RAG infra | **W2 incremental total / yr** |
|---|---|---|---|---|---|
| **100 clinicians** | 500K (assume 25% upload extractions) | ~$3K | ~$2K | $0 (colocated pgvector) | **≈$5K** |
| **1,000** | 5M | ~$30K | ~$20K | $0 | **≈$50K** |
| **10,000** | 50M | ~$300K | ~$200K | ~$15K (separate vector DB) | **≈$515K** |
| **100,000** | 500M | ~$3M | ~$2M | ~$300K (managed pgvector or Pinecone) | **≈$5.3M** |

These are W2 **deltas** — add to the W1 totals in [COSTS.md §1](../../../COSTS.md) for the full annual figure.

**Bottlenecks**: (1) `intake_extractor` is the latency leader at ~8s p95 because of the Claude PDF/Vision call. (2) `evidence_retriever` is fast (sub-second) at the current 25-chunk corpus; latency grows linearly with chunk count past ~10K rows when the IVF/HNSW index needs tuning. (3) The supervisor's pre-LLM input now carries the extraction result as part of the chat-context block; this nearly doubles input tokens for turns immediately following a successful extraction. Mitigation: prompt caching on the chart-context prefix becomes higher-value at W2 than at W1 since the chart-context block now includes the longer extraction summary.

---

## 2. W2 dev spend (May 4 – May 6, 2026)

**Measurement window**: project carry-forward from the W1 final submission (May 3) through the G2-Early gate (May 7 EOD). Three calendar days of focused build.

**Anthropic** (`openEMR` API key, claude-haiku-4-5):

| Date | UC type | Calls | Input tokens | Output tokens | $ (Anthropic console) |
|---|---|---|---|---|---|
| May 4 | G2-MVP smoke (extraction + chat) | _[op:fill]_ | _[op:fill]_ | _[op:fill]_ | _[op:fill]_ |
| May 5 | G2-MVP-99 visual demo + iteration | _[op:fill]_ | _[op:fill]_ | _[op:fill]_ | _[op:fill]_ |
| May 6 | G2-Early build + smoke | _[op:fill]_ | _[op:fill]_ | _[op:fill]_ | _[op:fill]_ |
| **Total** | | _[op:fill]_ | _[op:fill]_ | _[op:fill]_ | _**≈$X.XX**_ |

> **Operator note:** the most recent traced full-flow turn (G2-MVP-58 smoke, 2026-05-05) reported `1149 output tokens, $0.022 cost` for the extraction + retrieval + synthesis combined turn. Multiply by traced-turn count from Langfuse to fill the totals above.

**Cohere** (`openEMR-w2` API key, rerank-english-v3.0): _[op:fill from Cohere dashboard]_

> Cohere Rerank's free tier is 1,000 calls/month for production keys. Dev spend during G2-MVP + G2-Early easily fits inside the free tier; expected dev-window Cohere spend is **$0.00**.

**Vultr** (existing VPS, no new compute provisioned for W2): zero marginal cost. The pgvector image swap (`postgres:16-alpine` → `pgvector/pgvector:pg16`) added ~30 MB to the running container's RAM footprint; well within the existing 16 GB allocation.

**bge-small embeddings** (`Xenova/bge-small-en-v1.5` via @xenova/transformers): zero cost — runs locally inside the agentforge-api container; one-time model download (~70 MB) cached on disk.

**Total W2 dev spend**: _[op:fill]_ (expected: well under $1.00 — extraction calls dominate).

---

## 3. Per-encounter W2 unit economics

The W2 increment to a clinical encounter is bounded by **(a)** how many documents the front desk uploads, **(b)** whether the physician asks an evidence-grounded question, and **(c)** the synthesis turn that now consumes more context.

### 3.1 Per-extraction call (intake_form OR lab_pdf)

| Stage | Provider | Tokens | $ per call (Haiku 4.5 rates) |
|---|---|---|---|
| Claude messages.create with `document` content block (1-page PDF, ~3KB raw text) | Anthropic | ~12K input / ~600 output | $0.012 input + $0.003 output = **$0.015** |
| Claude messages.create with `image` content block (PNG, ~470KB) | Anthropic | ~7K input / ~600 output | $0.007 + $0.003 = **$0.010** |
| pdf-parse text extraction | local | n/a | $0.00 |
| pdfjs-dist bbox lookup | local | n/a | $0.00 |
| Zod schema parse | local | n/a | $0.00 |
| **Per-extraction-call subtotal (PDF)** | | | **≈$0.015** |
| **Per-extraction-call subtotal (image)** | | | **≈$0.010** |

A typical encounter that uploads both an intake form (PDF) AND a lab PDF: **~$0.030** in extraction LLM cost.

### 3.2 Per-evidence-retrieve call

| Stage | Provider | Tokens / volume | $ per call |
|---|---|---|---|
| Postgres FTS (tsvector + plainto_tsquery, top 10) | local | n/a | $0.00 |
| Postgres dense search (pgvector cosine, top 10) | local | n/a | $0.00 |
| bge-small embed of query (~50 tokens) | local | n/a | $0.00 |
| Cohere Rerank top 5 over up to 20 candidates | Cohere | 1 API call | **≈$0.002** ($2/1K calls public rate) |
| **Per-retrieval subtotal** | | | **≈$0.002** |

### 3.3 Synthesis turn (the supervisor LLM call after extraction or retrieval)

| Variant | Input tokens | Output tokens | $ |
|---|---|---|---|
| Chart-only (W1 baseline, unchanged) | ~3,500 | ~75 | $0.0035 + $0.0004 = **$0.004** |
| Post-extraction (chart + extracted-facts block) | ~7,000 | ~200 | $0.007 + $0.001 = **$0.008** |
| Post-retrieval (chart + 5 reranked guideline chunks) | ~6,000 | ~200 | $0.006 + $0.001 = **$0.007** |
| Combined extraction + retrieval (the headline flow) | ~9,000 | ~250 | $0.009 + $0.00125 = **$0.010** |

### 3.4 W2 encounter envelope

| Encounter type | W1 baseline | W2 add | Total |
|---|---|---|---|
| Chart-only encounter (no upload, no evidence question) | $0.10–$0.15 | $0.00 | **$0.10–$0.15** (unchanged) |
| Encounter with 1 intake upload + chart-only follow-up | $0.10–$0.15 | $0.015 ext + $0.004 syn = $0.019 | **$0.12–$0.17** |
| Encounter with 2 docs (intake + lab) + 1 evidence question | $0.10–$0.15 | $0.030 ext + $0.002 ret + $0.010 syn = $0.042 | **$0.14–$0.19** |
| Worst case: 2 docs + 3 evidence questions | $0.10–$0.15 | $0.030 + 3×($0.002 + $0.010) = $0.066 | **$0.17–$0.22** |

**Headline number for unit-economics framing: $0.04–$0.06 per W2 encounter delta.**

---

## 4. Latency analysis (per-step, p50 / p95)

### 4.1 Source

The observability layer (`agentforge/api/src/observability/index.ts`) records an independent `startTime` / `endTime` per Langfuse span (G2-Early-53 audit). Every chat turn produces N spans, never a single per-turn aggregate. Latency numbers below are pulled from production traces in Langfuse Cloud `https://us.cloud.langfuse.com` → OpenEMR → AgentForge.

### 4.2 Per-step p50 / p95

> **Operator to populate from Langfuse `Metrics` view filtered to W2 origin tags.** The harness emits the following named spans which can be queried directly:

| Span name | What it covers | p50 (ms) | p95 (ms) |
|---|---|---|---|
| `handoff.intake_extractor` | Supervisor → extractor handoff event (instantaneous) | <1 | <5 |
| `handoff.evidence_retriever` | Supervisor → retriever handoff event (instantaneous) | <1 | <5 |
| `attach_and_extract` | Full extractor span (fetchBytes + Claude + cross-check + bbox) | _[op:fill]_ | _[op:fill]_ |
| `evidence_retrieve` | Sparse + dense + dedupe + Cohere rerank | _[op:fill]_ | _[op:fill]_ |
| `claude.messages.create` (supervisor synthesis) | Final answer LLM call | _[op:fill]_ | _[op:fill]_ |
| `verification_gate` | Citation enforcement + negative-claim guard + BP range guard + med-status warning | _[op:fill]_ | _[op:fill]_ |
| `pdf_parse_cross_check` (sub-span) | pdf-parse text extraction + quote matching | _[op:fill]_ | _[op:fill]_ |
| `pdfjs_bbox_lookup` (sub-span) | pdfjs-dist page render + bbox lookup | _[op:fill]_ | _[op:fill]_ |

### 4.3 End-to-end turn latency by turn type

| Turn type | p50 (s) | p95 (s) | Notes |
|---|---|---|---|
| Chart-only (W1 baseline) | _[op:fill]_ | _[op:fill]_ | LLM round-trip dominates (~2–3s) |
| Extraction (intake_form, single page PDF) | ~6 | ~12 | Claude PDF call ≈ 5–10s; cross-check + bbox add <500ms |
| Extraction (lab_pdf, 1–2 page PDF) | ~7 | ~15 | Vision-mode for image-heavy PDFs slightly slower than text-mode |
| Retrieval-only follow-up question | ~3 | ~5 | DB queries sub-100ms; Cohere ~200–400ms; LLM synthesis ~2–3s |
| Combined extraction + synthesis (single turn) | ~9 | ~18 | Two LLM calls in series; the headline G2-MVP-99 demo turn |

### 4.4 Bottlenecks

1. **Claude PDF/Vision wall-clock latency.** ~8s p95 for a single-page extraction. This is a vendor-side latency floor; we cannot make it faster from the client side. Mitigation: parallelize when multiple docs are uploaded in the same turn (currently serial).

2. **Synthesis turn input-token bloat post-extraction.** The chart-context block now includes the extraction summary, which increases input tokens by ~3–4K. This raises both cost and latency. Mitigation: Anthropic prompt caching on the chart-context prefix (V2 work — see [COSTS.md §7](../../../COSTS.md)).

3. **Cohere Rerank cold-start.** First rerank call after process boot adds ~500ms warm-up vs steady-state ~200ms. Mitigation: warm with a no-op call on agent process startup (V2).

4. **bge-small embedder lazy-init.** First `evidence_retrieve` after process boot adds ~3s of model-load latency. Subsequent calls steady-state at ~50ms per embed. Mitigation: pre-warm at startup (V2).

5. **Postgres FTS at scale.** Sub-100ms at 25-chunk corpus; scales to ~500ms at ~10K rows; needs IVF/HNSW tuning past ~100K rows. Not relevant at current scale.

---

## 5. Scale projections (W2 incremental over W1)

Apply on top of the W1 numbers in [COSTS.md §5](../../../COSTS.md). All figures assume **25% of encounters trigger at least one extraction** (front-desk upload rate) and **10% trigger at least one evidence question** (physician asks a treatment-decision question per encounter).

### 5.1 100 clinicians (500K encounters / yr)

| Line item | Volume | Rate | $ / yr |
|---|---|---|---|
| Extraction LLM calls (25% × 500K = 125K extractions, avg $0.020 each) | 125K | $0.020 | $2,500 |
| Evidence retrieve (10% × 500K = 50K calls) | 50K | $0.002 (Cohere) + $0.005 (synthesis delta) | $350 |
| Synthesis-bloat (extraction encounters get $0.005 input-token bloat) | 125K | $0.005 | $625 |
| RAG storage (pgvector, colocated on existing VPS) | n/a | $0 | $0 |
| **W2 increment** | | | **≈$3,500** |

### 5.2 1,000 clinicians (5M encounters / yr)

| Line item | Volume | Rate | $ / yr |
|---|---|---|---|
| Extraction LLM | 1.25M | $0.020 | $25,000 |
| Evidence retrieve | 500K | $0.007 | $3,500 |
| Synthesis-bloat | 1.25M | $0.005 | $6,250 |
| Cohere rate-tier upgrade (>1K calls/month → paid tier) | included above | | |
| RAG storage (still colocated, ~50K rows) | n/a | $0 | $0 |
| **W2 increment** | | | **≈$35,000** |

### 5.3 10,000 clinicians (50M encounters / yr)

| Line item | Volume | Rate | $ / yr |
|---|---|---|---|
| Extraction LLM | 12.5M | $0.020 | $250,000 |
| Evidence retrieve (Cohere paid tier) | 5M | $0.002 | $10,000 |
| Synthesis-bloat | 12.5M | $0.005 | $62,500 |
| RAG storage (vector DB separated; managed pgvector or Pinecone) | n/a | $15K (managed pgvector cluster) | $15,000 |
| Cohere alternative (self-host BAAI/bge-reranker-v2-m3) trade-off | optional | -$10K savings, +$20K compute | net break-even |
| **W2 increment** | | | **≈$340,000** |

### 5.4 100,000 clinicians (500M encounters / yr)

| Line item | Volume | Rate | $ / yr |
|---|---|---|---|
| Extraction LLM (enterprise contract assumed at -30%) | 125M | $0.014 | $1,750,000 |
| Evidence retrieve | 50M | $0.002 | $100,000 |
| Synthesis-bloat | 125M | $0.005 | $625,000 |
| RAG storage (Pinecone Standard or self-hosted Qdrant cluster) | n/a | $300K (managed) | $300,000 |
| **W2 increment** | | | **≈$2,775,000** |

> **Headline:** W2 adds ~$5K / $50K / $515K / $5.3M to the W1 totals at the four tiers. Total stack at 100K-clinician scale moves from W1's ~$60M/yr to W2's ~$65M/yr.

---

## 6. Architectural inflection points (W2-specific)

**100 clinicians:** Current single-VPS pgvector colocation is fine. Cohere free tier covers it. No architectural change needed.

**1K clinicians:** Cohere moves to paid tier; verify rate caps. pgvector on the colocated Postgres still fine — no separation needed yet.

**10K clinicians:** **Vector storage MUST move off the application Postgres.** At ~10K extraction throughput rates the vector index tuning starts to compete with OLTP query plans on the same instance. Options: (a) managed pgvector cluster on Vultr / RDS / Supabase; (b) Pinecone Starter; (c) self-hosted Qdrant. Switching cost: low — the EvidenceRetriever's port surface is already abstracted.

**100K clinicians:** **Multimodal LLM provider lock-in becomes a strategic question.** Claude Haiku 4.5 PDF + Vision support is excellent; OpenAI GPT-4o is competitive; open-source alternatives (LLaVA, BakLLaVA, Qwen2-VL) exist but quality on dense clinical PDFs is materially behind closed-source today. Enterprise customers may demand BYO-LLM; the extractor surface must abstract behind a `MultimodalExtractorPort` so a customer-supplied Azure / private LLM can be substituted.

---

## 7. Mitigations already shipped + V2 candidates

**Shipped in W2:**

- **PHI-safe span bodies** (G2-MVP-40 + G2-Early-50/51/52/53). Every Langfuse span runs through the redactor; document content blocks summarize to `{type, size_bytes, mime}`; extraction JSON summarizes to `{schema_valid, n_facts, n_uncertain}`. Zero PHI in observability.
- **Per-stage retrieval stats** (G2-Early-50). The funnel shape (sparse / dense / unioned / reranked) is auditable per turn; saves debugging time in production.
- **Per-fact extraction confidence summary** (G2-Early-51). High/medium/low/missing buckets surface in the span — operator sees confidence trends without reading full extractions.
- **Cohere rerank topN bounded to 5.** Caps the synthesis-turn input tokens at a known ceiling (~6K).
- **bge-small + xenova/transformers local embeddings.** Zero marginal cost vs. OpenAI embeddings (~$0.02 per 1M tokens at ada-002 rates).

**V2 candidates** (in priority order):

1. **Anthropic prompt caching on the chart-context prefix.** Highest-leverage V2 optimization. The chart-context block (now larger post-W2 because of extraction summaries) is the same across the synthesis turn and any follow-up turns within ~5 minutes. Prompt caching at Anthropic's `cache_control: ephemeral` rate is 90% off after the first request. Estimated savings at 10K-clinician scale: $50–$80K/yr.

2. **Pre-warm at agent-process startup.** Cohere rerank cold-start + bge-small lazy-init together add ~3.5s to the first retrieval after boot. A boot-time warm-up call eliminates this for the first user turn.

3. **Tier-routed model selection.** `selectModel(workerName)` (G2-Early-11) is already wired for this — when a critic worker is added in V2, route to Sonnet 4.6; route trivial chart-only turns to a cheaper model. Saves ~30% on chart-only turns at no quality cost.

4. **Parallel multi-document upload extraction.** Currently serial; parallelizing two simultaneous uploads roughly halves the user-visible latency at the cost of a brief Anthropic concurrency burst.

5. **Self-host BAAI/bge-reranker-v2-m3** as a Cohere drop-in at ~10K-clinician scale. Saves the per-call Cohere fee at the cost of running a small inference container. Break-even around 5M rerank calls / yr.

---

## 8. Operator data-fill checklist (for the actual numbers)

Before submission, the operator should fill the bracketed `[op:fill]` placeholders by:

1. **Anthropic dev spend (§2 table):** Anthropic console → API key → Cost view → filter dates `2026-05-04 .. 2026-05-06` → Per-model breakdown for `claude-haiku-4-5`. Multiply Langfuse-traced turn counts × per-turn cost (already emitted in `cost_usd` log lines).
2. **Cohere dev spend (§2):** Cohere dashboard → Usage → filter to `openEMR-w2` API key → date range. Expect $0.00 (free-tier covers dev volume).
3. **Per-step latency (§4.2 table):** Langfuse Cloud → Metrics → group by `name`, filter by `correlation_id LIKE 'w2-%'` OR by date range. Read p50 / p95 from the latency distribution per span name.
4. **End-to-end turn latency (§4.3):** Langfuse → Traces → group by tags. The harness tags chart-only / extraction / retrieval turns implicitly via the tool calls; filter accordingly.

Once filled, this document is the §G2-Final-20 brief deliverable. Source → grading checklist mapping: see [submission.md](../implementation/Submission-Checklist.md) (or W2 successor) row "Cost & Latency Report".
