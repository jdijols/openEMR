---
date: 2026-05-10
topic: Live routing status pill — hide AgentStepStrip, convert /chat to SSE, single growable pill UI
related_milestone: process/milestones/week-2/07-w2-patient-dashboard-integration.md
---

# Live routing status pill — session journal

## Goal

Replace the post-hoc `AgentStepStrip` ("Routed to intake_extractor · 10.1s · …") that appears *after* every chat turn with a live, Claude-style "Reading file" / "Searching evidence" affordance that appears *while* the supervisor's worker call is running. Jason's framing: the strip "wasn't really helpful towards a physician — it was helpful from the perspective of the gauntlet graders who are interested in the technical aspects of the tool call. Just like previously when there was a row that had evals and PHI data, we hid it but didn't delete it completely."

## Context

The supervisor's two worker tools (`attach_and_extract`, `evidence_retrieve`) already record handoff events to Langfuse via [`handoff.ts`](../../../../agentforge/api/src/agent/handoff.ts) and synthesize `agent_step` chat blocks at the end of each turn for the inline strip ([G2-Final-FB-A-02 / FB-A-03](../../milestones/week-2/04-g2-early-gate-completion.md)). The data signal exists; the question was where to surface it. Built on top of the patient-dashboard integration captured in [`0509-T1747-w2-dashboard-integration.md`](0509-T1747-w2-dashboard-integration.md) and the layout polish in [`0509-T2237-w2-card-collapse-and-layout-polish.md`](0509-T2237-w2-card-collapse-and-layout-polish.md).

## Key decisions

### Decision: hide-don't-delete AgentStepStrip, replace with live affordance

- **Prompt:** *"I want to do the same here. I want to hide these rows from the chat. What I would like instead is, when a file is submitted to the chat and the agents decide to call the tool … populate a new row before the ellipse animation component that says 'Retrieving' or 'Extracting'. Just like in Claude when it's doing things it says 'Reading' or 'Editing'."*
- **Recommendation:** Mirror the eval/PHI row pattern — the `agent_step` block stays in the wire payload (graders, Langfuse, conversation cache all keep seeing it) but `MessageList` returns `null` for it. The new affordance reads from the *same* supervisor handoff signal but surfaces it live, before the response lands.
- **Outcome:** [`MessageList.tsx`](../../../../agentforge/cui/src/chat/MessageList.tsx) `case 'agent_step': return null;` with a hide-don't-delete comment; `AgentStepStrip.tsx` and `synthesizeAgentSteps()` left intact.

### Decision: convert `/chat` to SSE (option C), reject heuristic shortcuts

- **Prompt:** *"We need to go with option C: convert chat to SSE. This is going to be analyzed by my instructors, and they're very critical. We can't get away with being 80% right with occasional lies."*
- **Recommendation:** Three architectures were on the table: (a) ship the file-extraction case only, since `docref_uuid` makes that route deterministic client-side; (b) client-side keyword heuristic on the question text to guess "Searching evidence"; (c) full SSE on `/chat` so the server pushes the actual routing event. (a) was half-done, (b) was an honest 80% that occasionally lied to a physician — (c) is the only path that's *truthful by construction*.
- **Outcome:** [`POST /chat`](../../../../agentforge/api/src/app.ts) wraps `runChatTurn` in Hono's `streamSSE`; emits `routing` events as workers fire, then a `final` event carrying the same blocks payload it used to return as JSON, or an `error` event on failure. Pre-stream 4xx (parse failure, schema rejection) still returns plain JSON so the existing transport-error path is preserved.

### Decision: emit routing co-located with `recordSupervisorHandoff`, threaded through `ChatTurnDeps`

- **Prompt:** *"I almost think it's the supervisor's responsibility to send the information that the routing has taken place to the Retriever or extractor. It is not the job of the Retriever or extractor to report back. I don't know if that's technically correct, but that's just my intuition on this."*
- **Recommendation:** Architecturally Jason's intuition was right — the *decision* is the supervisor's. But in the AI SDK loop the cleanest hook is the worker tool's own `execute` function (it runs immediately when the supervisor's tool call dispatches, microseconds after the decision). Co-locate the wire signal with the existing `recordSupervisorHandoff` call so trace event and SSE event always come from the same point and can never drift. New `RoutingEmitter` type + `WORKER_LABEL` map centralize the labels in [`handoff.ts`](../../../../agentforge/api/src/agent/handoff.ts) so a future third worker travels with its own label.
- **Outcome:** Plumbing — [`handoff.ts`](../../../../agentforge/api/src/agent/handoff.ts) → [`attach_and_extract.ts`](../../../../agentforge/api/src/tools/attach_and_extract.ts) + [`evidence_retrieve.ts`](../../../../agentforge/api/src/tools/evidence_retrieve.ts) → [`w2_tools.ts`](../../../../agentforge/api/src/agent/w2_tools.ts) → [`orchestrator.ts`](../../../../agentforge/api/src/agent/orchestrator.ts) `ChatTurnDeps.onRouting` → [`app.ts`](../../../../agentforge/api/src/app.ts) SSE handler. Failure-isolated: a thrown emitter never breaks extraction or retrieval.

### Decision: label wording = verb + concrete object, not bare verb

- **Prompt:** *"Just like in Claude when it's doing things it says 'Reading' or 'Editing'."* (Initial proposal was bare "Extracting" / "Retrieving".)
- **Recommendation:** Pushed back — Claude's actual pattern is "Reading foo.ts" / "Editing foo.ts": verb plus the concrete object. Bare "Extracting" reads as engineering-speak to a physician. Suggested "Reading file" / "Searching evidence" / "Generating summary" as the concrete-object form. Jason agreed.
- **Outcome:** [`handoff.ts`](../../../../agentforge/api/src/agent/handoff.ts) `WORKER_LABEL`: `{ intake_extractor: 'Reading file', evidence_retriever: 'Searching evidence' }`. Brief auto-trigger uses `'Generating summary'` (set client-side; the brief is its own endpoint, not routed through the supervisor).

### Decision: iteration 2 — single growable pill, not two-pill swap

- **Prompt:** *"Maybe instead of two separate pills, we just have one pill that defaults to the ellipsis animation. If the worker call comes in, then this pill content is prepended with the combined sparkle plus text in the row. That way, any delay that is given doesn't prevent the pill from populating so late."*
- **Recommendation:** Agreed — better UX. Two-pill swap had three problems Jason's framing avoided: (1) appearance latency (pill arrives late if the routing event takes >100ms), (2) layout shift when pills swap, (3) two ARIA live regions confuse screen readers. Single pill always renders dots-only at first, then *grows* sparkle+text on the left when the routing event lands. Width snap mitigated by a 200ms fade+slide-in keyframe on the leading content.
- **Outcome:** [`StatusLabel.tsx`](../../../../agentforge/cui/src/chat/StatusLabel.tsx) takes optional `label` and renders dots-only or sparkle+label+dots from the same component. [`MessageList.tsx`](../../../../agentforge/cui/src/chat/MessageList.tsx) collapses dual rendering to a single `<StatusLabel label={routingLabel ?? null} />`. [`TypingIndicator.tsx`](../../../../agentforge/cui/src/chat/TypingIndicator.tsx) deleted; its smoke test retargeted to StatusLabel.

### Decision: pin pill geometry via `min-height: 1.2em` (caught by automated probe)

- **Prompt:** *"The height of the ellipsis component should be equal to the height of the worker label, and that's for any time the ellipsis is used."*
- **Recommendation:** First implementation relied on shared CSS tokens, but the post-build probe via `preview_eval` measured 24.4px (dots-only) vs 34.8px (labelled) — the SR-only span uses `position: absolute` which contributes zero layout height, so the dots-only pill collapsed. Fix: pin `min-height: 1.2em` on the pill, derived from the same `font-size × line-height` the labelled state gets naturally — no hardcoded pixel value, scales with theme tokens.
- **Outcome:** Re-probe measured 34.8px on all four variants (dots-only, "Reading file", "Searching evidence", "Generating summary"). 1.2s synced pulse confirmed (sparkle and dots share `agentforge-cui-status-label-pulse`); leading-content fade-in confirmed at 0.2s. Brief-case top margin scoped via `.agentforge-cui > .agentforge-cui__status-label` so the in-chat usage rides natural message-flow rhythm without extra buffer.

## Trade-offs and alternatives

- **Heuristic regex on user message text** to guess evidence routing — rejected; Jason's instructors will catch the lies.
- **Bottom margin on the patient header** to space the brief pill — considered; rejected in favor of scoped top margin on the pill itself, smaller blast radius (only the indicator moves; everything else rides existing layout).
- **Two-pill swap design** — rejected after Jason's single-pill insight; appearance latency and ARIA fragmentation outweigh the simpler render path.
- **Delete AgentStepStrip / `synthesizeAgentSteps`** — rejected; the data path matters for graders and Langfuse traces. Hide-don't-delete preserves the wire shape.

## Tools, dependencies, commands

_None this session — pure code change. Standard `npm run build` (cui + api) and `vitest run` for verification._

## Files touched

- **Created:** `agentforge/cui/src/chat/StatusLabel.tsx`
- **Created:** `Documentation/AgentForge/process/journal/week-2/0510-T0435-live-routing-status-pill.md` (this entry)
- **Modified:** `agentforge/api/src/agent/handoff.ts` (added `WORKER_LABEL`, `RoutingEvent`, `RoutingEmitter`)
- **Modified:** `agentforge/api/src/tools/attach_and_extract.ts` (`onRouting` co-located with `recordSupervisorHandoff`)
- **Modified:** `agentforge/api/src/tools/evidence_retrieve.ts` (same)
- **Modified:** `agentforge/api/src/agent/w2_tools.ts` (thread `onRouting` into both tool factories)
- **Modified:** `agentforge/api/src/agent/orchestrator.ts` (`ChatTurnDeps.onRouting` optional)
- **Modified:** `agentforge/api/src/app.ts` (POST `/chat` → `streamSSE`, emits `routing` / `final` / `error`)
- **Modified:** `agentforge/cui/src/api/client.ts` (`postChat` consumes SSE; new `ChatRoutingEvent` type and `onRouting` callback option)
- **Modified:** `agentforge/cui/src/api/client.test.ts` (SSE-shape test cases — final-event, routing-event forwarding, error-event mapping, pre-stream 400, network failure)
- **Modified:** `agentforge/cui/src/App.tsx` (`routingLabel` state across both send paths; brief hint replaced with `<StatusLabel label="Generating summary" />`)
- **Modified:** `agentforge/cui/src/chat/MessageList.tsx` (single StatusLabel render; `agent_step` case returns `null`; `routingLabel` prop)
- **Modified:** `agentforge/cui/src/chat/w2_components.test.tsx` (retargeted TypingIndicator smoke test to StatusLabel — covers dots-only, labelled, empty-string-as-dots-only)
- **Modified:** `agentforge/cui/src/index.css` (consolidated pill styles, removed `__typing*` rules and dead `__hint` selector, added `min-height: 1.2em` and brief-case scoped margin)
- **Deleted:** `agentforge/cui/src/chat/TypingIndicator.tsx`

## Outcomes

`/chat` is now an SSE endpoint that emits live `routing` events as the supervisor dispatches workers — the affordance signal is server-driven and truthful by construction, not a client-side heuristic. The CUI surfaces a single growable pill that goes up the instant a turn starts and *grows* a sparkle + worker label when the routing event lands; visual geometry is locked at 34.8px tall across all four variants, animation is one synced 1.2s wave from sparkle through dots. AgentStepStrip is hidden from the chat view but preserved on the wire and in the conversation cache so graders and Langfuse traces still see the full handoff metadata. 18/18 postChat tests pass under the new SSE contract; 26/26 orchestrator tests pass with the optional `onRouting` field.

## Next steps

- [ ] Manually verify the four flows in the OpenEMR browser at `localhost:8300`: brief auto-trigger ("Generating summary"), file upload ("Reading file"), evidence-seeking question ("Searching evidence"), plain-Q&A turn (bare dots, no label, no AgentStepStrip in response).
- [ ] If the brief-case top margin reads too tight or too loose in the live UI, dial `--af-s3` → `--af-s2` or `--af-s4` based on Jason's eye.
- [ ] Watch for any AI-SDK tool-call paths that *don't* go through `attach_and_extract` / `evidence_retrieve` — if a future worker is added without a corresponding `WORKER_LABEL` entry it'll silently miss the live signal (the build won't catch it because the map's only consumer is the worker tool itself). Consider an exhaustiveness check if a third worker materializes.

## Links

- Numbered milestone (closest existing): [process/milestones/week-2/07-w2-patient-dashboard-integration.md](../../milestones/week-2/07-w2-patient-dashboard-integration.md) — the CUI surface this iteration polishes.
- Prior journal — dashboard integration baseline: [`0509-T1747-w2-dashboard-integration.md`](0509-T1747-w2-dashboard-integration.md).
- Prior journal — same-week layout polish: [`0509-T2237-w2-card-collapse-and-layout-polish.md`](0509-T2237-w2-card-collapse-and-layout-polish.md).
- Spec ID this affordance maps to: G2-Final-FB-A-02 (`synthesizeAgentSteps`) + G2-Final-FB-A-03 (`AgentStepStrip`) — both preserved on the wire side, replaced on the UI side by the live SSE-driven pill.
