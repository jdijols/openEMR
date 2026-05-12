---
date: 2026-05-10
topic: Promote structured_finalize_response to a Langfuse GENERATION so it carries model, cost, and latency
related_milestone: process/milestones/week-1/18-langfuse-observability-cost-analysis.md
---

# Langfuse finalizer cost fix — session journal

## Goal

User opened the Langfuse trace dashboard and noticed that most rows showed `$0.00` cost, no "Provided Model Name", and missing latency. Goal: figure out the cause and ship the smallest fix that turns the structured-output finalizer call into a properly-priced GENERATION row.

## Context

Langfuse distinguishes three observation types: GENERATION (carries model/cost/latency), SPAN (carries latency only), and EVENT (point-in-time marker — no cost, no model, no latency). The AgentForge API emits all three via [agentforge/api/src/observability/index.ts](../../../../../agentforge/api/src/observability/index.ts). Investigation traced the missing data to a deliberate-but-incomplete whitelist inside `recordLlmCall()` that only promotes two phases (`response_completed`, `case_presentation_completed`) to GENERATION — every other LLM-related phase is silently demoted to EVENT.

## Key decisions

### Decision: Root-cause is the `isCompleted` whitelist in `recordLlmCall`

- **Prompt:** "a lot of my traces have a $0.00 cost, and it also doesn't list the provider model name … Can we figure out why? Is that because we're not using the LLM, but somehow it's showing up as a trace?"
- **Recommendation:** Walk the user through the EVENT/SPAN/GENERATION distinction and pinpoint the explicit `if (!isCompleted)` branch in [observability/index.ts:198-210](../../../../../agentforge/api/src/observability/index.ts) that demotes every non-completed LLM phase to an EVENT. EVENTs in Langfuse cannot carry cost/model/latency by definition — that's why the column reads as blank.
- **Outcome:** Diagnosis shared with user; identified `verification.*` and `handoff.*` rows as correct EVENTs (no LLM call), but `llm.structured_finalize_response` and `llm.structured_finalize_request` as incorrectly-EVENTed.

### Decision: Quick win (option 1) over a broader refactor (option 2)

- **Prompt:** "Go with the quick win option one. Implement that."
- **Recommendation:** Two options were on the table — (1) add `structured_finalize_response` to the whitelist and pass a real model id instead of the hardcoded `'finalizer'` string; (2) drop the pre-call request-phase markers entirely, or wrap each LLM call in a SPAN with a child GENERATION. Option 1 is a 3-file change and resolves the visible $0/blank-model gap without touching the architecture. Option 2 was deferred.
- **Outcome:** Option 1 implemented across [observability/index.ts](../../../../../agentforge/api/src/observability/index.ts), [finalizeStructured.ts](../../../../../agentforge/api/src/agent/finalizeStructured.ts), and [orchestrator.ts](../../../../../agentforge/api/src/agent/orchestrator.ts).

### Decision: Plumb `providerModelId` and `provider` through `FinalizeStructuredInput`

- **Prompt:** (implementation pivot — no explicit user prompt)
- **Recommendation:** The Vercel AI SDK's `LanguageModel` type technically exposes `.modelId`, but reading it off the opaque type would diverge from the established pattern in [case_presentation.ts:198-251](../../../../../agentforge/api/src/agent/case_presentation.ts), which threads `providerModelId` and `env.LLM_PROVIDER` explicitly. Matching that shape keeps the three priced LLM call sites (orchestrator turn, case presentation, finalizer) data-flow-consistent.
- **Outcome:** `FinalizeStructuredInput` extended with `providerModelId: string` and `provider: string`; orchestrator passes both at the call site (line 899-908).

### Decision: Smoke-test live against the dev API + Langfuse Cloud

- **Prompt:** "Run the smoke test against the dev API."
- **Recommendation:** Rather than a unit-level mock, mint a dev session token, POST to `/chat` with an evidence-triggering clinical question (LDL targets in T2DM forces `evidence_retrieve`, which gates the structured finalizer), then query Langfuse public API by `traceId` to confirm the new row materialized correctly.
- **Outcome:** Live trace `smoke-finalizer-1778429953` in Langfuse Cloud confirms `structured_finalize_response` is now a GENERATION: model=`claude-sonnet-4-6`, latency=13.15s, calculatedTotalCost=$0.034329, 6678/953 tokens. Existing `response_completed` row continues to work as before ($0.089415, 36.3s, same model).

## Trade-offs and alternatives

- **Option 2 (drop pre-call markers / convert to SPANs)** — deferred. Would touch the orchestrator, case presentation, and finalizer pre-call paths and yield richer per-turn lifecycle data, but the immediate observability win comes from option 1.
- **Read `model.modelId` off the `LanguageModel` opaque type** — rejected. Works, but diverges from `case_presentation.ts` which threads the model id explicitly via env. Consistency wins.
- **Pass explicit `totalCost` to the SDK** — left null. Langfuse computed `calculatedTotalCost` from `model + tokens` via its pricing DB, which is the established pattern when `costUsd` is null in the existing `recordLlmCall` body.

## Tools, dependencies, commands

```bash
# Smoke test sequence
TOKEN=$(npx --yes dotenv -e ../../docker/agentforge/secrets.dev.env -- \
  node scripts/mint-dev-session-token.mjs a1a5fc5c-8a37-4bb8-8194-1e93b86ee90e)

curl -sN -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "X-Correlation-Id: smoke-finalizer-$(date +%s)" \
  -d '{"session_token":"'"$TOKEN"'","patient_uuid":"a1a5fc5c-8a37-4bb8-8194-1e93b86ee90e","message":"What does the ACC/AHA guideline recommend for LDL targets and statin intensity in adults with type 2 diabetes?"}'

# Verify in Langfuse Cloud
curl -fsS -u "$PUB:$SEC" \
  "https://us.cloud.langfuse.com/api/public/observations?traceId=smoke-finalizer-XXXX&limit=50"
```

No new dependencies. `npx tsc --noEmit` shows no new errors in the three changed files; pre-existing test-file TS errors are untouched and out of scope.

## Files touched

- **Modified:** `agentforge/api/src/observability/index.ts` — added `'structured_finalize_response'` to the `isCompleted` whitelist (3-line change at lines 198-203).
- **Modified:** `agentforge/api/src/agent/finalizeStructured.ts` — extended `FinalizeStructuredInput` with `providerModelId` + `provider`; imported `estimateUsdForProviderTokens`; replaced hardcoded `'finalizer'` with real model id on both `recordLlmCall` sites; captured `llmStartedAtMs` before `generateObject` and threaded `result.usage` + `costUsd` into the response-side meta.
- **Modified:** `agentforge/api/src/agent/orchestrator.ts` — passes `providerModelId` and `provider: env.LLM_PROVIDER` to `finalizeStructuredEnvelope` at line 899-908.

## Outcomes

- Every chat turn that retrieves evidence now emits two priced GENERATION rows in Langfuse (`response_completed` + `structured_finalize_response`) instead of one. Roughly +$0.02–0.05 of newly-attributed cost per evidence-using turn — money already spent, no longer hidden.
- The `'finalizer'` placeholder string is removed from observability metadata; both finalizer rows now carry the real provider model id (e.g. `claude-sonnet-4-6`).
- Pre-call markers (`llm.request`, `llm.case_presentation_request`, `llm.structured_finalize_request`) intentionally remain EVENTs — they fire before the call returns and have no usage data to carry. Cleanup of those is option 2.

## Next steps

- [ ] (Optional) Implement option 2: drop the three pre-call EVENT markers, or convert each LLM call into a SPAN with a child GENERATION so latency captures the full lifecycle including any pre-flight setup.
- [ ] (Optional, unrelated) Address pre-existing TS errors in `test/observability/required_langfuse_fields.test.ts`, `test/agent/verification*.test.ts`, `test/eval/baseline_compare.test.ts`, etc. — surfaced by `tsc --noEmit` but out of scope for this patch.

## Links

- Related milestone: [process/milestones/week-1/18-langfuse-observability-cost-analysis.md](../../milestones/week-1/18-langfuse-observability-cost-analysis.md)
- Langfuse trace verifying the fix: `smoke-finalizer-1778429953` (project `cmonauvid01b1ad08nhrdfqad` on `us.cloud.langfuse.com`)
