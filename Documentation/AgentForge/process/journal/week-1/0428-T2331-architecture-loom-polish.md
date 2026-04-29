---
date: 2026-04-28
topic: ARCHITECTURE.md Loom walkthrough polish
related_milestone: process/08-stage5-architecture.md
---

# Architecture Loom polish — session journal

## Goal

Walk section by section through root [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) before recording the Loom, tightening the instructor-facing decisions table and diagrams so the architecture is defensible, coherent, and scoped to what can ship by Sunday.

## Context

[`AUDIT.md`](../../../../AUDIT.md) and [`USERS.md`](../../../../USERS.md) were already canonical. This session focused on Stage 5: the AI integration architecture, especially the top decision table, browser/CUI UX, STT visit capture, safety/grounding, observability, and deployment diagrams.

## Key decisions

### Decision: CUI naming and host integration

- **Prompt:** "Change the name of that from panel UI to CUI with Conversational UI in parenthesis... describe how the conversational UI will work with the existing UI."
- **Recommendation:** Treat the co-pilot as a React/Vite/TypeScript **CUI** embedded in an iframe, launched by one OpenEMR header icon into a fixed right rail. Keep OpenEMR chrome responsibility in PHP/module code and keep chat/citations/confirm/STT inside React.
- **Outcome:** [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) now uses **CUI (Conversational UI)**, describes the header-toggle right rail, overlay fallback, no-chart empty state, and Host UX integration.

### Decision: PHP + Node split and agent stack

- **Prompt:** "Agent backend row... using Node 20, TypeScript, and Vercel AI SDK. What were my other options here, and why did we make that decision?"
- **Recommendation:** Keep **Node 20 + TypeScript + Vercel AI SDK** for the agent service because it shares types with the React CUI, supports typed tools/provider swap, and avoids a heavier Python/LangChain stack for a bounded read → propose → confirm → write flow. Document the PHP/Node seam risks rather than trying to collapse runtimes.
- **Outcome:** [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) includes a **PHP + Node: integration seams** table for handshake/context, deploy drift, debugging, and API contract drift.

### Decision: Visit capture scope and provider

- **Prompt:** "Visit capture is a great way to call this feature... choose an option cohesive with the stack... best for implementation, best for cost."
- **Recommendation:** Add a dedicated **Visit capture (STT + transcript)** decision row. Keep V1 physician-only, not ambient room capture; support one mic control with tap start/stop or hold-to-talk; use `agentforge-api` as the streaming STT relay; name **Deepgram** as default and **AssemblyAI** as acceptable under the same BAA-class egress pattern.
- **Outcome:** [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) now has the visit-capture row, STT bullet updates, and UC-B wording that combines chart tools with the rolling physician transcript before write proposals.

### Decision: Safety means grounded citations plus limited deep navigation

- **Prompt:** "Safety... preventing hallucinations... medication names or diagnosis... referencing a certain visit as a link to where that is in the patient's chart."
- **Recommendation:** Preserve the core safety model: verification before display, source-pack citations, active-chart binding, deterministic sanity checks, and no uncited clinical claims. Add citation navigation as an MVP-limited UX enhancement rather than promising every OpenEMR surface deep-links by Sunday.
- **Outcome:** [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) now states that citations can expose actionable links where source packs support navigation, with MVP limited to one or two chart destinations and fallback chart-level navigation.

### Decision: Diagram coherence and scope clarity

- **Prompt:** "Read ARCHITECTURE.md top to bottom... make sure everything is coherent... system diagram... host UX integration Mermaid diagram."
- **Recommendation:** Split the browser side of the system diagram into **OpenEMR shell** and **React CUI iframe**, show launch handoff and citation navigation, add `agentforge-api` → Langfuse trace flow, include Deepgram/AssemblyAI in egress, and clarify that the instructor table is the target V1 architecture while Sunday MVP is narrower.
- **Outcome:** [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) diagrams now show Caddy routing, shell/CUI browser separation, Langfuse ingestion, provider egress, and HostNav citation flow. Milestones now distinguish Sunday MVP priorities from target V1/Final scope.

## Trade-offs and alternatives

- **Full ambient room capture** — Rejected for V1; it expands consent/PHI scope and conflicts with `USERS.md` physician-only capture.
- **Full citation deep-link coverage by Sunday** — Deferred; OpenEMR has many legacy surfaces, so MVP should wire one or two known destinations and fall back safely.
- **LangSmith/SaaS tracing** — Not chosen for the architecture narrative; self-hosted Langfuse keeps traces inside the VPS boundary.
- **Single PHP-only or Python-only backend** — Not chosen; OpenEMR integration remains PHP, while LLM orchestration stays in TypeScript for CUI/API type alignment.

## Tools, dependencies, commands

- No new dependencies installed.
- Used Cursor file tools and `ReadLints` for markdown diagnostics.
- Reviewed diffs with `git diff -- ARCHITECTURE.md`.

## Files touched

- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T2331-architecture-loom-polish.md`
- **Modified:** `ARCHITECTURE.md`
- **Modified:** `Documentation/AgentForge/process/08-stage5-architecture.md`

## Outcomes

`ARCHITECTURE.md` is now stronger for the Loom: the instructor table reflects CUI, agent backend, visit capture, chart access, safety, and observability decisions; diagrams match the written system; and the milestones separate Sunday MVP from target V1/Final capabilities.

## Next steps

- [ ] Final read-through of `ARCHITECTURE.md` immediately before recording the Loom.
- [ ] Implement the module shell + React CUI launch handshake against the deployed VPS.
- [ ] Choose and wire the first citation-navigation destination(s), likely medications/problems, before expanding to additional chart surfaces.

## Links

- Numbered milestone: [process/08-stage5-architecture.md](../../08-stage5-architecture.md)
- Deliverable: [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md)
- Inputs: [`AUDIT.md`](../../../../AUDIT.md), [`USERS.md`](../../../../USERS.md)
