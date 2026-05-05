# **Review Checklist by Zachery Smith**

> **How to use:** Fill answers in this file as you go, or keep this as a clean template and capture long answers in `03b-presearch-notes.md` (or dated files under `journal/`). Complete before writing production agent code; save AI conversations as reference where helpful.

**Pre-Search Checklist**

Complete this before writing code. Save your AI conversation as a reference document.

## **Phase 1: Define Your Constraints**

### **1\. Domain Selection**

_**Persona target locked** by the Cluster 1.5 spike (2026-04-28). The persona shape below holds; **the bundled OpenEMR demo dataset does not support it as shipped** — see [→ AUDIT.md §DataQuality-1](../../../../../AUDIT.md#dataquality-1-persona-viability--adult-pcp-returning-patient-demo-coverage). Cluster 4 resolved the augmentation direction as **hybrid Synthea + hand-curated eval fixtures**; data augmentation remains a hard prerequisite before verification/eval implementation and Cluster 6 demo work. Persona shape itself was not the problem; the substrate was._

* Which domain: healthcare, insurance, finance, legal, or custom?
  * **Healthcare** — clinical copilot embedded in this OpenEMR fork.

* What specific use cases will you support?
  * **v1 persona: adult primary care physician (family medicine).** Chosen because the case study scenario explicitly describes ambulatory rooming flow ("between patient rooms"), returning patients ("what changed since the last visit"), and rich existing records ("dense EHR notes... lab results... medication lists"). Pediatric and ED variants reserved for later iterations.
  * **v1 visit-type scope:** common, non-emergent appointments — annual physicals, simple acute visits (flu, earache, throat infection, uncomplicated URI), and routine stable-chronic-disease follow-ups (HTN, T2DM, hyperlipidemia at stable doses). **Excludes:** ED / urgent care, specialist consults, complex polypharmacy, oncology, mental-health-only encounters.
  * **v1 workflow:** physician between rooms uses the agent to recall who the patient is, what changed since the last visit, what's on file, and what matters today — using the prior chart as the rich substrate the case study scenario is built around.
  * **Why not pediatric well-child:** attractive in theory (lower acuity, structured vaccine/screening substrate) but the bundled demo has no immunizations, no longitudinal pediatric charts, and no growth data. Adult PCP is the demo-realistic version of the same low-risk story (low-acuity scoped visit types + a longitudinal record once augmented).
  * **Cluster 1.5 outcome (2026-04-28):** the bundled `dev-reset-install-demodata` ships **3 patients, 1 encounter each, all dated 2014-02-01**, with placeholder SOAP narratives, no labs at any layer, no clinical notes, no immunizations, ICD9-coded problems, and **0 patients meeting the ≥2-visits threshold** the persona requires. Full evidence in [`AUDIT.md` §DataQuality-1](../../../../../AUDIT.md#dataquality-1-persona-viability--adult-pcp-returning-patient-demo-coverage). Implication: nothing downstream of this line can produce a meaningful demo or eval against the bundled dataset alone — data augmentation remains a prerequisite before verification/eval implementation and demo work.
  * Personas iterate; pediatric, specialist, hospitalist, and ED variants reserved for later iterations.

* What are the verification requirements for this domain?
  * **Source attribution** on every factual claim (table + row, or document section).
  * **Domain-constraint enforcement** — outputs that contradict structured data are failures, not warnings.
  * **No fabrication of unobserved data** — empty fields are reported as such; never inferred.
  * **Cluster 4 claim categories:** identity/context, longitudinal change, allergies, active/stopped medications, problems/chronic conditions, vitals trends, labs/results, notes/documents, negative claims, and data-quality claims such as stale, uncoded, inactive/resolved, unsupported, or conflicting sources. Full verification shape is in §10.

* What data sources will you need access to?
  * Adult PCP chart in OpenEMR: problem list, active medications, allergies, vitals trend, recent labs, recent encounters / notes, family + social history.
  * **TBD — Cluster 2 (Architecture audit):** concrete OpenEMR tables / FHIR resources / API surfaces.
  * **Cluster 1.5 outcome — bundled demo coverage of the above:** present-but-thin → problem list (Phil/Susan only), active meds (Phil/Susan), allergies (Phil only), single-row vitals (no trend); absent → labs at any layer, longitudinal encounters, modern clinical notes, immunizations, social-history fields. Cluster 4 chose hybrid Synthea + hand-curated eval fixtures for augmentation.
  * Out of scope for v1: imaging, external HIE feeds, pharmacy integrations.

### **2\. Scale & Performance**

* Expected query volume?
  * **v1 interaction shape:** one selected patient at a time, usually one chart-refresh / summary request when the physician is between rooms, followed by a small number of follow-up questions against the same patient context.
  * **Current OpenEMR implication:** a useful adult PCP context is not one cheap query. It likely touches 6-8 source families: patient identity/demographics, encounters, problems, allergies, medications/prescriptions, vitals, labs/results, notes/documents, and history/social history. Via REST/FHIR this can become many independent HTTP calls; via internal services it is fewer round-trips but still multiple DB queries and PHP hydration passes. See [→ AUDIT.md §Performance-1](../../../../../AUDIT.md#performance-1-adult-pcp-chart-context-is-currently-a-multi-read-aggregation-not-a-single-low-latency-chart-summary) and [§Performance-3](../../../../../AUDIT.md#performance-3-restfhir-is-cleaner-as-a-boundary-but-adds-per-resource-overhead-and-uneven-pagination-behavior).
  * **Do not assume batch scale yet:** the course/demo path can start with one active clinician session, but the architecture decision must be based on measured per-patient chart bundle latency before making claims about multi-clinician clinic load.

* Acceptable latency for responses?
  * **Workflow expectation:** "between patient rooms" implies the first useful response must arrive quickly enough to fit a rooming transition, not minutes later. Working budget for planning: first useful chart answer should target seconds, with source-specific fallbacks if slow sources exceed budget.
  * **Not finalized:** speed-vs-completeness remains an open Cluster 6 product decision, but Cluster 5 narrows the measurement requirement: report cold/warm retrieval latency, source-by-source latency, LLM latency, and end-to-end time-to-first-useful-answer before choosing final architecture.
  * **High-risk sources:** broad Observation reads, labs/procedure lineage, medications/prescriptions, notes/documents, and any route that retrieves full document or note text. See [→ AUDIT.md §Performance-2](../../../../../AUDIT.md#performance-2-chart-relevant-service-queries-use-wide-joins-unions-and-one-to-many-hydration-that-can-grow-faster-than-the-final-summary) and [§Performance-4](../../../../../AUDIT.md#performance-4-payload-and-context-window-risk-comes-from-wide-clinical-rows-documents-fhir-wrappers-and-observation-expansion).

* Concurrent user requirements?
  * **Demo requirement:** one authenticated clinician using one selected synthetic/demo patient at a time is enough for course demonstration.
  * **Production-shaped constraint:** do not design a cache or precomputation scheme that assumes a single user, single site, or static permissions. Any cache must be scoped by site, authenticated user/permission context, patient, source set, and retrieval timestamp, and must be invalidated or bypassed when chart facts or access rights change.
  * **Measurement before scale claims:** measure at least cold/warm single-user performance first; later multi-user load testing should include audit/API logging settings because those settings can add DB writes and PHI-bearing payload storage. See [→ AUDIT.md §Performance-5](../../../../../AUDIT.md#performance-5-caching-and-observability-can-improve-latency-but-are-phi-sensitive-and-invalidation-heavy).

* Cost constraints for LLM calls?
  * **No dollar budget selected yet.** Cost is currently a performance/context constraint: wide chart payloads, FHIR wrappers, notes/documents, and broad Observation bundles can inflate tokens before the LLM does any useful reasoning.
  * **Current requirement:** measure tokenized prompt size by source family and answer type before selecting model/context window. A larger context window is not a substitute for bounded retrieval, minimum-necessary PHI, source packs, and citations.
  * **Synthetic-only traces by default:** cost/latency experiments should use synthetic or redacted data unless the PHI/BAA/log-retention posture from §3/§12/§15 is resolved.

### **3\. Reliability Requirements**

_Cluster 3 filled the security/compliance baseline and Cluster 4 filled the verification/eval baseline. The trust boundary is explicit: v1 is read-only, every clinical claim must be attributable, and any real-PHI LLM path requires BAA/retention/logging decisions before data leaves OpenEMR._

* What's the cost of a wrong answer in your domain?
  * **Patient harm** in worst case (missed allergy, wrong dose context, fabricated history).
  * **Trust collapse** in average case — one confident hallucination flagged by a clinician kills adoption.
  * Both mitigated for v1 by **(i)** read-only advisory posture (see HITL — agent never writes to the chart) and **(ii)** visit-type scoping (low-acuity, non-emergent appointments per §1) so the blast radius of a wrong answer stays bounded even before the verification layer engages.

* What verification is non-negotiable?
  * Source attribution on every clinical claim (allergies, meds, vitals, labs).
  * Hard refusal when the structured data needed for a claim is missing.
  * Permission-aware retrieval: each chart read must preserve whether access came from UI session inheritance, user ACL, OAuth scope, or patient binding. See [→ AUDIT.md §Security-2](../../../../../AUDIT.md#security-2-restfhir-auth-is-oauth-scope-based-but-staff-job-roles-collapse-to-users) and [§Security-3](../../../../../AUDIT.md#security-3-fhir-patient-context-reads-and-staff-acl-reads-follow-different-enforcement-paths).
  * Source-rating policy (signed vs unsigned notes, pharmacy feed vs patient-reported list, etc.) — addressed in **Cluster 4 (Data Quality + Verification)**.

* Human-in-the-loop requirements?
  * **v1 = read-only, advisory.** Agent summarizes, surfaces, and answers questions; **never writes to the chart**. Clinician acts; agent informs.
  * Drafts-for-review and limited writes reserved as future product tiers — risk posture matches the v1 persona choice.

* Audit/compliance needs?
  * **HIPAA-shaped throughout:** access logging, minimum-necessary reads, PHI-safe logs, retention boundaries, and breach-response handoffs.
  * Agent read audit must record who accessed which patient/source set and when, without storing full prompts/responses/chart text by default. See [→ AUDIT.md §Compliance-1](../../../../../AUDIT.md#compliance-1-openemr-has-configurable-audit-logging-but-agent-reads-need-their-own-traceability-model).
  * External LLM calls against real PHI are blocked until BAA/provider retention/training-data posture is documented. Synthetic/demo data remains acceptable for course work if clearly labeled. See [→ AUDIT.md §Compliance-2](../../../../../AUDIT.md#compliance-2-external-llm-use-requires-a-phi-boundary-decision-before-any-real-chart-data-leaves-openemr).
  * Agent artifacts need a retention and breach-response policy before real PHI use: prompts, responses, source packs, eval traces, and provider payload logs are all PHI-bearing unless minimized. See [→ AUDIT.md §Compliance-3](../../../../../AUDIT.md#compliance-3-current-audit-tables-support-traceability-and-tamper-review-but-do-not-define-an-agentforge-retention-policy).

### **4\. Team & Skill Constraints**

* Familiarity with agent frameworks?
  * **None / minimal** — comfortable with LLM APIs, no production agentic-workflow build under the belt.
  * Bias toward **well-documented, tutorial-rich** frameworks; resist novelty. Framework choice in **Cluster 2 (Architecture)**.

* Experience with your chosen domain?
  * **Patient-side only** — MyChart-style portal use; no clinical or EHR-engineering background.
  * Lean heavily on the case study persona, OpenEMR's built-in conventions, and the [impressions doc](01-agentforge-impressions.md); avoid inventing clinical workflow without grounding.

* Comfort with eval/testing frameworks?
  * **None** — no LangSmith / Braintrust / Promptfoo experience.
  * **Build the eval harness early**, not as a bolt-on; the discipline matters more than the platform. Tooling selected in **Cluster 4 (Data Quality + Verification + Eval)**.

## **Phase 2: Architecture Discovery**

### **5\. Agent Framework Selection**

* LangChain vs LangGraph vs CrewAI vs custom?
  * **Architecture-informed direction:** favor a **small custom orchestration layer first**, not a broad multi-agent framework. OpenEMR already has a complex runtime boundary (legacy UI + `interface/globals.php` + modern services + REST/FHIR), so the early risk is reliable, source-attributed chart retrieval rather than agentic planning. See [→ AUDIT.md §Architecture-1](../../../../../AUDIT.md#architecture-1-openemr-is-a-hybrid-legacymodern-system-with-interfaceglobalsphp-as-the-shared-runtime-bridge) and [§Architecture-2](../../../../../AUDIT.md#architecture-2-chart-data-for-the-v1-pcp-persona-is-distributed-across-clinical-tables-and-servicefhir-adapters-not-a-single-chart-summary-object).
  * If a framework is added later, **LangGraph** is the leading candidate over CrewAI-style multi-agent orchestration because the use case is a deterministic read-only clinical workflow: retrieve chart facts, cite sources, verify claims, degrade gracefully. Cluster 5 clarified the latency measurements needed before final architecture selection; do not commit until Cluster 6 synthesizes the implementation plan.

* Single agent or multi-agent architecture?
  * **Single assistant / single orchestrator for v1.** The architecture evidence points to a chart-read + summarization workflow, not multiple autonomous agents. Any "tools" should be deterministic chart readers over FHIR/REST/services, not separate agents.

* State management requirements?
  * Minimal durable state in v1. Use OpenEMR's authenticated user/session/patient context at the UI or API boundary, but do not persist generated clinical summaries as chart data. Conversation memory shape remains open until the conversation-vs-cards decision is made in Cluster 6.
  * The agent should carry transient request state: selected patient, encounter context, source pointers, retrieval timestamps, and verification status. No PHI persistence decision here — Cluster 3 owns compliance/retention detail.

* Tool integration complexity?
  * **Moderate.** The core chart sources are split across `patient_data`, `form_encounter`, `lists`, `prescriptions`, `form_vitals`/`forms`, procedure/lab tables, documents, users/providers, and FHIR/REST adapters. The first engineering task is a narrow chart-snapshot tool boundary that normalizes identifiers and returns source-citable facts.

### **6\. LLM Selection**

* GPT-5 vs Claude vs open source?
  * **No model selected in Cluster 5.** Performance evidence only says model choice must wait until chart retrieval payload sizes, context-token budgets, and end-to-end latency are measured.
  * **Selection constraint:** prefer models/providers that can return reliable structured output and cite source-pack ids within the measured latency budget. If real PHI is used later, provider choice is gated by BAA/retention/training-data posture from §3/§12/§15, not by speed alone.

* Function calling support requirements?
  * Required for the likely v1 shape: deterministic chart-reader tools need structured arguments, bounded windows/counts, and structured returns with source ids. Function/tool calling performance should be measured as part of end-to-end latency, especially if multiple sequential chart reads are needed.

* Context window needs?
  * **TBD from measurement.** Current code evidence shows context risk from wide `patient_data` rows, medication/lab joins, document/clinical-note text, FHIR bundle wrappers, and Observation expansion. See [→ AUDIT.md §Performance-4](../../../../../AUDIT.md#performance-4-payload-and-context-window-risk-comes-from-wide-clinical-rows-documents-fhir-wrappers-and-observation-expansion).
  * Minimum requirement is enough room for a bounded source pack, a concise chart summary, the user's question, and citations. Do not choose a massive context model to compensate for unbounded chart retrieval.

* Cost per query acceptable?
  * Not yet set. Before setting a target, measure prompt/completion tokens for the main adult PCP questions: "what changed since last visit?", allergies before antibiotics, active vs stopped meds, BP/vitals trend, recent labs, and relevant notes/documents.
  * Track provider cost separately from OpenEMR retrieval cost; a cheap model call can still be unusable if REST/FHIR aggregation or PHI-safe logging dominates latency.

### **7\. Tool Design**

* What tools does your agent need?
  * **Patient context lookup:** resolve selected patient identifiers (`puuid`, numeric `pid`, and FHIR patient id as needed).
  * **Encounter timeline:** read recent encounters, dates, providers, reasons, and visit metadata from `form_encounter` / Encounter API/FHIR Encounter, with explicit count/date bounds.
  * **Problem/allergy/medication readers:** read typed `lists` rows (`medical_problem`, `allergy`) and prescriptions/list-medication sources without collapsing provenance; keep medication reads bounded because current service behavior uses a union and many lookup joins.
  * **Vitals trend reader:** read `form_vitals` through service/API/FHIR Observation paths and preserve date/form/encounter source; avoid broad "all Observations" calls unless measured.
  * **Labs/results reader:** traverse `procedure_order` → `procedure_report` → `procedure_result` (or FHIR Observation/DiagnosticReport with category/code/date filters), not a single "labs" table.
  * **Notes/documents reader:** default to metadata and targeted excerpts only where v1 needs them; full document retrieval is a separate high-payload operation.
  * **Source pack / citation builder:** return table/resource, row id/uuid, encounter/date, field, and retrieval path for every factual claim.
  * **Degradation gate:** compose tool results into an answer only when the required source pack is sufficient for the claim; otherwise return a partial answer with explicit unavailable, unauthorized, stale, unsupported, or conflicting source states.
  * **Performance envelope:** every tool should report elapsed time, row/item count, payload bytes, token estimate where available, cache status, and partial/timeout state without logging full PHI payloads by default.

* External API dependencies?
  * **Preferred boundary:** OpenEMR REST/FHIR APIs where they cover the needed chart slice. FHIR is attractive for standardized resources and patient-binding semantics; standard REST is useful for existing OpenEMR-specific resources but mixes `puuid` and numeric `pid` routes.
  * **In-repo demo boundary:** a custom module can call internal services or narrow read-only module routes, but should keep the data access layer shaped like an API consumer so later extraction remains plausible. See [→ AUDIT.md §Architecture-3](../../../../../AUDIT.md#architecture-3-restfhir-apis-provide-the-cleanest-read-boundary-but-identifier-and-resource-coverage-are-uneven-across-standard-and-fhir-routes) and [§Architecture-4](../../../../../AUDIT.md#architecture-4-custom-modules-plus-event-hooks-are-the-most-plausible-in-repo-integration-path-for-a-v1-embedded-read-only-copilot).

* Mock vs real data for development?
  * **Real OpenEMR chart reads are required for integration testing**, but the bundled demo data is insufficient for persona/eval work as-is (see `DataQuality-1`). Cluster 4 decision: use a **hybrid** approach — import a small synthetic Synthea cohort for longitudinal chart substrate, then hand-curate 2-3 adult PCP returning-patient cases with ground-truth questions, expected answers, citations, and known missing/conflicting facts. Existing demo data remains useful only for empty/missing-data behavior.

* Error handling per tool?
  * Return structured, source-aware failures: missing patient, no encounters, no labs/results, identifier mismatch, permission denied, upstream route unavailable, malformed response, and timeout. Do not silently infer absent facts.
  * Each tool result should distinguish **not found**, **not authorized**, **not implemented/unsupported source**, **source unavailable**, **stale**, **inactive/resolved**, **uncoded**, and **conflicting across sources**. Include the authorization path (`session/global`, user ACL, OAuth scope, patient binding, or module-internal inheritance), retryability, partial-result state, and safe user-facing message. Raw exceptions, SQL, PHI payloads, and provider details stay out of LLM prompts/logs unless explicitly approved for synthetic-only debugging.

### **8\. Observability Strategy**

* LangSmith vs Braintrust vs other?
  * **No final platform selected.** Cluster 5 only establishes constraints: traces may contain PHI if they include chart text, prompts, responses, source packs, or provider payloads, so any external observability/eval platform is blocked for real PHI until BAA/retention/logging posture is resolved.
  * **Near-term direction:** local/synthetic-first instrumentation is enough for Stage 4/5 architecture decisions. If LangSmith, Braintrust, or another tool is used later, store synthetic/redacted traces by default and keep real-PHI traces out unless explicitly approved.

* What metrics matter most?
  * End-to-end time-to-first-useful-answer and full-answer latency.
  * Retrieval latency by source family: patient, encounters, lists/problems/allergies, meds/prescriptions, vitals, labs/results, notes/documents, history.
  * SQL query count, DB time, hydrated row count, returned item count, and payload bytes per source.
  * REST/FHIR-specific metrics: number of HTTP calls, per-call bootstrap/auth time where measurable, response bytes, JSON parse/serialize time, pagination effectiveness, and API/audit logging overhead.
  * LLM metrics: prompt tokens, completion tokens, provider latency, tool-call round trips, cost, timeout/degradation rate, and citation coverage.
  * Failure/eval metrics: tool error class, retry count, ambiguity/clarification rate, degraded-answer rate by missing source family, unsupported-source count, authorization-denied count, and regression-fixture pass/fail by claim category.
  * Safety/ops metrics: permission-denied vs missing-data counts, partial-source responses, cache hits/misses, cache age, and PHI-minimized audit event success/failure.

* Real-time monitoring needs?
  * For demo: lightweight local timing and structured logs over synthetic data are sufficient.
  * For real PHI: operational logs must avoid full prompts, chart excerpts, API bodies, and generated summaries by default. Log source ids, route names, counts, timings, answer/session ids, and error classes instead. See [→ AUDIT.md §Performance-5](../../../../../AUDIT.md#performance-5-caching-and-observability-can-improve-latency-but-are-phi-sensitive-and-invalidation-heavy) and [§Security-4](../../../../../AUDIT.md#security-4-current-logging-surfaces-can-retain-phi-rich-request-sql-and-api-payload-details).
  * Alerting should cover slow/failed source readers, LLM/provider timeouts, repeated degraded answers, and unexpected API/audit logging configuration changes before production-like use.

* Cost tracking requirements?
  * Track LLM cost per patient question and per source bundle shape, not just per model call. Notes/documents and broad Observation/Lab requests should be separately visible because they can dominate tokens.
  * Track non-LLM cost proxies too: DB time, API call count, audit-log writes, payload bytes, and cache miss rate.
  * Store only minimized cost metadata for real PHI workflows; provider dashboards and trace exports must not become unreviewed PHI stores.

### **9\. Eval Approach**

* How will you measure correctness?
  * **Claim-level exactness, not vibe scoring.** Each generated answer is decomposed into clinical claims and checked against expected facts, required source ids, allowed uncertainty language, and forbidden inferences.
  * Primary pass/fail dimensions: factual correctness, source attribution on every clinical claim, missing-data handling, conflict handling, permission/error handling, and refusal/uncertainty when the chart cannot support the claim.
  * The evaluation unit should be a realistic adult PCP prompt over one patient chart, e.g. "What changed since the last visit?", "Any allergies I should know before antibiotics?", "How has BP trended?", "Any recent A1c/labs?", or "What is active vs stopped on the med list?"

* Ground truth data sources?
  * **Hybrid synthetic + curated ground truth.** Use Synthea import (`import-random-patients`) to create enough synthetic longitudinal OpenEMR charts, then hand-select 2-3 adult returning patients and author fixtures from the actual imported OpenEMR rows/resources.
  * Ground truth must cite the same concrete chart sources the tools read: `patient_data`, `form_encounter`, `lists`, `lists_medication`, `prescriptions`, `form_vitals`/`forms`, `procedure_order`/`procedure_report`/`procedure_result`, `form_clinical_notes`, `documents`, `history_data`, and `immunizations`, or the matching REST/FHIR resource plus internal source pointer.
  * The bundled demo dataset is **not** valid ground truth for longitudinal PCP success cases. It is retained as negative/empty-path ground truth only: no recent labs, no clinical notes, no documents, no immunizations, one encounter per patient, stale 2014 data.

* Automated vs human evaluation?
  * **Automated first:** deterministic assertions for required/forbidden claims, source id presence, citation count, and missing-data phrasing.
  * **Human review second:** manually inspect a small golden set for clinical reasonableness, confusing phrasing, and whether "changed since last visit" is useful to an adult PCP. Human review is required before treating a new eval category as reliable.
  * Do not use LLM-as-judge as the sole evaluator for clinical correctness. If used later, it should judge presentation quality or compare against already source-attributed ground truth, not invent truth from chart text.

* CI integration for eval runs?
  * Start with a small, deterministic eval fixture suite that can run locally against synthetic/non-PHI data. CI can run shape/source-attribution tests without needing real PHI or external LLM calls.
  * Keep provider/API evals optional and explicitly marked because they may incur cost and may produce PHI-like synthetic prompts/responses. Store only minimized outputs or redacted traces unless the artifact-retention policy from §12/§15 is implemented.
  * Regression threshold: no newly unsupported claim category, no uncited clinical claim, and no previously passing missing/conflict case can regress without an explicit fixture update.

### **10\. Verification Design**

* What claims must be verified?
  * **Identity/context claims:** patient name, age/DOB, sex, selected patient id, PCP/care-team/provider, encounter/date context.
  * **Longitudinal/change claims:** last visit date/reason/provider, new or resolved problems, medication starts/stops, changed vitals, new labs/results, new notes/documents since last encounter.
  * **Safety-critical chart claims:** allergies/intolerances and reactions; active vs stopped medications; problem list / chronic conditions; abnormal or missing recent labs; vitals trends relevant to HTN/diabetes/hyperlipidemia follow-up.
  * **Negative claims:** "no allergies documented", "no labs in the last 6 months", "no prior visit found", "no immunizations on file" require source-backed absence checks, not absence from retrieved context.
  * **Data-quality claims:** stale, uncoded, inactive/resolved, unsigned/unauthorized where available, source unsupported, and conflicting-source statements.

* Fact-checking data sources?
  * The canonical fact-checking sources are the exact OpenEMR tables/resources read by the tool boundary, not generated summaries. FHIR resources are acceptable read surfaces when they preserve the underlying OpenEMR row/resource id; FHIR Provenance is useful metadata but not sufficient as the only citation layer. See [→ AUDIT.md §DataQuality-4](../../../../../AUDIT.md#dataquality-4-fhir-helps-source-attribution-but-does-not-provide-sufficient-provenance-by-itself).
  * For each verified fact, keep a source pack: source family, table/resource, row UUID/id, patient id, encounter id/date where applicable, field name(s), status/activity/freshness fields, retrieval path, and authorization path from Cluster 3.
  * Labs/results must traverse order/report/result data or the equivalent FHIR Observation/DiagnosticReport resources; medication claims must preserve whether they came from `prescriptions` or `lists`/`lists_medication`.

* Confidence thresholds?
  * **High confidence:** exact structured source match with current/active status where relevant and no conflicting source of equal priority.
  * **Limited confidence:** source exists but is stale, uncoded, free-text, missing status/verification, or comes from a lower-authority source family.
  * **No claim:** required source missing, unreadable, unauthorized, unsupported, or conflicting without a clear precedence rule. The response should say what could not be verified.
  * No clinical claim should be presented without a citation/source pointer. If a source pointer cannot be produced, the claim is either removed or reframed as unsupported.

* Escalation triggers?
  * Escalate to explicit uncertainty/refusal when allergies, active meds, recent labs, last-visit baseline, or patient identity cannot be verified from the available source pack.
  * Surface conflicts instead of resolving silently: active prescription vs inactive medication-list item, problem list vs encounter diagnosis mismatch, stale vitals/labs, note/document category ambiguity, or source family unsupported by the selected read path.
  * Escalate authorization failures separately from missing data. "Not authorized to read labs" and "no labs documented" are different facts with different clinical and security meanings.

## **Phase 3: Post-Stack Refinement**

### **11\. Failure Mode Analysis**

* What happens when tools fail?
  * **No uncited fallback prose.** If a chart-reader tool fails, the answer composer can only use facts from successful, source-attributed tool results. Failed source families are named as unavailable, unauthorized, unsupported, timed out, malformed, or empty.
  * **Partial results are allowed, silent substitution is not.** A failed labs read cannot be replaced by note text that mentions labs; a failed allergy read cannot become "no allergies documented." Negative claims require a successful absence check against the intended source.
  * **Retry only transient, idempotent reads.** Timeouts, 429s, and clear 5xx/API-unavailable responses can be retried within the response budget. Permission denied, identifier mismatch, unsupported source, malformed source data, and missing chart rows should not be retried as if they were transient.
  * **Preserve authorization semantics.** "Not authorized" is a distinct failure from "not found"; the agent must not switch from a denied user-scoped route to a broader patient-bound or internal route unless Stage 4/5 proves that fallback preserves the same read permission.

* How to handle ambiguous queries?
  * Resolve patient context only from the active OpenEMR session/selected patient, never from a name mentioned in free text alone.
  * Ask a clarification when the request lacks the clinical target needed to choose a safe source set, such as timeframe ("recent"), source family ("labs" vs "notes"), or task shape ("summarize" vs "compare since last visit").
  * Use conservative defaults only when they are already part of the v1 persona: bounded adult PCP chart review for the selected returning patient, with recent encounters, active problems/allergies/meds, vitals, recent labs, and selected note/document metadata. Do not broaden into an all-chart/all-Observation/all-document sweep just because the query is vague.
  * UI shape remains an implementation decision, but the evidence points to a hybrid: conversational questions with structured answer sections/cards for citations, missing sources, conflicts, and follow-up reads. Pure chat text is too easy to scan past when the answer is degraded.

* Rate limiting and fallback strategies?
  * Use a **speed-first core bundle** before expensive expansion: identity/context, recent encounters, active problems/allergies/meds, recent vitals, and targeted recent labs where available. Notes/documents and broad Observation reads should be opt-in or delayed unless measurement proves they fit the first-response budget.
  * Treat speed-vs-completeness as a staged answer problem, not a one-time architecture guess: first useful answer within the latency budget, then optional "deeper chart review" reads that clearly show they may take longer and may expand PHI exposure.
  * Rate limits from OpenEMR/API/provider paths should produce explicit degraded states with retry-after/backoff metadata where available. Do not hammer OpenEMR REST/FHIR with parallel broad resource reads until Stage 4/5 benchmarks show the safe concurrency envelope.
  * LLM/provider fallback is blocked for real PHI unless the fallback provider has the same approved BAA, retention, training-data, logging, and audit posture. Synthetic/demo workflows may test provider fallback, but must label traces as synthetic and keep them out of real-PHI policy claims.

* Graceful degradation approach?
  * Answer only the verified portion, then state what could not be checked and why. Example categories: no prior visit found, labs source unavailable, not authorized to read documents, medication sources conflict, vitals are stale, or source not supported in v1.
  * Use limitation language as a correctness feature, not an apology: "I found no documented labs in the retrieved lab source" is valid; "labs are normal" is invalid unless supported by result rows.
  * Preserve the demo-data and BAA boundary in product language. Course demos can use synthetic/hand-curated fixtures and the thin bundled demo dataset for empty-path behavior; real PHI workflows remain blocked until provider/BAA, logging, retention, and breach-response decisions are documented.
  * Keep the clinician in control. For v1, degradation should guide the physician to the underlying chart section or explain what source would need to be opened, not attempt a write, order, diagnosis, or treatment recommendation.

### **12\. Security Considerations**

* Prompt injection prevention?
  * Treat chart text, documents, patient-entered content, imported data, and generated summaries as untrusted content. No retrieved text should be allowed to modify system instructions, tool schemas, authorization policy, or citation requirements.
  * Prompt-injection testing is captured in §13 and remains part of implementation verification; Cluster 3 established the PHI/auth boundary and Cluster 4 established source-attribution requirements.

* Data leakage risks?
  * **Primary leakage surfaces:** API full-response logging, SQL audit statements/binds, HTTP query-string logging, browser-rendered errors when debug is enabled, generated summaries, and any external LLM prompt/response. See [→ AUDIT.md §Security-4](../../../../../AUDIT.md#security-4-current-logging-surfaces-can-retain-phi-rich-request-sql-and-api-payload-details).
  * Do not persist generated clinical summaries as chart data in v1. If summaries are logged for debugging/evals, they are PHI-bearing artifacts and need explicit retention/encryption rules.
  * The browser UI already exposes PHI to authenticated users; the agent panel should not expand visibility beyond the active user's OpenEMR session/site/patient context. See [→ AUDIT.md §Security-1](../../../../../AUDIT.md#security-1-browser-ui-authentication-and-chart-context-are-sessionglobal-driven).

* API key management?
  * Store LLM/API credentials outside source control and outside patient chart tables. Do not expose provider keys to browser JavaScript.
  * If a separate agent service is introduced, it needs its own secret store, rotation story, and environment split; this remains Stage 5/ops work.

* Audit logging requirements?
  * Log agent read events with authenticated user, site, patient, source ids, retrieval path, timestamp, and answer/session id.
  * Avoid logging full prompts, full chart excerpts, or full generated summaries by default; OpenEMR's current API/audit defaults show why this must be deliberate.
  * Define retention and purge behavior for every PHI-bearing agent artifact before real-PHI use; current OpenEMR audit tables provide traceability, not an AgentForge-specific retention policy. See [→ AUDIT.md §Compliance-3](../../../../../AUDIT.md#compliance-3-current-audit-tables-support-traceability-and-tamper-review-but-do-not-define-an-agentforge-retention-policy).
  * Preserve the open authorization thread: physician/nurse/resident read scoping must be verified with concrete ACL users before claiming role-specific behavior.

### **13\. Testing Strategy**

* Unit tests for tools?
  * Test each deterministic chart reader against synthetic fixtures for happy path, empty source, missing patient, stale data, inactive/resolved rows, uncoded rows, malformed upstream response, timeout, and permission denied.
  * Assert source-pack shape, not just returned text: table/resource name, row id/uuid, patient id, encounter/date, source family, field names, retrieval path, authorization path, freshness/status fields, and payload/timing metadata.
  * Test identifier normalization separately (`pid`, `puuid`, encounter id, FHIR id) because standard REST, FHIR, legacy session context, and internal services do not use one uniform identifier shape.
  * Add negative unit tests that prove tools do not log full PHI payloads, prompts, SQL bind values, or generated summaries in default synthetic-test mode.

* Integration tests for agent flows?
  * Use the hybrid eval corpus from §9: imported Synthea substrate plus 2-3 hand-curated adult PCP returning-patient fixtures with expected answer, required citations, allowed uncertainty, and known missing/conflicting facts.
  * Cover the core v1 flows: "what changed since last visit?", allergy check before antibiotics, active vs stopped medications, BP/vitals trend, recent labs/A1c, relevant notes/documents, and "what is missing from the chart?"
  * Include partial-source and degraded-flow tests: labs timeout, notes unsupported, documents unauthorized, no prior visit, stale vitals, conflicting medication source, and denied route that must not be retried through a broader path.
  * Run read-boundary comparison tests in Stage 4/5 before final architecture: same fixture question through REST/FHIR-shaped reads and module/internal-service reads, comparing citations, latency envelope, payload size, and authorization/audit metadata.

* Adversarial testing approach?
  * Prompt-injection cases in notes, documents, imported CCDA text, patient-entered fields, and prior generated summaries must not override system instructions, tool schemas, authorization policy, citation requirements, or PHI logging rules.
  * Ambiguity tests should force clarification rather than broad chart sweeps: vague patient names, "recent" without timeframe, "all meds" vs "active meds", "labs" without category/date, and "summarize everything."
  * Authorization tests should use distinct OpenEMR users/ACL setups in Stage 4/5 to prove read-permission scoping. Until those exist, role-specific claims such as physician/nurse/resident behavior remain unproven.
  * Safety tests should reject unsupported treatment/dosing/order-writing requests and keep the v1 posture read-only/advisory, especially when sources are missing or conflicting.

* Regression testing setup?
  * Keep a small deterministic fixture suite in CI that does not require real PHI or external LLM calls: tool schema tests, source-pack assertions, degradation/error taxonomy tests, citation coverage, and prompt-injection guardrails.
  * Keep provider/model evals optional, cost-marked, and synthetic-only by default. If real PHI ever enters eval traces, the §12/§15 retention, BAA, logging, and purge controls must already be implemented.
  * Track regression thresholds by claim category: no uncited clinical claim, no unsupported negative claim, no missing/authorization conflation, no previously passing conflict/stale case regression, and no broadened read path without an updated authorization test.
  * Store eval artifacts as minimized metadata plus expected/actual source ids where possible; avoid retaining full chart excerpts or generated summaries unless the fixture is synthetic and labeled.

### **14\. Open Source Planning**

_Stage 3 close-out — release posture, license posture, and PHI/demo-data boundaries are explicit enough for Stage 4/5 planning. This is not legal advice and does not create a production release plan._

* What will you release?
  * **Primary destination:** Gauntlet GitLab fork (course grading).
  * **Reserved option:** mirror to personal GitHub for **job-interview / portfolio** evidence — implies treating commits, secrets hygiene, and READMEs as if public from day one.
  * **No PHI in commits, ever.** Course/demo work uses bundled demo data, Synthea-generated synthetic patients, and hand-curated non-PHI fixtures only.
  * Any data augmentation must be labeled by origin and boundary: bundled OpenEMR demo data, Synthea synthetic import, or hand-curated synthetic fixture. Do not present synthetic/demo behavior as evidence that real production charts are safe, complete, or representative.
  * The public-facing story should be "evidence-driven clinical AI integration constraints for OpenEMR," not "production AI doctor." Stage 3 proves risks and gates; Stage 4/5 will define users and architecture.

* Licensing considerations?
  * OpenEMR is **GPLv3** — anything that derives from or links into the OpenEMR codebase inherits **GPLv3**.
  * Agent layer designed for **API-only coupling** (HTTP / FHIR) keeps the option to license that layer separately if ever extracted; if shipped as part of this fork, **GPLv3**.
  * Security/compliance evidence does not change the architecture direction: in-repo module/demo code should be GPLv3-compatible; a separately licensed future service needs true API-only separation and later legal review. See [→ AUDIT.md §Compliance-4](../../../../../AUDIT.md#compliance-4-gplv3-constrains-release-shape-for-in-repomodule-integration).

* Documentation requirements?
  * `Documentation/AgentForge/` trail + `AUDIT.md` already double as course deliverable and portfolio evidence.
  * Maintain README polish, atomic commits, and clear journal narrative — readers will include graders, recruiters, and future-self.
  * `AUDIT.md` is the Stage 3 hard gate; future `USERS.md` and `ARCHITECTURE.md` should cite it rather than re-litigating the evidence.
  * Any demo README must disclose synthetic/demo-only data, the real-PHI blocker, and the read-only/advisory posture.

* Community engagement plan?
  * **Gauntlet AI cohort + instructors** — default audience.
  * Wider OpenEMR community is not targeted in v1. Revisit only after Stage 4/5 produces a concrete module or read-boundary design that is useful outside this fork and compatible with upstream contribution expectations.

### **15\. Deployment & Operations**

* Hosting approach?
  * **Evidence-supported direction, not final architecture:** for the in-course v1, the most practical embedded path is an OpenEMR custom module under `interface/modules/custom_modules/`, optionally backed by a separate agent service that consumes REST/FHIR. A pure external service is cleaner for long-term separation, but a module gives the demo an authenticated OpenEMR UI entry point and established menu/page hooks.
  * Do not claim production deployment readiness until Stage 4/5 proves the chart-read boundary, authorization behavior, measured latency/payload budgets, PHI logging posture, and rollback path.
  * Real-PHI deployment is blocked until BAA/provider status, retention, training-data prohibition, audit traceability, and breach-response ownership are documented. See [→ AUDIT.md §Compliance-2](../../../../../AUDIT.md#compliance-2-external-llm-use-requires-a-phi-boundary-decision-before-any-real-chart-data-leaves-openemr) and [§Compliance-3](../../../../../AUDIT.md#compliance-3-current-audit-tables-support-traceability-and-tamper-review-but-do-not-define-an-agentforge-retention-policy).

* CI/CD for agent updates?
  * If implemented as an in-repo module, updates ride with this OpenEMR fork's normal branch/PR workflow and GPLv3 posture.
  * If an external agent service is added, it will need separate CI/CD, secret management, environment separation, provider configuration, and deployment rollback. Defer concrete pipeline design until Stage 5 architecture because no final provider/framework/service boundary has been selected.
  * CI should initially run synthetic/non-PHI checks and source-pack/eval regressions. Real-PHI traces, provider dashboards, and exported eval artifacts remain blocked until retention and BAA posture are approved.

* Monitoring and alerting?
  * Use OpenEMR's audit surfaces for access traceability where possible, but add an agent-specific read-audit event if needed. Monitoring must avoid full PHI payloads by default; log source ids, route/source family, counts, timings, answer/session ids, degraded-state categories, and error classes instead. See [→ AUDIT.md §Compliance-1](../../../../../AUDIT.md#compliance-1-openemr-has-configurable-audit-logging-but-agent-reads-need-their-own-traceability-model).
  * Alert before production-like use on slow/failed source readers, repeated degraded answers, LLM/provider timeouts, citation/source-pack failures, permission-denied spikes, unexpected broad chart reads, and configuration changes that enable full API/prompt/response logging.
  * If an external agent service is added, operations must cover provider/API failures, PHI-safe error logs, secret rotation, BAA/provider retention settings, artifact purge, and breach-response handoffs before any real patient data is used. See [→ AUDIT.md §Compliance-3](../../../../../AUDIT.md#compliance-3-current-audit-tables-support-traceability-and-tamper-review-but-do-not-define-an-agentforge-retention-policy).

* Rollback strategy?
  * A module-based v1 should have a simple disable path through OpenEMR's module activation model, with no chart-write behavior and no dependency on persisted generated summaries.
  * External service rollback remains deployment-platform-specific and is deferred to Stage 5. Minimum future requirement: disable agent UI entry point, revoke/rotate provider credentials if needed, stop outbound PHI flow, preserve audit evidence, and communicate degraded/unavailable status without exposing internal errors.
  * Any cache or precomputed source pack must be bypassable or purgeable by site/user/patient/source set before real-PHI use.

### **16\. Iteration Planning**

* How will you collect user feedback?
  * Stage 4 should turn this audit into explicit personas and workflows before asking for feedback. The first feedback loop should be small and synthetic: physician-like review of the adult PCP flow, source citations, degraded answers, missing-data language, and whether the answer is useful between rooms.
  * Capture feedback by scenario and claim category, not just free-form impressions: "what changed since last visit," allergy safety check, active/stopped meds, BP/vitals trend, recent labs, notes/documents, and missing/conflicting source states.
  * Real clinicians or real PHI are not required for the course demo and remain blocked until compliance posture is approved.

* Eval-driven improvement cycle?
  * Use the hybrid eval corpus from §9: Synthea-generated longitudinal substrate plus 2-3 hand-curated adult PCP returning-patient fixtures with expected answers, required citations, allowed uncertainty, and known missing/conflicting facts.
  * Every iteration should report claim-level pass/fail, citation coverage, missing/authorization distinction, degraded-answer quality, latency, payload bytes, token budget, and PHI-safe logging behavior.
  * Do not improve prompts by adding uncited chart text or broadening retrieval blindly. Regressions in citation, minimum-necessary retrieval, or missing/authorization handling block the iteration even if prose quality improves.

* Feature prioritization approach?
  * Prioritize the narrow read-only path that proves the hardest constraints: selected-patient context, bounded chart readers, source-pack citations, graceful degradation, PHI-safe observability, and measured latency.
  * Defer writes, orders, diagnosis/treatment recommendations, draft chart notes, autonomous tasks, real-PHI provider calls, broad document ingestion, and multi-agent orchestration until the v1 read-only loop is reliable.
  * Stage 4/5 open threads to preserve: final user/persona wording, REST/FHIR vs internal/module read boundary, role-specific authorization proof, model/provider/framework choice, conversation-vs-cards UI, and production deployment topology.

* Long-term maintenance plan?
  * Maintenance burden is dominated by OpenEMR version drift, FHIR/resource behavior changes, ACL/authorization assumptions, schema/service changes, provider compliance terms, and eval fixture drift.
  * Keep the chart-read boundary small enough to retest whenever OpenEMR, the module, or the provider stack changes. New source families must add source-pack fields, degradation cases, eval fixtures, and PHI logging review before they appear in answers.
  * Treat `AUDIT.md` as the Stage 3 baseline. Future `USERS.md` and `ARCHITECTURE.md` should preserve unresolved Stage 4/5 questions explicitly rather than burying them in implementation details.
