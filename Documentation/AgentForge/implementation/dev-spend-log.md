## AgentForge developer spend rollup

**Method:** token counts × in-repo USD rate table ([`agentforge/api/src/agent/cost_estimate.ts`](../../../agentforge/api/src/agent/cost_estimate.ts) — $1/$5 per Mtok for `anthropic` / Haiku 4.5). Structured logs use `cost_usd: null` if pricing unknown (per G3-13). **Authoritative invoicing-grade total comes from the Anthropic console "Cost" view** filtered by the `openEMR` API key — see [COSTS.md](../../../COSTS.md) §3.

| Period / gate close | Anthropic API daily cost (console) | Cumulative USD | Notes |
| ------------------- | ---------------------------------- | -------------- | ----- |
| 2026-04-27 Gate 0 (scaffold) | ~$0.00 | $0.00 | No live LLM calls yet; isolated tests + scaffolding only. |
| 2026-04-28 Gate 1 (security primitives) | ~$0.00 | $0.00 | Test-first security work; `LaunchCode`, `ActiveChartBinding`, error normalizer — no LLM calls. |
| 2026-04-29 Gate 2 → Gate 3 | ~$0.60 | $0.60 | First end-to-end UC-A briefs + allergy Q&A live; cost fields emitted on `/chat`. |
| 2026-04-30 Gate 3 **closed** (formal task list) | included above | $0.60 | Task list `[x]` CLOSED; auto-fired briefs, citation enforcement; journal [`0430-T1558-gate3-closed-session-summary.md`](../process/journal/week-1/0430-T1558-gate3-closed-session-summary.md). |
| 2026-05-01 Gate 4 **closed** + Gate 5 + Gate 6 deploy | ~$1.25 | $1.85 | **G4-10** UC-B smoke; **G5-01..G5-07** STT shipped; first prod deploy. Peak development day. Journals: [`0430-T2230-gate4-g410-uc-b-smoke.md`](../process/journal/week-1/0430-T2230-gate4-g410-uc-b-smoke.md), [`0430-T2145-gate5-stt-uc-c-manual-smoke.md`](../process/journal/week-1/0430-T2145-gate5-stt-uc-c-manual-smoke.md). |
| 2026-05-02 Gate 6 (eval + observability) + Langfuse cloud + redeploy | ~$1.25 | $3.10 | Langfuse Cloud wired (`ca2006f74`); eval-runner refactor; Context HTTP-matrix backfill; prod redeploy `fb9613edb`. |
| 2026-05-03 Gate 7 / submission | ~$0.30 | **$3.34** | Demo rehearsal + final smoke; submission verification turns. **Final dev-window total per Anthropic console "Cost" view, `openEMR` API key.** |

**Auxiliary streams** (per [COSTS.md §3](../../../COSTS.md)):
- **AssemblyAI STT:** $0.00 across the dev window (free-tier allowance covered all dictation testing).
- **Vultr VPS hosting:** <$15 prorated week-of (Gate 6 deploy onward).
- **Langfuse Cloud Hobby:** $0.00 (free tier).
- **Developer-side AI assistance** (Cursor Ultra + Claude.ai Max 20x): ~$240 attributable, paid as flat monthly subscriptions whether used or not.

**Total dev spend ≈ $258, of which $3.34 is variable per-LLM-call** and would scale with users.

**Gate check:** orchestrator emits `console.info(JSON.stringify({ ... input_tokens, output_tokens, cost_usd ... }))` plus `recordLlmCall`; Vitest mocks assert token metadata on the happy-path turn (`agentforge/api/test/agent/orchestrator.test.ts`).
