---
date: 2026-04-28
topic: Cluster 4 — Data Quality + Verification + Eval audit
related_milestone: process/milestones/week-1/06-stage3-audit.md
---

# Cluster 4 — Data Quality + Verification + Eval audit — session journal

## Goal

Finish the Stage 3 Data Quality audit for the adult PCP returning-patient AgentForge scope, then translate current OpenEMR data-shape evidence into verification and eval constraints without designing the final agent.

## Context

Cluster 1.5 showed the bundled OpenEMR demo dataset is insufficient as-is: 3 patients, 1 encounter each, stale 2014 activity, placeholder SOAP notes, no labs, no immunizations, no clinical notes, no documents, and no longitudinal returning-patient chart. Cluster 2 mapped OpenEMR's chart sources and integration path at an architecture level. Cluster 3 established security/compliance constraints around session inheritance, OAuth/ACL paths, PHI-bearing logs, retention, BAA posture, and GPLv3. Cluster 4 stayed focused on data quality, source attribution, verification, and eval ground truth only.

## Key decisions

### Decision: Treat chart facts as source-family specific

- **Prompt:** "Concrete chart sources for the adult PCP returning-patient persona."
- **Recommendation:** Record that adult PCP facts come from multiple source families with different identifiers and status semantics: demographics/care team, encounters, `lists`, `prescriptions`, vitals/forms, procedure/lab tables, notes/documents, history, and immunizations.
- **Outcome:** [`AUDIT.md` §DataQuality-2](../../../../../AUDIT.md#dataquality-2-adult-pcp-chart-facts-come-from-multiple-source-families-with-different-identifiers-statuses-and-freshness-semantics) landed; presearch §7 now requires source packs that preserve table/resource, row id, field, status, freshness, retrieval path, and authorization path.

### Decision: Make missing/stale/conflicting data a correctness target

- **Prompt:** "Missing/empty/stale/conflicting data failure modes."
- **Recommendation:** Treat empty labs/notes/history, stale dates, inactive medication rows, uncoded problems, and conflicting medication sources as normal current behavior. Eval cases must check that the system says what is missing or conflicting instead of inferring around it.
- **Outcome:** [`AUDIT.md` §DataQuality-3](../../../../../AUDIT.md#dataquality-3-missing-empty-stale-and-conflicting-chart-states-are-normal-current-behavior-not-edge-cases) landed; presearch §9 and §10 now include empty, stale, inactive, uncoded, and conflict fixtures.

### Decision: Do not rely on FHIR Provenance as the whole citation layer

- **Prompt:** "Claim categories that must be source-attributed."
- **Recommendation:** Use FHIR as a useful read boundary, but require AgentForge's own source pack for clinician-grade citations because OpenEMR Provenance is synthesized, often organization-shaped, and does not consistently identify the underlying source field/row enough for eval.
- **Outcome:** [`AUDIT.md` §DataQuality-4](../../../../../AUDIT.md#dataquality-4-fhir-helps-source-attribution-but-does-not-provide-sufficient-provenance-by-itself) landed; presearch §10 now says FHIR resource ids are acceptable only when paired with internal source pointers.

### Decision: Choose hybrid Synthea plus curated fixtures

- **Prompt:** "Synthea vs hand-curated vs hybrid augmentation decision evidence."
- **Recommendation:** Use Synthea import for synthetic longitudinal chart substrate and hand-curate a small adult PCP golden set for expected answers, citations, uncertainty, and known conflicts. Synthea alone populates tables but does not create AgentForge ground truth; hand-curation alone is controllable but too narrow for table/path breadth.
- **Outcome:** [`AUDIT.md` §DataQuality-5](../../../../../AUDIT.md#dataquality-5-eval-ground-truth-requires-hybrid-synthetic-plus-curated-augmentation) landed; presearch §1, §7, and §9 now state the hybrid augmentation direction.

## Trade-offs and alternatives

- **Run Synthea import immediately** — deferred. Cluster 4 needed audit evidence and design constraints; generating/importing new data belongs to the later demo/eval implementation step.
- **Use bundled demo data as the eval corpus** — rejected for success cases because it has no longitudinal adult PCP substrate. Kept only for missing/empty-path tests.
- **Use FHIR-only citations** — rejected as insufficient because current OpenEMR provenance is synthesized and uneven across resources.
- **Design final UX or agent orchestration now** — deferred per scope. Conversation-vs-cards, speed-vs-completeness, and graceful-degradation wording remain later decisions.

## Tools, dependencies, commands

No installs, schema changes, data imports, or runtime mutations. Work was source inspection, documentation edits, and read-only SQL against the current easy-dev database.

Read-only SQL commands used Docker easy-dev with:

`docker compose -f docker/development-easy/docker-compose.yml exec -T openemr mysql -h mysql -u openemr -popenemr openemr -e "<SELECT queries>"`

Reviewed representative paths: `sql/database.sql`, `CONTRIBUTING.md`, `src/Services/ConditionService.php`, `src/Services/AllergyIntoleranceService.php`, `src/Services/PrescriptionService.php`, `src/Services/VitalsService.php`, `src/Services/ProcedureService.php`, `src/Services/ClinicalNotesService.php`, `src/Services/SocialHistoryService.php`, `src/Services/FHIR/*`, `src/Services/Cda/CdaTemplateParse.php`, `interface/modules/zend_modules/module/Carecoordination/src/Carecoordination/Model/CarecoordinationTable.php`, and `tests/Tests/Fixtures/`.

## Files touched

- **Modified:** `AUDIT.md` (added `DataQuality-2` through `DataQuality-5`; expanded Data Quality methodology).
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/03-presearch-checklist.md` (§1, §7, §9, §10).
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/06-stage3-audit.md` (Cluster 4 status → Done; status checklist ticked).
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T0210-cluster-4-data-quality-eval.md` (this file).

## Outcomes

Cluster 4 is complete. AgentForge now has evidence-backed constraints for concrete adult PCP chart sources, claim categories requiring citation, missing/stale/conflicting data failure modes, FHIR provenance limitations, hybrid synthetic-plus-curated augmentation, and eval ground-truth requirements.

## Open threads preserved

- Graceful-degradation wording remains open for Cluster 6, but the data states it must handle are now enumerated.
- Authorization read-permission scoping remains open for Stage 4/5 test-user design.
- Demo-data + BAA acknowledgment remains open: synthetic/demo data can support course work, but real PHI still requires provider/BAA decisions.
- Speed-vs-completeness remains open for Cluster 5 / Cluster 6.
- Conversation-vs-cards interface shape remains open for Cluster 6.

## Next steps

- [ ] **Cluster 5:** Performance audit; measure whether REST/FHIR/service chart aggregation can satisfy between-rooms latency.
- [ ] **Cluster 6:** Synthesize security, architecture, data-quality, eval, and performance findings into demo implementation planning.
- [ ] **Later eval implementation:** Import/inspect a small Synthea cohort, select 2-3 adult returning patients, and hand-author golden fixtures with expected claims and required citations.

## Links

- Hard-gate deliverable: [`AUDIT.md`](../../../../../AUDIT.md)
- Process pointer for Stage 3: [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md)
- Presearch checklist: [`process/milestones/week-1/03-presearch-checklist.md`](../../milestones/week-1/03-presearch-checklist.md)
- Prior security/compliance audit: [`0428-T0159-cluster-3-security-compliance-audit.md`](0428-T0159-cluster-3-security-compliance-audit.md)
