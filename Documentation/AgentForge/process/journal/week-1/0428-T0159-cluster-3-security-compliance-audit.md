---
date: 2026-04-28
topic: Cluster 3 — Security + Compliance audit
related_milestone: process/06-stage3-audit.md
---

# Cluster 3 — Security + Compliance audit — session journal

## Goal

Document current OpenEMR authentication, session, authorization, PHI exposure, audit logging, compliance, and licensing behavior enough that Stage 4 `USERS.md` and Stage 5 `ARCHITECTURE.md` can trace back to evidence.

## Context

Cluster 1.5 locked the v1 persona as adult PCP / family medicine, non-emergent visits, returning patients with rich charts, and found the bundled demo data insufficient as-is. Cluster 2 established the architecture direction: OpenEMR is a legacy PHP app with modern service/API/module layers, `interface/globals.php` is the runtime bridge, and a custom module plus REST/FHIR-shaped read boundary is the most plausible v1 path. Cluster 3 stayed backward-looking: current Security + Compliance only, no final agent design.

## Key decisions

### Decision: Treat OpenEMR session context as security context, not convenience state

- **Prompt:** "How normal UI auth works... How session/site/patient context is established."
- **Recommendation:** Record the browser UI path as `interface/globals.php` + `library/auth.inc.php` + session/global context. Site id, user auth state, `pid`, and `encounter` are all established through the existing OpenEMR runtime, and an embedded copilot must not bypass that context.
- **Outcome:** [`AUDIT.md` §Security-1](../../../../AUDIT.md#security-1-browser-ui-authentication-and-chart-context-are-sessionglobal-driven) landed; presearch §3 and §12 now state that v1 chart reads must preserve the user's OpenEMR site/session/patient context.

### Decision: Separate OAuth scopes from clinical role policy

- **Prompt:** "How REST/FHIR/OAuth/API auth works... Any ambiguity around physician vs nurse vs resident read access."
- **Recommendation:** Document that the API pipeline verifies OAuth/local API access and resource scopes, but token subject roles collapse staff users to `users`. Physician/nurse/resident differences depend on OpenEMR ACL configuration and route/controller checks, not the bearer token role by itself.
- **Outcome:** [`AUDIT.md` §Security-2](../../../../AUDIT.md#security-2-restfhir-auth-is-oauth-scope-based-but-staff-job-roles-collapse-to-users) landed; authorization read-permission scoping remains an explicit open thread for Stage 4/5 test users.

### Decision: Keep FHIR patient binding and staff ACL checks distinct

- **Prompt:** "Where ACL checks happen for UI, REST, and FHIR."
- **Recommendation:** Record that generic FHIR reads run configured ACL checks for non-patient requests, while patient-context FHIR requests bind to a patient UUID and skip that controller ACL loop before filtering returned resources.
- **Outcome:** [`AUDIT.md` §Security-3](../../../../AUDIT.md#security-3-fhir-patient-context-reads-and-staff-acl-reads-follow-different-enforcement-paths) landed; presearch §12 now requires every v1 chart source to record its exact enforcement path.

### Decision: Treat logs as PHI stores unless proven otherwise

- **Prompt:** "Where PHI could leak through logs, API responses, documents, errors, generated summaries..."
- **Recommendation:** Document that OpenEMR's audit/API logs are useful compliance surfaces but can retain PHI-bearing data: HTTP query strings, SQL statements/binds, API JSON payloads, and generated summaries if AgentForge logs them.
- **Outcome:** [`AUDIT.md` §Security-4](../../../../AUDIT.md#security-4-current-logging-surfaces-can-retain-phi-rich-request-sql-and-api-payload-details), [`Compliance-1`](../../../../AUDIT.md#compliance-1-openemr-has-configurable-audit-logging-but-agent-reads-need-their-own-traceability-model), and [`Compliance-2`](../../../../AUDIT.md#compliance-2-external-llm-use-requires-a-phi-boundary-decision-before-any-real-chart-data-leaves-openemr) landed; presearch §12 and §15 now require PHI-safe observability.

### Decision: Make retention and breach response a separate compliance finding

- **Prompt:** "Audit logging requirements, data retention policies, breach notification obligations..."
- **Recommendation:** Add a dedicated finding because the earlier pass mentioned retention and breach response as implications but did not explicitly audit current OpenEMR support. Current OpenEMR has durable audit/API log tables and tamper-review UI, but no AgentForge-specific retention schedule, purge workflow, or breach-notification process for LLM-bound PHI artifacts.
- **Outcome:** [`AUDIT.md` §Compliance-3](../../../../AUDIT.md#compliance-3-current-audit-tables-support-traceability-and-tamper-review-but-do-not-define-an-agentforge-retention-policy) landed; presearch §3, §12, and §15 now call out artifact retention, purge, and breach-response handoffs.

### Decision: Keep GPL posture narrow and evidence-based

- **Prompt:** "GPL/licensing posture only as it relates to integration shape and release plan."
- **Recommendation:** Record only the practical release constraint: this fork is GPLv3, in-repo/module code should be treated as GPLv3-compatible, and a later separately licensed service would need true API-only separation and legal review.
- **Outcome:** [`AUDIT.md` §Compliance-4](../../../../AUDIT.md#compliance-4-gplv3-constrains-release-shape-for-in-repomodule-integration) landed; presearch §14 now reflects the refined release posture.

## Trade-offs and alternatives

- **Do a full security vulnerability scan now** — rejected for this cluster because the user asked for current auth/compliance behavior that informs AgentForge, not a general OpenEMR pentest.
- **Solve authorization policy now** — deferred. The audit can identify where ACL, OAuth scope, and patient binding happen, but physician/nurse/resident read policy belongs to Stage 4/5 once concrete chart-read paths and test users exist.
- **Make BAA/provider decisions now** — deferred. The audit establishes that real PHI cannot leave OpenEMR without BAA/retention/training-data decisions, but provider selection is outside Cluster 3.

## Tools, dependencies, commands

No installs, schema changes, runtime mutations, or exploit testing. Work was read-only source inspection plus documentation edits.

Reviewed representative paths: `interface/globals.php`, `library/auth.inc.php`, `src/Common/Auth/AuthUtils.php`, `src/Common/Session/SessionUtil.php`, `src/Common/Session/PatientSessionUtil.php`, `src/RestControllers/ApiApplication.php`, `src/RestControllers/Subscriber/SiteSetupListener.php`, `src/RestControllers/Subscriber/AuthorizationListener.php`, `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php`, `src/Common/Http/HttpRestRouteHandler.php`, `src/RestControllers/FHIR/FhirGenericRestController.php`, `src/RestControllers/Config/RestConfig.php`, `src/Common/Auth/UuidUserAccount.php`, `src/Common/Logging/EventAuditLogger.php`, `src/RestControllers/Subscriber/ApiResponseLoggerListener.php`, `src/Common/Logging/Audit/LogTablesSink.php`, `library/globals.inc.php`, and `LICENSE`.

## Files touched

- **Modified:** `AUDIT.md` (added `Security-1` through `Security-4`, `Compliance-1` through `Compliance-4`, Security/Compliance methodology, and references).
- **Modified:** `Documentation/AgentForge/process/03-presearch-checklist.md` (§3 Reliability Requirements, §12 Security Considerations, §14 Open Source Planning, §15 Deployment & Operations).
- **Modified:** `Documentation/AgentForge/process/06-stage3-audit.md` (Cluster 3 status → Done; status checklist ticked).
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T0159-cluster-3-security-compliance-audit.md` (this file).

## Outcomes

Cluster 3 is complete. AgentForge now has evidence-backed constraints for UI session inheritance, API/OAuth/FHIR authorization, ACL handoffs, PHI-bearing logs, agent read-audit needs, retention/purge/breach-response gaps, BAA/provider gating, and GPLv3 release posture.

## Open threads preserved

- Authorization read-permission scoping remains open for Stage 4/5 test-user design.
- Demo-data + BAA acknowledgment remains open: synthetic/demo data can support course work, but real PHI requires provider/BAA decisions.
- Graceful degradation remains open for Cluster 4 / Cluster 6.
- Verification claim categories remain open for Cluster 4.
- Speed-vs-completeness remains open for Cluster 5 / Cluster 6.
- Conversation-vs-cards interface shape remains open for Cluster 6.

## Next steps

- [ ] **Cluster 4:** Full Data Quality + Verification + Eval; decide Synthea vs hand-curated vs hybrid data augmentation and map claim categories to source/audit paths.
- [ ] **Cluster 5:** Performance audit; measure whether REST/FHIR/service chart aggregation can satisfy between-rooms latency.
- [ ] **Cluster 6:** Synthesize prior findings into demo implementation planning without reopening resolved audit scope.

## Links

- Hard-gate deliverable: [`AUDIT.md`](../../../../AUDIT.md)
- Process pointer for Stage 3: [`process/06-stage3-audit.md`](../../06-stage3-audit.md)
- Presearch checklist: [`process/03-presearch-checklist.md`](../../03-presearch-checklist.md)
- Prior architecture audit: [`0428-T0131-cluster-2-architecture-audit.md`](0428-T0131-cluster-2-architecture-audit.md)
