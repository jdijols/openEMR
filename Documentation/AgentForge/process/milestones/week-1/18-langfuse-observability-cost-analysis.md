---
date: 2026-05-02
topic: Langfuse observability live + AI cost analysis appendix + production deploy
related_journal: process/journal/week-1/0502-T0208-langfuse-observability-prod-deploy.md
---

# Langfuse observability + AI cost analysis — process milestone

## Purpose

Anchor the closure of two Gate 6 / Gate 7 deliverables that landed together:

1. **Observability is no longer a stub.** Every chat turn now produces a Langfuse trace with tool spans (input / output / latency), verification + security-guard events, and an LLM generation tagged with the canonical model name (`claude-haiku-4-5`), input / output token counts, and dollar cost. The PHI redactor (`observability/redact.ts`, G6-08) is applied to every meta payload before it leaves the process. The brief's four observability questions — *what did the agent do, in what order, did any tools fail and why, how many tokens at what cost* — are answerable from one dashboard against the live URL, not just dev.
2. **G7-07 cost appendix exists.** [`Documentation/AgentForge/implementation/ai-cost-analysis.md`](../../../implementation/ai-cost-analysis.md) covers methodology, unit economics measured from real traces, projections at 100 / 1K / 10K / 100K MAU clinicians, and a tier-by-tier "what changes architecturally" paragraph at each scale (the brief explicitly asks for this, not per-token × users multiplication). Only the §3 actual dev-spend table awaits Anthropic / AssemblyAI console fill-in.

Session pivot history: [0502-T0208-langfuse-observability-prod-deploy.md](../../journal/week-1/0502-T0208-langfuse-observability-prod-deploy.md).

---

## Decisions (summary)

1. **Cloud over self-hosted (demo posture).** Langfuse Cloud (`https://us.cloud.langfuse.com`) is the trace sink for the submission demo; the self-hosted Langfuse v2 service from G6-07 stays in compose but is unused tonight. Real-PHI deployments default back to self-hosted per [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) Compliance-2.
2. **Langfuse JS SDK v3 (not v5).** The cloud's "Faster experience" preview banner suggests SDK v5 for real-time data; investigation showed v3 already ingests fine and the operator's empty-Home symptom was UI lag, not missing data (Tracing view had records). v5 would mean a full rewrite to the OpenTelemetry-based `@langfuse/tracing` + `@langfuse/otel` package family — deferred.
3. **Span pattern with `end()`, not fire-and-forget events.** Tool calls need start + end to capture latency. `recordToolCall` returns `{ end }`; every call site wraps work in try/finally so latency captures even on error. Verification categories and security-guard refusals went to a separate `recordEvent` (instantaneous markers, no duration).
4. **Canonical model id passed to `recordLlmCall`.** Langfuse Cloud computes cost from its own model-price database keyed by model name. Passing `env.LLM_PROVIDER` ("anthropic") matched no entry; passing `claude-haiku-4-5` (or the Azure deployment id) matches Anthropic's published rate ($1 / $5 per Mtok input / output) and renders real dollar cost. Helper in `agent/model.ts:getProviderModelId()`.
5. **Generation latency via `meta.start_time_ms`.** Capture `Date.now()` immediately before `generateText`, thread through the existing `recordLlmCall` meta, observability impl converts to a `Date` and passes as `startTime` on the Langfuse generation. Numbers pass through the PHI redactor unchanged; ISO date strings would have been caught by the DOB regex.

---

## Code pointers

| Area | Path |
| ---- | ---- |
| Observability impl | [`agentforge/api/src/observability/index.ts`](../../../../../agentforge/api/src/observability/index.ts) |
| PHI redactor (G6-08) | [`agentforge/api/src/observability/redact.ts`](../../../../../agentforge/api/src/observability/redact.ts) |
| Model id helper | [`agentforge/api/src/agent/model.ts`](../../../../../agentforge/api/src/agent/model.ts) (`getProviderModelId`, `ANTHROPIC_DEFAULT_MODEL_ID`) |
| Orchestrator call sites | [`agentforge/api/src/agent/orchestrator.ts`](../../../../../agentforge/api/src/agent/orchestrator.ts) |
| Case-presentation call sites | [`agentforge/api/src/agent/case_presentation.ts`](../../../../../agentforge/api/src/agent/case_presentation.ts) |
| Verification events | [`agentforge/api/src/agent/verification.ts`](../../../../../agentforge/api/src/agent/verification.ts) |
| Tool span sites | [`agentforge/api/src/tools/get_allergies.ts`](../../../../../agentforge/api/src/tools/get_allergies.ts), [`get_identity.ts`](../../../../../agentforge/api/src/tools/get_identity.ts), [`chart_context_reads.ts`](../../../../../agentforge/api/src/tools/chart_context_reads.ts), [`propose_writes.ts`](../../../../../agentforge/api/src/tools/propose_writes.ts) |
| Graceful shutdown | [`agentforge/api/src/index.ts`](../../../../../agentforge/api/src/index.ts) (SIGTERM / SIGINT → `observability.shutdown()` → `langfuse.shutdownAsync()`) |
| Cost appendix (G7-07) | [`Documentation/AgentForge/implementation/ai-cost-analysis.md`](../../../implementation/ai-cost-analysis.md) |
| Tests | [`agentforge/api/test/observability/stub.test.ts`](../../../../../agentforge/api/test/observability/stub.test.ts) (3 cases — null-client + no-op span + no-op event/llm/shutdown) |

---

## Verification

- **Vitest:** `agentforge/api` — 143 / 144 pass (1 skipped pg integration test). 3 new `stub.test.ts` cases for the null-client path; existing `case_presentation.test.ts` / `orchestrator.test.ts` / `verification.test.ts` mocks updated for the new interface (added `recordEvent`, `shutdown`, `recordToolCall` returns `{ end }`).
- **Isolated PHPUnit:** AgentForge — 88 tests / 545 assertions (up from Gate 6 close at 67 / 414); all new structural tests from this session's commits pass.
- **Live URL:** `curl -fsS https://108-61-145-220.nip.io/health` → `{"ok":true,"providers":{"llm":"anthropic","stt":"assemblyai"},"deps":{"openemr_module":"ok","postgres":"reachable","langfuse":"unknown"}}`. The `langfuse:"unknown"` is expected — `/health` only actively probes Postgres and the OpenEMR module, not the Langfuse Cloud egress; traces land regardless.
- **Browser smoke against prod:** auto-brief renders against the operator's cloned MariaDB (28 patients / 39 appointments); one chat turn produces a fresh `correlation_id` trace in [https://us.cloud.langfuse.com](https://us.cloud.langfuse.com) → AgentForge project → Tracing, with `claude-haiku-4-5` and a non-zero generation latency + cost.

---

## Follow-ups

- **Full P1 / P2 / P3 prod re-smoke** — covered in [`post-deploy-bug-log.md`](../../../implementation/post-deploy-bug-log.md). Tonight's smoke verified the basic loop; full BP-dictation → Confirm → write E2E plus encounter-switch and patient-switch paths still owed.
- **`cost_estimate.ts` rate alignment** — in-repo heuristic still uses Sonnet-shape $3 / $15 input / output for `anthropic`; should be Haiku 4.5 actual ($1 / $5). 5-minute fix; the cost-analysis appendix already uses the correct rate.
- **`ai-cost-analysis.md` §3 placeholder rows** — fill from Anthropic console (Settings → Usage), AssemblyAI dashboard, and Langfuse aggregations.
- **Caddyfile path fix in `docker-compose.prod.yml`** — third deploy that needed the symlink / copy workaround. Single-line PR after submission.
- **Langfuse v5 / OTel migration** — revisit when `@langfuse/tracing` + `@langfuse/otel` API surface stabilizes; the cloud "Faster experience" banner is the canary that v3 ingestion will eventually be deprecated.
