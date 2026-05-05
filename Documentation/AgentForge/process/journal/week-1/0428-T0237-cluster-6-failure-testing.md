---
date: 2026-04-28
topic: Cluster 6 — Failure modes + testing synthesis
related_milestone: process/milestones/week-1/06-stage3-audit.md
---

# Cluster 6 — Failure modes + testing synthesis — session journal

## Goal

Synthesize the already-landed Security, Architecture, Data Quality, Compliance, and Performance findings into the remaining Stage 3 presearch sections for failure modes and testing strategy. Do not add new audit-domain findings, implement tests, or choose final providers/frameworks.

## Context

Cluster 1.5 locked the v1 persona as adult PCP / family medicine for non-emergent returning-patient visits, while proving the bundled demo data is too thin for that persona. Cluster 2 established the OpenEMR module/API/FHIR/service integration shape. Cluster 3 captured auth, PHI, audit, BAA, retention, and GPL constraints. Cluster 4 defined source-attributed verification and hybrid synthetic-plus-curated eval data. Cluster 5 identified the chart-read latency, payload, caching, and observability constraints that shape graceful degradation.

## Key decisions

### Decision: Tool failures must degrade explicitly, not infer

- **Prompt:** "Failure Mode Analysis (§11): tool failures, ambiguous queries, rate limiting/fallbacks, graceful degradation."
- **Recommendation:** Treat failed chart readers as structured source states rather than generic errors. The agent can answer from successful, cited sources, but must name failed source families as unavailable, unauthorized, unsupported, timed out, malformed, empty, stale, or conflicting.
- **Outcome:** [`process/milestones/week-1/03-presearch-checklist.md` §11](../../milestones/week-1/03-presearch-checklist.md#11-failure-mode-analysis) now blocks uncited fallback prose and separates missing data from authorization failures.

### Decision: Speed-vs-completeness becomes staged retrieval

- **Prompt:** "Resolve or sharpen open threads only where the audit evidence is sufficient: graceful degradation; speed-vs-completeness."
- **Recommendation:** Use a speed-first core chart bundle for first useful answers, then make deeper note/document/broad Observation reads explicit follow-ups unless measurement proves they fit the initial latency budget.
- **Outcome:** [`process/milestones/week-1/03-presearch-checklist.md` §11](../../milestones/week-1/03-presearch-checklist.md#11-failure-mode-analysis) now frames speed-vs-completeness as staged answering, preserving Stage 4/5 benchmarks before final architecture selection.

### Decision: Conversational UI needs structured degradation surfaces

- **Prompt:** "conversation-vs-cards interface shape."
- **Recommendation:** Do not select final UI yet, but require the answer shape to support conversational questions plus structured sections/cards for citations, missing sources, conflicts, and follow-up reads. Pure chat text is too easy to misread when answers are degraded.
- **Outcome:** [`process/milestones/week-1/03-presearch-checklist.md` §11](../../milestones/week-1/03-presearch-checklist.md#11-failure-mode-analysis) records the hybrid evidence direction while preserving Stage 4/5 implementation decisions.

### Decision: Testing starts with source packs and degradation states

- **Prompt:** "Testing Strategy (§13): unit tests for tools, integration tests for agent flows, adversarial tests, regression setup."
- **Recommendation:** Test deterministic chart readers and answer flows against synthetic fixtures by source-pack shape, claim category, authorization path, missing/conflicting/stale states, prompt injection, and PHI-safe logging behavior before adding provider-heavy evals.
- **Outcome:** [`process/milestones/week-1/03-presearch-checklist.md` §13](../../milestones/week-1/03-presearch-checklist.md#13-testing-strategy) now defines unit, integration, adversarial, and regression coverage without implementing tests or choosing an eval vendor.

## Trade-offs and alternatives

- **Add new audit findings** — rejected. Cluster 6 is synthesis-only; no new Security, Architecture, Data Quality, Compliance, or Performance finding was added to `AUDIT.md`.
- **Choose final LLM/provider/framework now** — deferred. Existing evidence constrains structured output, citations, latency, cost, and BAA/retention posture, but does not force a provider.
- **Implement tests now** — deferred. The testing strategy is now documented; fixtures, harnesses, benchmarks, and real user/ACL setups belong to Stage 4/5.
- **Resolve authorization roles abstractly** — rejected. Read-permission scoping still requires Stage 4/5 tests with concrete OpenEMR ACL users before claiming physician/nurse/resident behavior.

## Tools, dependencies, commands

No installs, schema changes, data imports, runtime benchmarks, or test implementation. Work was documentation synthesis over the current `AUDIT.md`, presearch checklist, Stage 3 pointer, and prior Cluster 5 journal.

## Files touched

- **Modified:** `Documentation/AgentForge/process/milestones/week-1/03-presearch-checklist.md` (§7, §8, §11, §13).
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/06-stage3-audit.md` (Cluster 6 status → Done; status checklist ticked).
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T0237-cluster-6-failure-testing.md` (this file).

## Outcomes

Cluster 6 is complete. The presearch checklist now has a synthesized failure-mode plan and testing strategy that preserves the audit evidence: source-attributed degradation, staged retrieval, PHI-safe observability, authorization-path separation, synthetic-first evals, and regression gates for missing/conflicting/unauthorized chart states.

## Open threads preserved

- Final read architecture remains open until Stage 4/5 measures REST/FHIR-shaped reads against module/internal-service reads.
- Final LLM/provider/framework remains open until latency, token, structured-output, cost, and BAA/retention constraints are measured and approved.
- Authorization read-permission scoping remains open until concrete OpenEMR ACL users are tested.
- Real-PHI usage remains blocked until provider BAA, logging, retention, purge, and breach-response posture is documented.
- Stage 4 `USERS.md` and Stage 5 `ARCHITECTURE.md` were not created.

## Next steps

- [ ] **Cluster 7:** finalize deployment/operations, iteration planning, release/open-source close-out, and any remaining monitoring/retention notes.
- [ ] **Stage 4/5 measurement:** define the exact v1 chart bundle, import/select augmented synthetic patients, and measure REST/FHIR vs internal/module read latency, payload bytes, token budgets, and authorization/audit metadata.
- [ ] **Cluster 8:** write the executive summary and cross-link sweep after remaining synthesis/status work is complete.

## Links

- Hard-gate deliverable: [`AUDIT.md`](../../../../../AUDIT.md)
- Process pointer for Stage 3: [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md)
- Presearch checklist: [`process/milestones/week-1/03-presearch-checklist.md`](../../milestones/week-1/03-presearch-checklist.md)
- Prior performance audit: [`0428-T0225-cluster-5-performance-audit.md`](0428-T0225-cluster-5-performance-audit.md)
