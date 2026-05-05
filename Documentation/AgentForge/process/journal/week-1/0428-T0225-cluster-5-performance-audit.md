---
date: 2026-04-28
topic: Cluster 5 — Performance audit
related_milestone: process/milestones/week-1/06-stage3-audit.md
---

# Cluster 5 — Performance audit — session journal

## Goal

Finish the Stage 3 Performance audit for the adult PCP returning-patient AgentForge scope, focusing only on current OpenEMR performance/data-access behavior and what it implies for response latency. Do not design the final agent yet.

## Context

Cluster 2 established OpenEMR as a hybrid legacy/modern app with `interface/globals.php`, REST/FHIR, services, and custom modules as integration surfaces. Cluster 3 established PHI/auth/audit constraints. Cluster 4 showed chart facts are fragmented and require source-specific verification. Cluster 5 asked whether those current paths can plausibly support a between-rooms physician workflow and what must be measured before choosing a final read architecture.

## Key decisions

### Decision: Treat chart context as a bounded performance bundle

- **Prompt:** "Likely bottlenecks for retrieving adult PCP chart context."
- **Recommendation:** Record that OpenEMR has no single cheap chart-summary read; the v1 context requires a bounded multi-source bundle across demographics, encounters, lists, prescriptions, vitals, labs, notes/documents, and history. Unbounded reads are the primary latency risk.
- **Outcome:** [`AUDIT.md` §Performance-1](../../../../../AUDIT.md#performance-1-adult-pcp-chart-context-is-currently-a-multi-read-aggregation-not-a-single-low-latency-chart-summary) landed; presearch §2 now frames expected query volume and latency as source-bundle measurements.

### Decision: Identify query amplification before API preference

- **Prompt:** "Query shape and join complexity for encounters, problems, allergies, meds, vitals, labs, notes/documents, and history."
- **Recommendation:** Capture the wide joins, medication union, vitals/detail fan-out, lab procedure/report/result lineage, and PHP hydration/dedup behavior before deciding REST/FHIR vs internal services. The final answer may be short, but retrieval work can still be large.
- **Outcome:** [`AUDIT.md` §Performance-2](../../../../../AUDIT.md#performance-2-chart-relevant-service-queries-use-wide-joins-unions-and-one-to-many-hydration-that-can-grow-faster-than-the-final-summary) landed; presearch §7 now requires explicit bounds and performance-envelope reporting on tool results.

### Decision: Keep REST/FHIR as a measured trade-off, not an assumption

- **Prompt:** "REST/FHIR vs internal service/query performance trade-offs."
- **Recommendation:** Preserve REST/FHIR as the cleaner security/extraction boundary, but document the per-call API bootstrap, FHIR serialization, per-resource filtering, and uneven pagination behavior that could hurt latency. Internal service calls may be faster but must prove authorization and audit parity.
- **Outcome:** [`AUDIT.md` §Performance-3](../../../../../AUDIT.md#performance-3-restfhir-is-cleaner-as-a-boundary-but-adds-per-resource-overhead-and-uneven-pagination-behavior) landed; presearch §2 and §6 now require measuring the same chart bundle through candidate read boundaries.

### Decision: Defer model choice until payload/context measurements exist

- **Prompt:** "Fill presearch §6 LLM Selection only as far as performance/context-window evidence supports."
- **Recommendation:** Do not pick GPT/Claude/open-source yet. The evidence only supports measuring bytes/tokens by source family, especially notes/documents, FHIR bundles, and broad Observation reads, then selecting a model that fits latency, structured-output, citation, and compliance constraints.
- **Outcome:** [`AUDIT.md` §Performance-4](../../../../../AUDIT.md#performance-4-payload-and-context-window-risk-comes-from-wide-clinical-rows-documents-fhir-wrappers-and-observation-expansion) landed; presearch §6 now contains performance/context-window constraints without selecting a model.

### Decision: Make observability PHI-minimized from the start

- **Prompt:** "Caching/precomputation opportunities and risks, especially PHI/cache invalidation. What must be measured before choosing final architecture."
- **Recommendation:** Current OpenEMR logging/audit settings can store PHI-bearing API responses and SQL/request details, while the reviewed cache surfaces are not chart-summary caches. Measurement and caching must record timings, counts, ids, and errors without storing full chart text by default.
- **Outcome:** [`AUDIT.md` §Performance-5](../../../../../AUDIT.md#performance-5-caching-and-observability-can-improve-latency-but-are-phi-sensitive-and-invalidation-heavy) landed; presearch §8 now defines latency, payload, LLM, cache, and safety metrics.

## Trade-offs and alternatives

- **Run benchmarks now** — deferred. Source evidence was enough to identify the required measurement plan; runtime benchmarking belongs to Stage 4/5 once the candidate chart bundle and augmented data exist.
- **Commit to REST/FHIR-only reads now** — deferred. REST/FHIR remains attractive, but current overhead and pagination behavior must be measured against an internal/module read path.
- **Use a huge-context model to avoid retrieval shaping** — rejected as a performance shortcut. Large context does not solve PHI minimization, latency, cost, or citation quality.
- **Cache chart summaries early** — deferred. Caching may help, but PHI scope, permission scoping, invalidation, and retention must be designed before any persisted chart cache exists.

## Tools, dependencies, commands

No installs, schema changes, data imports, or runtime benchmarks. Work was read-only source inspection and documentation edits.

Reviewed representative paths: `src/Services/EncounterService.php`, `src/Services/BaseService.php`, `src/Services/PrescriptionService.php`, `src/Services/VitalsService.php`, `src/Services/ProcedureService.php`, `src/Services/AllergyIntoleranceService.php`, `src/Services/SocialHistoryService.php`, `src/Services/ClinicalNotesService.php`, `src/Services/DocumentService.php`, `src/Services/PatientService.php`, `src/Services/FHIR/*`, `src/RestControllers/*`, `src/Common/Logging/*`, `library/sql.inc.php`, `library/ADODB_mysqli_log.php`, `library/translation.inc.php`, and `sql/database.sql`.

## Files touched

- **Modified:** `AUDIT.md` (added `Performance-1` through `Performance-5`; expanded Performance methodology).
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/03-presearch-checklist.md` (§2, §6, §7, §8).
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/06-stage3-audit.md` (Cluster 5 status → Done; status checklist ticked).
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T0225-cluster-5-performance-audit.md` (this file).

## Outcomes

Cluster 5 is complete. AgentForge now has evidence-backed performance constraints for chart-source aggregation, REST/FHIR overhead, service query amplification, context-window sizing, PHI-safe observability, caching risk, and the measurements required before final architecture selection.

## Open threads preserved

- Speed-vs-completeness remains open for Cluster 6, but the measurements needed to decide it are now listed.
- Conversation-vs-cards interface shape remains open for Cluster 6.
- Graceful-degradation wording remains open, with performance timeouts/partial-source states now added to the inputs.
- Authorization read-permission scoping remains open for Stage 4/5 test-user design.
- Demo-data + BAA acknowledgment remains open: synthetic/demo data can support performance/eval work, but real PHI still requires provider/BAA decisions.

## Next steps

- [ ] **Cluster 6:** Synthesize security, architecture, data-quality, eval, and performance findings into demo implementation planning without adding new audit findings.
- [ ] **Stage 4/5 measurement:** define the exact v1 chart bundle, import/select augmented synthetic patients, and measure REST/FHIR vs internal/module read latency, payload bytes, and token budgets.
- [ ] **Cluster 8:** write the executive summary and cross-link sweep after remaining synthesis/status work is complete.

## Links

- Hard-gate deliverable: [`AUDIT.md`](../../../../../AUDIT.md)
- Process pointer for Stage 3: [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md)
- Presearch checklist: [`process/milestones/week-1/03-presearch-checklist.md`](../../milestones/week-1/03-presearch-checklist.md)
- Prior data-quality/eval audit: [`0428-T0210-cluster-4-data-quality-eval.md`](0428-T0210-cluster-4-data-quality-eval.md)
