## AgentForge developer spend rollup

**Method:** token counts × in-repo USD rate table (`agentforge/api/src/agent/cost_estimate.ts`). Structured logs use `cost_usd: null` if pricing unknown (per G3-13).

| Period / gate close | Approx. cumulative LLM turns (dev) | Cumulative est. USD (approx.) | Notes |
| ------------------- | ---------------------------------- | ----------------------------- | ----- |
| 2026-04-30 Gate 2 → Gate 3 | — | — | Baseline: cost fields emitted on `/chat`; wire Langfuse aggregates in Gate 6. |
| 2026-04-30 Gate 3 **closed** (formal task list) | — | — | Task list `[x]` CLOSED; deferrals **G6-14** / **G6-20** / **G7-08**; journal [`0430-T1558-gate3-closed-session-summary.md`](../process/journal/week-1/0430-T1558-gate3-closed-session-summary.md). |
| 2026-05-01 Gate 4 **closed** | — | — | **G4-10** UC-B smoke; journal [`0430-T2230-gate4-g410-uc-b-smoke.md`](../process/journal/week-1/0430-T2230-gate4-g410-uc-b-smoke.md); milestone [`14-gate4-complete.md`](../process/14-gate4-complete.md). |
| 2026-04-30 Gate 5 **closed** (code + tests; G5-08 manual) | — | — | **G5-01..G5-07** shipped: transcripts migration, `/stt/stream` WS relay, recap `GET /conversations/:id/recap` (Bearer + `X-Patient-Uuid`, S5-safe), CUI mic + recap UI; manual journal [`0430-T2145-gate5-stt-uc-c-manual-smoke.md`](../process/journal/week-1/0430-T2145-gate5-stt-uc-c-manual-smoke.md). |
| 2026-04-30 Gate 5 **polish** (mic-enabled-on-load + AssemblyAI) | — | — | UC-C decoupled from UC-B (mic + composer enabled at handshake-ready); WS `onMessage` shielded against unhandled rejections; CUI surfaces typed error codes; AssemblyAI provider implemented (Deepgram pending vendor approval); journal [`0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md`](../process/journal/week-1/0430-T2256-mic-enabled-on-load-and-assemblyai-stt.md). |
| 2026-04-30 Gate 5 **polish** (dictation↔typed parity) | — | — | `onDictationFinal` rewired to the full `/chat` pipeline so dictated input produces proposal cards identically to typed input; voice-confirm preserved in parallel; `[dictation]` text prefix replaced with a non-text `Dictation` badge (`ChatMessage.source`); journal [`0430-T2314-dictation-agent-parity.md`](../process/journal/week-1/0430-T2314-dictation-agent-parity.md). |

**Gate check:** orchestrator emits `console.info(JSON.stringify({ ... input_tokens, output_tokens, cost_usd ... }))` plus `recordLlmCall`; Vitest mocks assert token metadata on the happy-path turn (`agentforge/api/test/agent/orchestrator.test.ts`).
