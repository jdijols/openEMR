---
date: 2026-04-28
topic: Cluster 2 — Architecture audit
related_milestone: process/06-stage3-audit.md
---

# Cluster 2 — Architecture audit — session journal

## Goal

Document how OpenEMR is organized, where v1 chart data lives, how browser/API layers interact, and which integration surfaces are plausible for adding a read-only AgentForge clinical co-pilot.

## Context

Cluster 1.5 locked the v1 persona as adult PCP / family medicine, non-emergent visits, returning patients with rich charts, while establishing that bundled demo data is insufficient as-is. Cluster 2 therefore audited architecture only: no security/compliance conclusions beyond handoffs, no full data-quality work, and no attempt to solve data augmentation.

## Key decisions

### Decision: Treat `interface/globals.php` as the runtime bridge AgentForge must respect

- **Prompt:** "Document how the existing OpenEMR system is organized, where data lives, how the layers interact..."
- **Recommendation:** Frame OpenEMR as a hybrid system: modern PSR-4 services and API code in `src/`, legacy browser pages in `interface/`, legacy helpers in `library/`, all converging through `interface/globals.php` for site/session/database/auth/module setup.
- **Outcome:** [`AUDIT.md` §Architecture-1](../../../../AUDIT.md#architecture-1-openemr-is-a-hybrid-legacymodern-system-with-interfaceglobalsphp-as-the-shared-runtime-bridge) landed; presearch §5 now favors a small custom orchestration layer first instead of premature framework complexity.

### Decision: Model "chart" as an explicit aggregation, not a native OpenEMR object

- **Prompt:** "Where data lives — Core tables/resources relevant to the v1 persona..."
- **Recommendation:** Record the v1 chart as distributed sources: `patient_data`, `form_encounter`, `lists`, `prescriptions`, `form_vitals`/`forms`, procedure order/report/result tables, documents, and users/providers, with service/FHIR adapters layered on top.
- **Outcome:** [`AUDIT.md` §Architecture-2](../../../../AUDIT.md#architecture-2-chart-data-for-the-v1-pcp-persona-is-distributed-across-clinical-tables-and-servicefhir-adapters-not-a-single-chart-summary-object) landed; presearch §7 now lists deterministic chart-reader tools and a source-pack/citation builder.

### Decision: Prefer REST/FHIR as the read boundary, but keep an identifier-normalization layer

- **Prompt:** "Integration points for new capabilities... REST/FHIR API consumer..."
- **Recommendation:** Use REST/FHIR where practical because it is the cleanest read boundary and easiest extraction path, but do not assume it is uniform. Standard routes mix `puuid` and numeric `pid`/`eid`; FHIR resources are cleaner but composite and category-sensitive.
- **Outcome:** [`AUDIT.md` §Architecture-3](../../../../AUDIT.md#architecture-3-restfhir-apis-provide-the-cleanest-read-boundary-but-identifier-and-resource-coverage-are-uneven-across-standard-and-fhir-routes) landed; presearch §7 now explicitly calls out identifier normalization and FHIR category/code filtering.

### Decision: Recommend a custom module for the v1 embedded demo path

- **Prompt:** "Recommend the most plausible integration path for v1, but only as far as architecture evidence supports."
- **Recommendation:** Choose an OpenEMR custom module as the strongest in-repo v1 path because the repo has first-class module bootstrap, namespace loading, menu/page-heading hooks, REST/FHIR route extension events, and active-module access checks. Keep API-only extraction as a design constraint, not the immediate demo surface.
- **Outcome:** [`AUDIT.md` §Architecture-4](../../../../AUDIT.md#architecture-4-custom-modules-plus-event-hooks-are-the-most-plausible-in-repo-integration-path-for-a-v1-embedded-read-only-co-pilot) landed; presearch §15 now has a partial hosting/rollback answer based on module architecture.

## Trade-offs and alternatives

- **Pure external API consumer only** — still attractive for long-term separation and licensing/testability, but weaker for the course demo because it does not give an embedded OpenEMR UX without an additional frontend or module.
- **Core `/src` service addition first** — rejected for v1 because it couples AgentForge-specific code to core OpenEMR before the product boundary is proven; service additions remain possible if later upstream-quality abstractions emerge.
- **Full agent framework selection now** — deferred. Architecture evidence supports deterministic chart tools first; Cluster 4/5 still need to clarify verification, eval, latency, and graceful degradation.

## Tools, dependencies, commands

No installs, schema changes, or runtime mutations. Work was read-only source inspection plus documentation edits.

Reviewed representative paths: `composer.json`, `public/index.php`, `src/BC/FallbackRouter.php`, `interface/globals.php`, `apis/dispatch.php`, `src/RestControllers/`, `apis/routes/`, `src/Core/ModulesApplication.php`, `src/Core/ModulesClassLoader.php`, `src/Services/`, `src/Services/FHIR/`, `sql/database.sql`, `interface/patient_file/summary/`, and existing custom-module examples.

## Files touched

- **Modified:** `AUDIT.md` (added `Architecture-1` through `Architecture-4`; added Architecture methodology in Appendix A).
- **Modified:** `Documentation/AgentForge/process/03-presearch-checklist.md` (§5 Agent Framework Selection, §7 Tool Design, partial §15 Deployment & Operations).
- **Modified:** `Documentation/AgentForge/process/06-stage3-audit.md` (Cluster 2 status → Done; status checklist ticked).
- **Created/modified:** `Documentation/AgentForge/process/journal/week-1/0428-T0131-cluster-2-architecture-audit.md` (this file; later postscript added after a clarification pass).

## Outcomes

Cluster 2 is complete. AgentForge now has an architecture-grounded v1 direction: embedded OpenEMR custom module for demo practicality, REST/FHIR-shaped read boundary for extraction and tests, deterministic chart-reader tools over distributed sources, and no premature multi-agent framework.

## Open threads preserved

- Conversation-vs-cards interface shape remains open for Cluster 6.
- Authorization read-permission scoping remains open for Cluster 3.
- Speed-vs-completeness remains open for Cluster 5 / Cluster 6.
- Demo-data + BAA acknowledgment remains open for Cluster 3/4.
- Verification claim categories remain open for Cluster 4.
- Graceful degradation remains open for Cluster 4 / Cluster 6.

## Next steps

- [ ] **Cluster 3:** Security + Compliance audit, especially read-permission scoping, API/module auth implications, PHI logging, BAA/provider boundaries, and GPL/release posture refinement.
- [ ] **Cluster 4:** Full Data Quality + Verification + Eval; decide Synthea vs hand-curated vs hybrid data augmentation using the architecture chart-source map.
- [ ] **Cluster 5:** Performance audit; measure whether REST/FHIR/service chart aggregation can satisfy between-rooms latency.

## Postscript: keeping the architecture audit legible

After the formal Cluster 2 write-up, the user asked to slow down and explain the architecture in beginner terms, then requested that those plain-language takeaways land in the correct files without blurring current-state audit content and forward-looking build planning.

- **Prompt:** "The audit file is about what is currently there in the openEMR application. The Presearch checklist file is about what we would build going forward, so separate what we just talked about into the correct files properly."
- **Recommendation:** Add a short `AUDIT.md` Architecture takeaway that explains what OpenEMR currently is: a legacy PHP app with modern `src/`/API/module layers added around it, bridged through `interface/globals.php`. Leave presearch unchanged because the existing §5/§7/§15 entries already capture the forward-looking build implications.
- **Outcome:** `AUDIT.md` §3 now includes an "Architecture takeaway" plus executive-summary candidates for the eventual Cluster 8 summary; no new presearch edits were needed in this clarification pass.

## Links

- Hard-gate deliverable: [`AUDIT.md`](../../../../AUDIT.md)
- Process pointer for Stage 3: [`process/06-stage3-audit.md`](../../06-stage3-audit.md)
- Presearch checklist: [`process/03-presearch-checklist.md`](../../03-presearch-checklist.md)
- Prior data spike: [`0428-T0118-cluster-1-5-demo-data-spike.md`](0428-T0118-cluster-1-5-demo-data-spike.md)
