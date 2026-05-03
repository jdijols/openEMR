# OpenEMR / AgentForge — Stage 3 Audit

> **Status:** _Complete._ This is the Stage 3 hard-gate evidence and constraints deliverable for the AgentForge work on this OpenEMR fork. Full reasoning lives in dated journal entries under [Documentation/AgentForge/process/journal/](Documentation/AgentForge/process/journal/). For methodology, conventions, and the cluster→section mapping that produced this document, see [Documentation/AgentForge/process/06-stage3-audit.md](Documentation/AgentForge/process/06-stage3-audit.md).

---

## Executive summary

Stage 3 does **not** implement AgentForge. It delivers evidence, constraints, and hard gates that future `USERS.md`, `ARCHITECTURE.md`, and secure integration work must honor. Production-ready clinical AI remains the north star; this phase is deliberately **pre-code**—prove how OpenEMR exposes chart context and risk before any agent reads patient data.

**Highlighted findings**

- **Hybrid runtime.** Logged-in UI flows bind session, site, patient, encounter, and permissions through the legacy bootstrap (`interface/globals.php`); REST/FHIR and newer services sit beside older procedural code. **Therefore:** an embedded copilot must inherit that authenticated context as the security envelope—not invent parallel chart entry points without review. (→ §Architecture-1, §Security-1)

- **APIs are necessary, not sufficient.** Staff API principals do not encode job role the way product language implies; patient-context FHIR reads and staff ACL-backed routes follow **different** enforcement paths. **Therefore:** Stage 4 cannot promise physician-versus-nurse behavior until candidate reads are validated with concrete OpenEMR ACL users—not OAuth labels alone. (→ §Security-2, §Security-3, §Architecture-3)

- **No single chart bundle.** Adult primary-care context pulls from many sources (demographics, encounters, lists, meds, vitals, labs/procedures, notes, history, providers). **Therefore:** design must choose bounded source sets, limits, and attribution—latency and payload grow quickly if you pretend “one fetch” equals “the chart.” (→ §Architecture-2, §Performance-1)

- **Messy data is baseline.** Missing, stale, conflicting, or uncoded values appear routinely. **Therefore:** affirmative clinical claims need source attribution; absence claims need verified lookups—not silence interpreted as “nothing wrong.” (→ §DataQuality-2, §DataQuality-3, §DataQuality-4)

- **Demo data cannot carry v1 validation.** The bundled dataset is too thin for a returning-adult PCP longitudinal scenario (sparse encounters, little labs/history, placeholder narratives). **Therefore:** use synthetic longitudinal substrate (e.g., Synthea import) **plus** hand-curated fixtures for ground-truth questions, citations, uncertainty, and conflicts. (→ §DataQuality-1, §DataQuality-5)

- **Logs and audits can retain PHI.** Default audit/API logging paths may store identifiers, SQL binds, bodies, and responses unless tightened; prompts and model outputs would add more PHI if mirrored blindly. **Therefore:** external LLM use with real chart content stays blocked until legal/provider posture (BAA, retention, training prohibition, breach handling) and PHI-minimized observability are explicit—not inherited from stock defaults. (→ §Security-4, §Compliance-1, §Compliance-2, §Compliance-3)

- **Operations match bounded reads.** Chart-adjacent services fan out with wide joins; token and payload budgets matter for responsiveness. A plausible **hypothesis**—not a locked architecture—is read-only integration with a narrow read boundary; REST/FHIR-only versus module/internal reads must be measured next. **Therefore:** plan graceful degradation, rollback/disable controls, and monitoring that proves access without dumping chart text. (→ §Architecture-4, §Performance-3, §Performance-4, §Performance-5)

**What this audit does not authorize**

Sending real PHI to external models without documented compliance controls; role-specific UX promises validated only at the token layer; treating REST/FHIR as automatically identical to “what the clinician sees” without path-by-path authorization proof; or evaluating the PCP persona on stock demo data alone.

Severity, evidence, and mitigations follow in §1–§5 below; dated working notes live under [Documentation/AgentForge/process/journal/](Documentation/AgentForge/process/journal/).

---

## 1. Security

**Scope:** authentication, authorization, session management, data exposure vectors, PHI handling boundaries, transport security, secret management, and attack surface introduced or exposed by the AgentForge integration.

### Findings

### Security-1: Browser UI authentication and chart context are session/global driven

- **Severity:** Medium
- **Description:** Normal OpenEMR UI authentication is enforced through the legacy bootstrap path: browser scripts include `interface/globals.php`, which resolves site context, starts or reuses the active session, includes `library/auth.inc.php` unless `$ignoreAuth` is set, and then exposes active `pid`, `encounter`, and authorization state through session/global context. This is the current security shape an embedded read-only copilot would inherit.
- **Evidence:**
    - `interface/globals.php` starts the active session and resolves `site_id` before database access, validates requested site ids, clears the session on site mismatch, and derives site paths from the session site.
    - `interface/globals.php` includes `library/auth.inc.php` when `$ignoreAuth` is false, initializes modules, seeds session `pid` from request data only when no session `pid` exists, mirrors `pid`/`encounter`/`userauthorized`/`groupname` into the globals bag, and logs HTTP requests at the end of bootstrap.
    - `library/auth.inc.php` handles login, logout, existing-session validation, session expiration, forced logout, and login-screen redirect.
    - `src/Common/Auth/AuthUtils.php` validates active sessions by comparing session `authUser`, `authUserID`, and `authPass` against active `users` / `users_secure` rows, and stores the username, password hash, user id, provider group, and authorization flag in the session at login.
    - `src/Common/Session/PatientSessionUtil.php` updates session/global `pid`, clears encounter on patient change, and emits a `"view"` audit event when patient context changes.
    - `src/Common/Session/SessionUtil.php` documents that core OpenEMR session cookies are intentionally `HttpOnly=false` so JavaScript can support separate OpenEMR logins/windows; portal and OAuth cookies use `HttpOnly=true`, and SameSite is generally `Strict` with OAuth exceptions.
- **Implications for the agent:** An embedded panel must treat OpenEMR's current user, site, patient, and encounter as security context, not as convenience state. Any route or module that uses `$ignoreAuth`, bypasses normal `globals.php` context, or accepts a patient id outside the active session would need explicit review before it can read chart data.
- **Mitigation / next step:** In Stage 4/5, keep any v1 embedded surface inside the authenticated OpenEMR context and require explicit evidence before adding non-standard entry points.
- **Related:** → presearch §3, → presearch §12, `Architecture-1`, `Architecture-4`.

### Security-2: REST/FHIR auth is OAuth-scope based, but staff job roles collapse to `users`

- **Severity:** High
- **Description:** OpenEMR's API stack has a real authentication and authorization pipeline: site setup, OAuth/local authorization strategies, route security events, OAuth scopes, patient-vs-user-vs-system role checks, and controller ACL checks. The API principal model does not distinguish physician, nurse, resident, or assistant at the token-role layer; staff API users are represented as `users`, with finer distinctions delegated to OpenEMR ACL checks and route/controller behavior.
- **Evidence:**
    - `src/RestControllers/ApiApplication.php` wires `SiteSetupListener`, `OAuth2AuthorizationListener`, `AuthorizationListener`, and `RoutesExtensionListener` into the API request lifecycle.
    - `src/RestControllers/Subscriber/SiteSetupListener.php` extracts the API site from the path, writes `$_GET['site']` for legacy compatibility, creates API/OAuth sessions, includes `interface/globals.php`, and initializes OAuth keys/base URL.
    - `src/RestControllers/Subscriber/AuthorizationListener.php` registers authorization strategies in order: local API, skip-authorized metadata/version/product routes, then bearer token authorization. Its route security handler enforces patient UUID presence for patient-context requests, blocks patient-role FHIR writes, restricts standard `/api/` calls to user-role scopes, and checks the constructed OAuth scope string.
    - `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php` verifies bearer tokens, sets session `authUser` / `authUserID` / `authProvider` for `users`, requires `api:oemr` for standard API routes and `api:port` for portal routes, and allows `users` access to API/FHIR while allowing `patient` access to portal/FHIR and `system` access to FHIR.
    - `src/Common/Auth/UuidUserAccount.php` resolves API subjects only as `users`, `patient`, or `system`.
    - `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php` has `checkUserHasAccessToPatient()` returning `true` with a TODO describing future provider/clinic patient filtering.
- **Implications for the agent:** A read-only copilot cannot infer clinician-specific read policy from API token role alone. The open handoff is not "OAuth or no OAuth"; it is whether the exact route/resource path also applies the OpenEMR ACLs and patient-binding semantics needed for the v1 clinician persona.
- **Mitigation / next step:** Preserve authorization read-permission scoping as an explicit Stage 4/5 design gate; test candidate chart-read routes with distinct OpenEMR ACL users before claiming physician/nurse/resident behavior.
- **Related:** → presearch §3, → presearch §12, `Architecture-3`.

### Security-3: FHIR patient-context reads and staff ACL reads follow different enforcement paths

- **Severity:** High
- **Description:** FHIR reads are not one uniform authorization surface. Generic FHIR controllers run configured ACL checks for non-patient requests, but patient-context requests bind to a patient UUID and skip the controller's generic ACL loop before filtering returned resources.
- **Evidence:**
    - `src/Common/Http/HttpRestRouteHandler.php` marks a request as patient-context when the requested resource's scope context is `patient`, dispatches `RestApiSecurityCheckEvent`, and maps `GET` to `r` for instance reads or `s` for searches.
    - `src/RestControllers/Subscriber/AuthorizationListener.php` changes scope type to `patient` for patient requests with a patient UUID and checks the resulting `patient/<Resource>.<permission>` or `user/<Resource>.<permission>` OAuth scope.
    - `src/RestControllers/FHIR/FhirGenericRestController.php` sets `$puuidBind` from the request when `isPatientRequest()` is true; otherwise it loops through `$this->aclChecks` and calls `RestConfig::request_authorization_check()`.
    - `src/RestControllers/Config/RestConfig.php` delegates those authorization checks to `AclMain::aclCheckCore()` for the request session's `authUser`.
- **Implications for the agent:** The same clinical fact may be reachable through different security paths depending on whether AgentForge reads it through a user-scoped staff route, a patient-compartment FHIR route, or a local in-browser API call. That matters for minimum-necessary access, auditability, and future claims about "same permissions as the logged-in clinician."
- **Mitigation / next step:** For each v1 chart source, record the exact read path and whether enforcement is user ACL, OAuth scope, patient binding, or local session inheritance.
- **Related:** → presearch §7, → presearch §12, open thread: authorization read-permission scoping.

### Security-4: Current logging surfaces can retain PHI-rich request, SQL, and API payload details

- **Severity:** High
- **Description:** OpenEMR has strong audit surfaces, but those surfaces can also become PHI stores. HTTP request logging records paths and query strings, SQL audit logging records statements and bind values for classified tables, and API response logging can persist full JSON responses when configured for full logging.
- **Evidence:**
    - `src/Common/Logging/EventAuditLogger.php` reads global flags for audit logging, query events, HTTP request events, per-event-type flags, audit-log encryption, and optional ATNA sinks.
    - `src/Common/Logging/EventAuditLogger.php` SQL audit logging stores the SQL statement and appends quoted bind values, classifies common patient/lab/order/security tables, skips unknown-table SELECTs, and records patient id from session `pid` for patient-record events.
    - `src/Common/Logging/EventAuditLogger.php` stores comments encrypted only when audit-log encryption is enabled; otherwise it base64-encodes comments. Its HTTP request logger records `SCRIPT_NAME` plus `QUERY_STRING`.
    - `src/RestControllers/Subscriber/ApiResponseLoggerListener.php` logs non-local API calls when `api_log_option > 0`; in full mode it writes the JSON response into both `request_body` and `response`.
    - `library/globals.inc.php` defaults HTTP page-history audit logging to enabled, audit-log encryption to disabled, and API logging to `2` / full logging.
    - `src/Common/Logging/Audit/LogTablesSink.php` writes audit records to `log`, `log_comment_encrypt`, and `api_log`, including request URL/body and response for API entries.
- **Implications for the agent:** AgentForge must assume that chart reads, prompt inputs, generated summaries, and API responses are PHI unless proven otherwise. Before any PHI is sent to an external LLM provider or stored in an agent-specific log, the project needs an explicit PHI logging and retention decision rather than relying on OpenEMR's generic audit defaults.
- **Mitigation / next step:** Define PHI-safe observability before implementation: log access events and source ids, not full chart text or generated summaries, unless a compliance-reviewed retention/encryption policy says otherwise.
- **Related:** → presearch §3, → presearch §12, → presearch §15, `Compliance-1`, `Compliance-2`.

---

## 2. Performance

**Scope:** query latency baselines, database bottlenecks, page render times, payload sizes for chart-relevant data, indexing gaps, and any constraint that will affect the agent's response budget.

### Findings

### Performance-1: Adult PCP chart context is currently a multi-read aggregation, not a single low-latency chart summary

- **Severity:** High
- **Description:** Current OpenEMR does not expose one bounded, source-attributed "adult PCP chart context" read. The needed context spans patient demographics, encounter timeline, problem/allergy/medication lists, prescriptions, vitals/forms, procedure/lab lineage, clinical notes/documents, and history/social-history snapshots, so response latency will be dominated by aggregation shape unless the v1 read path is explicitly bounded.
- **Evidence:**
    - `Architecture-2` and `DataQuality-2` already identify the source families needed for the v1 chart.
    - `src/Services/EncounterService.php` can return all encounters for a patient through a wide join unless callers pass explicit `limit` / `order` options; its `getMostRecentEncounterForPatient()` exists because default encounter-id ordering is not necessarily clinical recency.
    - `src/Services/BaseService.php` documents that an empty search returns all records for the service table, which is dangerous if a chart reader forgets a patient/date/source bound.
    - `src/Services/SocialHistoryService.php` treats `history_data` as insert history and usually returns the latest patient snapshot, while other chart areas use full timelines or one-to-many joins.
- **Implications for the agent:** A between-rooms physician workflow cannot depend on "fetch the chart" as a single cheap operation. The first usable answer needs a measured, bounded source set: likely patient identity, recent encounters, active meds/problems/allergies, recent vitals/labs, and selected notes/doc metadata rather than unbounded history.
- **Mitigation / next step:** Before final architecture, prototype and measure the exact v1 chart-source bundle against augmented longitudinal synthetic data with explicit row/window limits.
- **Related:** → presearch §2, → presearch §7, `Architecture-2`, `DataQuality-2`, open thread: speed-vs-completeness.

### Performance-2: Chart-relevant service queries use wide joins, unions, and one-to-many hydration that can grow faster than the final summary

- **Severity:** High
- **Description:** Several current services are optimized for rich API/resource mapping, not for a minimal "what changed since last visit" context packet. The SQL often joins lookup/provider/facility/patient tables, fans out one-to-many clinical rows, and then hydrates/deduplicates in PHP.
- **Evidence:**
    - `src/Services/EncounterService.php` builds a wide encounter projection over `form_encounter` plus categories, class options, facilities, patient ids, providers, referrers, and discharge options, with optional but not default caller-provided limits.
    - `src/Services/PrescriptionService.php` builds medications as a `UNION` of `prescriptions` and `lists` medication rows, then joins route/unit/interval/adherence/reporting-source/patient/encounter/practitioner lookups; medication text fields such as notes, diagnosis, and dosage instructions ride along.
    - `src/Services/VitalsService.php` joins `form_vitals` to `forms`, `form_encounter`, `patient_data`, `users`, and `form_vital_details`, then collapses detail rows back into one record per form in PHP.
    - `src/Services/ProcedureService.php` starts from active `procedure_order` rows and left-joins order codes, reports, results, abnormal flags, procedure types, encounters, labs, documents, providers, and facilities; lab panels can therefore produce many intermediate rows per clinical order.
    - `src/Services/AllergyIntoleranceService.php` joins `lists` through patient/practitioner/facility/list-option subqueries and then deduplicates rows in PHP when allergies have no associated user.
    - Schema review in `sql/database.sql` shows useful per-table indexes such as `form_encounter.pid_encounter`, `form_encounter.encounter_date`, `forms.pid_encounter`, `documents.foreign_id`, `history_data.pid`, and procedure-result lineage keys, but `lists` has separate `pid` and `type` keys rather than an obvious composite `(pid, type)` key for problem/allergy/medication slices.
- **Implications for the agent:** The final context size may be small while the retrieval work is large. Medications, vitals, and labs are the highest-risk sources for query/hydration amplification, and notes/documents are the highest-risk sources for large text payloads.
- **Mitigation / next step:** Measure per-source SQL count, DB time, hydrated row count, returned item count, bytes, and tokenized payload size before choosing REST/FHIR-only versus an internal/module read boundary.
- **Related:** → presearch §2, → presearch §7, → presearch §8, `DataQuality-2`.

### Performance-3: REST/FHIR is cleaner as a boundary but adds per-resource overhead and uneven pagination behavior

- **Severity:** Medium
- **Description:** REST/FHIR reads provide standardized resources, route-level security, and future extraction potential, but each API call pays the full OpenEMR API stack and FHIR serialization cost. Pagination and server-side limiting are not uniform across resource services, so `_count` cannot be assumed to cap database work for every source.
- **Evidence:**
    - `src/RestControllers/ApiApplication.php` wires exception, telemetry, API response logging, session cleanup, site setup, CORS, OAuth2 authorization, authorization, route extension, and view-renderer subscribers before `OEHttpKernel` handles the request.
    - `src/RestControllers/Subscriber/RoutesExtensionListener.php` normalizes FHIR search requests, creates a `FhirRouteFinder`, builds a `FhirServiceLocator`, dispatches through `HttpRestRouteHandler`, and follows a separate route-finder path for standard API calls.
    - `src/RestControllers/FHIR/FhirGenericRestController.php` runs ACL checks for non-patient requests, calls the FHIR service, then applies per-resource `canAccessResource()` filtering before constructing bundle entries.
    - `src/Services/FHIR/FhirServiceBase.php` parses `_revinclude=Provenance:target`, maps FHIR search params into OpenEMR search params, parses `_count` / `_offset` into a `SearchQueryConfig`, but its default `searchForOpenEMRRecordsWithConfig()` simply delegates to `searchForOpenEMRRecords()` unless a concrete service overrides it.
    - `src/Services/FHIR/FhirPatientService.php` overrides the config-aware search path and passes `SearchQueryConfig` into `PatientService::search()`, while `src/Services/FHIR/FhirEncounterService.php` delegates to `EncounterService::search()` without a config-aware override.
    - `src/Services/FHIR/FhirResourcesService.php` creates FHIR bundles whose `total` is `count($resource_array)`, i.e. returned entries, not necessarily full matching-row cardinality.
- **Implications for the agent:** API-only aggregation is attractive for safety and separation, but a chart summary built from Patient, Encounter, Condition, AllergyIntolerance, MedicationRequest, Observation, DiagnosticReport, and DocumentReference may require many HTTP calls, repeated bootstrap/auth work, larger FHIR JSON payloads, and resource-specific pagination validation. Internal service calls can reduce round trips and serialization, but then authorization and audit parity must be proven.
- **Mitigation / next step:** Benchmark the same v1 chart bundle through REST/FHIR and through an in-process module/service boundary before selecting the final read architecture.
- **Related:** → presearch §2, → presearch §6, → presearch §7, `Architecture-3`, `Security-2`, `Security-3`.

### Performance-4: Payload and context-window risk comes from wide clinical rows, documents, FHIR wrappers, and observation expansion

- **Severity:** High
- **Description:** Several current read paths can return more text or structure than an LLM should receive. A large-context model would hide the problem during a demo but would not solve latency, cost, privacy, or verification risk.
- **Evidence:**
    - `src/Services/PatientService.php` uses `SELECT *` for `findByPid()`, while `patient_data` contains a wide demographic/custom-field row.
    - `sql/database.sql` defines `documents.document_data` as `MEDIUMTEXT`; `src/Services/DocumentService.php` separately supports metadata listing, download links, and full file retrieval through `getFile()`, so metadata and content have very different payload profiles.
    - `src/Services/ClinicalNotesService.php` selects clinical-note descriptions plus encounter/patient/provider/category joins, and returns empty results when the installed clinical-notes table lacks the expected `code` column.
    - `src/Services/FHIR/FhirObservationService.php` composes many observation sub-services; when no category/code narrows the search, it searches all mapped services. `FhirObservationVitalsService` can turn each vitals row into many individual FHIR Observations, and `FhirObservationLaboratoryService` turns procedure reports/results into Observation records.
    - FHIR bundle responses include wrapper metadata, full URLs, resource profiles, references, and optional Provenance resources, increasing payload size relative to a slim internal source pack.
- **Implications for the agent:** Context-window selection must follow measured payload sizes, not precede them. For v1, the risk is not only "will it fit"; it is whether the context remains source-attributed, minimum-necessary, fast enough, and cheap enough for a physician moving between rooms.
- **Mitigation / next step:** Measure bytes and tokens by source family and by answer type, especially notes/documents and broad Observation reads, before selecting model/context-window requirements.
- **Related:** → presearch §2, → presearch §6, → presearch §8, `Security-4`, `DataQuality-4`.

### Performance-5: Caching and observability can improve latency but are PHI-sensitive and invalidation-heavy

- **Severity:** High
- **Description:** Current OpenEMR has request-local caching and configurable audit/API logging surfaces, but no reviewed chart-summary cache or request-level APM built for AgentForge. Any future cache or trace that contains chart facts, prompts, source packs, or generated summaries is a PHI-bearing artifact with invalidation and retention obligations.
- **Evidence:**
    - `src/Common/Translation/TranslationCache.php` and `library/translation.inc.php` provide request/process-local translation caching and optional warmup, but that is UI translation support, not chart-context caching.
    - `src/RestControllers/Subscriber/ApiResponseLoggerListener.php` logs API request URL and, when `api_log_option` is full logging, JSON response content into both `request_body` and `response`.
    - `src/Common/Logging/EventAuditLogger.php`, `src/Common/Logging/AuditConfig.php`, `library/ADODB_mysqli_log.php`, `src/Common/Database/QueryUtils.php`, and `library/sql.inc.php` show that SQL/audit behavior depends on global settings and no-log call paths.
    - `interface/globals.php` can log HTTP request paths/query strings and warm translation cache depending on global flags.
    - Reviewed telemetry code is usage/version reporting rather than request-level tracing/APM; no OpenTelemetry/Prometheus/New Relic/Datadog-style application tracing was found in the sampled PHP paths.
- **Implications for the agent:** Performance measurement must record operational metadata without retaining full PHI by default. Caches must be scoped by site, user authorization context, patient, source set, and retrieval timestamp, and invalidated or bypassed when chart data changes, permissions change, or the clinician requests the freshest chart.
- **Mitigation / next step:** Define PHI-minimized observability before implementation and measure cold/warm latency with current audit/API logging settings enabled and disabled in a synthetic-only environment.
- **Related:** → presearch §2, → presearch §8, → presearch §12, `Security-4`, `Compliance-1`, `Compliance-3`.

---

## 3. Architecture

**Scope:** how OpenEMR is organized (modules, libraries, namespaces), where data lives (schema layout, separation of concerns), how the request lifecycle flows, how layers interact (UI / controllers / services / data), and what integration points exist for adding the agent (events, hooks, modules, REST/FHIR APIs).

### Architecture takeaway

OpenEMR is best understood as a legacy PHP clinical application with modern layers added around it. The older application is concentrated in `interface/` browser pages and `library/` helpers; the newer code is concentrated in `src/` services, REST/FHIR controllers, events, and module infrastructure. The practical bridge between those worlds is `interface/globals.php`, which acts as the shared application bootstrap: it establishes site context, session state, database access, global settings, authentication, current patient/encounter context, and module loading.

For AgentForge, the most important current-state fact is that OpenEMR already owns the hard application context: logged-in user, selected patient, selected encounter, site, permissions, and chart data. A new read-only copilot should attach through supported extension points instead of bypassing that context. The architecture evidence points to an embedded custom module as the most practical v1 demo surface, while REST/FHIR remains the cleanest read boundary to preserve testability and future extraction.

**Executive-summary candidates from Architecture:** OpenEMR's hybrid legacy/modern shape is a major integration constraint; chart data is distributed rather than exposed as one clean chart object; REST/FHIR is useful but uneven; and custom modules/events are the strongest in-repo path for adding a read-only copilot without rewriting core OpenEMR.

### Findings

### Architecture-1: OpenEMR is a hybrid legacy/modern system with `interface/globals.php` as the shared runtime bridge

- **Severity:** Medium
- **Description:** OpenEMR is not organized around one uniform application framework. Modern namespaced PHP lives under `src/`, while much of the browser UI remains legacy procedural PHP under `interface/` and `library/`; both browser pages and API requests ultimately converge through `interface/globals.php` for site, session, database, globals, auth, and module setup.
- **Evidence:**
    - `composer.json` maps `OpenEMR\` to `src/`, but also classmaps `library/classes` and always-loads procedural helper files from `library/`.
    - `public/index.php` uses `FallbackRouter::performLegacyRouting()` and finally `require`s the resolved legacy file; comments explicitly say future modern routes should rely on DI and avoid globals.
    - `src/BC/FallbackRouter.php` rewrites `/apis`, `/oauth2`, portal, and Zend-module paths to entry scripts, then `chdir`s and rewrites `$_SERVER['SCRIPT_FILENAME']`, `SCRIPT_NAME`, and `PHP_SELF` so legacy relative includes still work.
    - `interface/globals.php` creates the `HttpRestRequest`, initializes `OEGlobalsBag`, derives the site, opens the SQL layer, loads site `config.php`, conditionally includes `library/auth.inc.php`, initializes modules, then writes active `pid`, `encounter`, and authorization context back into the globals bag.
    - Example UI pages still follow the legacy bootstrap pattern: `interface/main/main_screen.php` sets `$sessionAllowWrite = true` and then `require_once('../globals.php')`; `interface/patient_file/summary/demographics.php` requires `../../globals.php` and legacy library includes before rendering the chart summary.
- **Implications for the agent:** Any in-process AgentForge feature must account for two worlds at once: modern services and events are available, but request context and chart state still come from legacy globals/session variables. A read-only copilot should minimize direct dependence on `$GLOBALS`/ambient `$pid` where possible, and isolate any unavoidable use at the boundary.
- **Mitigation / next step:** Prefer an integration path that uses supported module/API/event seams while keeping AgentForge-specific chart aggregation in a small, testable boundary; carry detailed permission-scoping risks forward through `Security-2` and `Security-3`.
- **Related:** → presearch §5, → presearch §7.

### Architecture-2: Chart data for the v1 PCP persona is distributed across clinical tables and service/FHIR adapters, not a single chart-summary object

- **Severity:** Medium
- **Description:** The patient chart data AgentForge needs is spread across schema areas and service adapters: demographics, encounters, polymorphic lists, prescriptions, vitals/forms, procedure/lab tables, documents, and users/providers. OpenEMR has useful service and FHIR layers over these tables, but the v1 "what changed since last visit" view will still need an explicit aggregation plan.
- **Evidence:**
    - Core tables in `sql/database.sql`: `patient_data` stores patient demographics and PCP/care-team fields; `form_encounter` stores visit headers keyed by `pid` and `encounter`; `lists` stores typed rows such as problems and allergies; `prescriptions` stores prescription records; `form_vitals` stores vitals while `forms` links encounter forms by `pid`, `encounter`, `form_id`, and `formdir`; `procedure_order`, `procedure_report`, and `procedure_result` model lab/order/result flow; `documents` stores patient-linked document metadata/content; `users` stores practitioners/providers.
    - Service mapping is explicit in `src/Services`: `PatientService::TABLE_NAME = 'patient_data'`, `ConditionService` uses `lists` and forces `type = medical_problem`, `AllergyIntoleranceService` uses `lists` and forces `type = allergy`, `VitalsService::TABLE_VITALS = form_vitals`, `ProcedureService` starts from `procedure_order` and joins reports/results, `DocumentService::TABLE_NAME = documents`, and `PractitionerService` uses `users`.
    - FHIR services compose multiple internal sources: `FhirObservationService` registers vitals, laboratory, social-history, form, patient, employer, and preference observation services and narrows by `category`/`code`; `FhirConditionService` maps encounter diagnoses, problem-list items, and health concerns; `FhirDiagnosticReportService` maps clinical notes and laboratory reports.
    - Legacy chart fragments mirror the same distribution: `vitals_fragment.php` queries `form_vitals` joined to `forms`; `labdata_fragment.php` joins `procedure_report`, `procedure_order`, and `procedure_order_code` for recent lab data.
- **Implications for the agent:** Agent tools cannot safely treat "chart" as one source. Each claim category needs its own source path and citation model, especially because `lists` is polymorphic and labs require order/report/result traversal. This finding informed Cluster 4's claim-category and eval design.
- **Mitigation / next step:** Define a read-only chart-snapshot/tool layer that normalizes only the v1 sources needed for adult PCP visits and preserves source pointers back to tables/resources.
- **Related:** → presearch §7, full Data Quality and verification design in **Cluster 4**, `DataQuality-1`, `DataQuality-2`.

### Architecture-3: REST/FHIR APIs provide the cleanest read boundary, but identifier and resource coverage are uneven across standard and FHIR routes

- **Severity:** Medium
- **Description:** OpenEMR exposes a modern Symfony-event-driven API stack with both standard REST and FHIR routes, and those routes are strong candidates for a read-only copilot boundary. The route surface is not uniform, however: standard REST mixes patient UUID and numeric `pid` paths, while FHIR resources are more standardized but federate some data through composite services and patient-binding logic.
- **Evidence:**
    - `apis/dispatch.php` creates an `HttpRestRequest` and runs `ApiApplication`.
    - `src/RestControllers/ApiApplication.php` wires an event dispatcher with site setup, CORS, OAuth2 authorization, authorization, route extension, and view-renderer subscribers before passing the request to `OEHttpKernel`.
    - `SiteSetupListener` derives the site from the path, writes `$_GET['site']` for legacy compatibility, creates API/OAuth sessions, then includes `interface/globals.php`.
    - `RoutesExtensionListener` branches to FHIR, portal, or standard API processing. `StandardRouteFinder` includes `_rest_routes_standard.inc.php` and dispatches `RestApiCreateEvent`; `FhirRouteFinder` includes `_rest_routes_fhir_r4_us_core_3_1_0.inc.php` and dispatches the same extension event for FHIR routes.
    - Standard routes include `/api/patient/:puuid` and `/api/patient/:puuid/encounter`, but vitals, SOAP notes, and medications use numeric `:pid`/`:eid` style routes. FHIR routes include patient-binding branches for patient requests and ACL checks for user requests.
- **Implications for the agent:** A separate AgentForge backend can consume REST/FHIR without linking directly into core PHP, which is attractive for licensing, testing, and long-term separation. For the in-course demo, it still needs an identifier-normalization layer (`puuid`/`pid`/`encounter`/FHIR ids) and a resource-selection policy that avoids expensive or ambiguous all-observation reads.
- **Mitigation / next step:** Use FHIR/REST as the preferred data-access boundary where practical, but prototype v1 chart reads against the exact resources needed before committing to API-only integration.
- **Related:** → presearch §5, → presearch §7, authorization-scope details captured in `Security-2` and `Security-3`.

### Architecture-4: Custom modules plus event hooks are the most plausible in-repo integration path for a v1 embedded read-only copilot

- **Severity:** Informational
- **Description:** OpenEMR has first-class extension seams for custom modules, menu/page-heading hooks, and route extension events. A custom module can provide an embedded read-only UI and optionally register new read-only API routes without editing core services for a course demo.
- **Evidence:**
    - `interface/globals.php` initializes `ModulesApplication` when the `modules` table exists and records module roots as `interface/modules/`, `custom_modules`, and `zend_modules`.
    - `src/Core/ModulesApplication.php` loads Laminas modules, prepares `ModulesClassLoader`, queries active custom modules from the `modules` table, includes each module's `openemr.bootstrap.php`, passes in the Symfony `EventDispatcherInterface`, dispatches `ModuleLoadEvents::MODULES_LOADED`, and blocks direct script access to disabled module directories.
    - `src/Core/ModulesClassLoader.php` documents module namespace registration without requiring a root Composer autoload dump.
    - Existing modules demonstrate UI hook patterns: `oe-module-prior-authorizations/openemr.bootstrap.php` registers `MenuEvent::MENU_UPDATE` and `PatientMenuEvent::MENU_UPDATE`; `oe-module-dashboard-context/src/Bootstrap.php` registers `PageHeadingRenderEvent::EVENT_PAGE_HEADING_RENDER`.
    - `tests/eventdispatcher/RestApiEventHookExample/Module.php` demonstrates adding standard and FHIR routes through `RestApiCreateEvent`.
    - The repository is GPLv3 (`LICENSE`), and OpenEMR PHP files/modules consistently carry GPLv3 license headers; code shipped inside this fork should be treated as GPLv3 unless a later legal review says otherwise.
- **Implications for the agent:** For v1, a custom module is the strongest in-repo demo surface: it keeps AgentForge code separated from core, can live inside the authenticated OpenEMR UI, can add menus/panels, and can optionally expose narrow read-only routes. A pure external REST/FHIR consumer remains viable for long-term decoupling, but it gives up the embedded UX unless paired with a module or separate frontend.
- **Mitigation / next step:** Recommend a custom module with an embedded read-only page/panel and a narrow chart-read service/API boundary for v1; keep API-only extraction as a design constraint, not an immediate requirement.
- **Related:** → presearch §5, → presearch §7, → presearch §15.

---

## 4. Data Quality

**Scope:** completeness of demo data (and structural assumptions about real charts), formatting consistency, duplicate records, stale data, missing fields that downstream verification depends on, and any known data-shape pitfalls that will surface as agent failure modes.

### Findings

_Cluster 1.5 landed `DataQuality-1`; Cluster 4 completed the broader data-quality, verification, and eval pass._

### DataQuality-1: Persona viability — adult PCP returning-patient demo coverage

- **Severity:** High
- **Description:** The bundled OpenEMR development demo dataset (loaded via `dev-reset-install-demodata`) does not support the v1 persona ([→ presearch §1](Documentation/AgentForge/process/03-presearch-checklist.md)). The dataset contains 3 patients with 1 encounter each, all dated 2014-02-01, with placeholder/test SOAP narratives and no labs, immunizations, longitudinal vitals, or modern clinical-notes content. The persona — adult PCP, non-emergent, **returning patients with rich charts** — depends on multi-visit history, lab trends, and meaningful narratives that this dataset cannot produce. Demo-data caveat per §06-stage3-audit §4 methodology rules: this is a finding about the curated dev dataset shipped with OpenEMR, not a guarantee about the shape of real production charts.
- **Evidence:** All queries below run via `docker compose exec -T openemr mysql -h mysql -u openemr -popenemr openemr` against the easy-dev stack on 2026-04-28.
    - **Patient roster (3 rows total):** `SELECT pid, fname, lname, DOB, sex FROM patient_data;` → Phil Belford (54M, b. 1972-02-09), Susan Underwood (59F, b. 1967-02-08), Wanda Moore (19F, b. 2007-02-18). No pediatric (<18) and no geriatric (>65) patients.
    - **Encounter depth — zero longitudinal coverage:** `SELECT pid, COUNT(*), MIN(date), MAX(date) FROM form_encounter GROUP BY pid;` → exactly 1 encounter per patient; first = last = 2014-02-01 for all three. **0 patients meet the "≥2 visits" threshold the persona requires.**
    - **Calendar history is a single fictional clinic day:** `SELECT pc_eventDate, COUNT(*) FROM openemr_postcalendar_events GROUP BY pc_eventDate;` → 11 events, all on 2014-01-31.
    - **Clinical-content tables are empty or near-empty:** `form_clinical_notes` 0, `form_ros` 0, `form_history_sdoh` 0, `immunizations` 0, `procedure_order` 0, `procedure_report` 0, `procedure_result` 0 (no labs at any layer), `prescriptions` 1, `documents` 0, `pnotes` 0, `transactions` 0.
    - **Problem / med / allergy lists (`lists`, 9 rows total):** Phil — HTN + Chronic Renal Insufficiency (ICD9), 2 meds (Norvasc, Lisinopril), penicillin allergy; Susan — diabetes (no type, no ICD code), 3 meds (Metformin, Lipitor, Lisinopril), no allergies recorded; Wanda — empty problem list, no meds, no allergies.
    - **SOAP narratives are placeholder/test stubs**, not realistic notes — Phil: `subjective="sad" / objective="crying" / assessment="depression" / plan="psych eval"`; Susan: `subjective="Toe hurts" / objective="toe is black" / assessment="toe looks bad" / plan="Amputate toe"`; Wanda: `subjective="Fever" / objective="Fever" / assessment="Fever" / plan="abx"`.
    - **Stale coding system:** Problem entries use ICD9 (e.g., `ICD9:401.0`, `ICD9:585.1`) even though the ICD10 reference tables are populated and the US has required ICD10 since 2015.
    - **Stale dates:** All clinical activity is dated 2014-02-01 (or 2014-01-31 for the calendar) — over 12 years stale relative to the audit date.
    - **Encounter typing contradicts "returning patient":** `openemr_postcalendar_categories` for the 3 visits → 1 "Established Patient" (Phil), 2 "New Patient" (Susan, Wanda). Even at the metadata level, only 1/3 of the demo models a returning patient, and none have any prior visit to be "returning" *to*.
    - **History-data social fields blank:** `coffee`, `tobacco`, `alcohol`, `exercise_patterns` are empty strings on all 3 `history_data` rows.
- **Implications for the agent:** The case-study scenario the v1 persona is built around — *"what changed since the last visit"*, *"dense EHR notes... lab results... medication lists"* — cannot be demonstrated, evaluated, or red-teamed against this dataset. Three follow-on consequences: **(1)** any agent demo built directly on the bundled dataset will fail at the persona's core promise; a data-augmentation step (Synthea import or hand-curated longitudinal patients) becomes a hard prerequisite before Cluster 6 (demo) is viable. **(2)** Eval ground truth for verification implementation cannot be authored against patient charts that don't exist — the eval harness requires augmented data first. **(3)** If the verification layer is exercised against this dataset as-is, every claim hits the empty/missing path — useful for refusal/negation behavior but not for source-attribution behavior on populated fields. The persona shape itself remains correct; it is the substrate, not the target, that needs work.
- **Mitigation / next step:** Treat data augmentation as a hard prerequisite gate before verification/eval implementation and Cluster 6 (demo). Cluster 4 resolved the augmentation direction as hybrid Synthea import (`/root/devtools import-random-patients`) plus hand-curated golden fixtures; see `DataQuality-5`.
- **Related:** [→ presearch §1](Documentation/AgentForge/process/03-presearch-checklist.md), [→ presearch §3.1](Documentation/AgentForge/process/03-presearch-checklist.md), full Data Quality audit in **Cluster 4**, demo build in **Cluster 6**, [Cluster 1.5 spike journal](Documentation/AgentForge/process/journal/week-1/0428-T0118-cluster-1-5-demo-data-spike.md).

### DataQuality-2: Adult PCP chart facts come from multiple source families with different identifiers, statuses, and freshness semantics

- **Severity:** High
- **Description:** Current OpenEMR chart data is not a single coherent "chart summary" object. For the adult PCP returning-patient persona, the concrete chart sources span demographics/care team, encounters, problem/allergy/medication lists, prescriptions, vitals/forms, procedure/lab tables, notes/documents, history, and immunizations, each with its own identifiers, date fields, and active/status conventions.
- **Evidence:**
    - Schema source tables in `sql/database.sql` include `patient_data`, `form_encounter`, `lists`, `lists_medication`, `prescriptions`, `form_vitals`, `forms`, `form_clinical_notes`, `history_data`, `immunizations`, `procedure_order`, `procedure_order_code`, `procedure_report`, `procedure_result`, `documents`, and `pnotes`.
    - `src/Services/ConditionService.php` and `src/Services/AllergyIntoleranceService.php` both read from the polymorphic `lists` table, forcing `type = medical_problem` or `type = allergy`; allergy search also deduplicates rows caused by joins when a `lists.user` association is missing.
    - `src/Services/PrescriptionService.php` builds medication requests as a `UNION` of `prescriptions` rows and `lists` rows with `type = medication`; it carries `source_table`, derives status from `active`/`end_date` or `activity`/`enddate`, and notes that a medication issue can be tied to multiple encounters while FHIR treats the relationship as 0..1.
    - `src/Services/VitalsService.php` reads `form_vitals` joined to `forms` and `form_encounter`, while `src/Services/FHIR/Observation/FhirObservationVitalsService.php` maps individual vital columns to LOINC-coded observations.
    - `src/Services/ProcedureService.php` starts from `procedure_order` and LEFT JOINs reports/results so orders without results can still appear; labs then surface through `FhirObservationLaboratoryService` and `FhirDiagnosticReportService`.
    - `src/Services/SocialHistoryService.php` documents `history_data` as one row per insert and commonly returns the latest row only.
- **Implications for the agent:** Every v1 claim category must preserve its exact source family and source pointer. "Active med", "no allergies", "recent labs", "BP trend", "last visit", and "social history" cannot share one verification rule because their data freshness, missingness, and status signals differ.
- **Mitigation / next step:** In Stage 4/5, define a source pack that records table/resource, row UUID/id, patient id, encounter/date, status/activity fields, retrieval path, and freshness timestamp for each extracted fact.
- **Related:** → presearch §7, → presearch §9, → presearch §10, `Architecture-2`, `Architecture-3`.

### DataQuality-3: Missing, empty, stale, and conflicting chart states are normal current behavior, not edge cases

- **Severity:** High
- **Description:** The currently loaded dev data and source schemas show that AgentForge must treat absence, staleness, and conflicts as first-class verification states. The demo data is not only thin; it also contains null history fields, inconsistent medication sources, absent coding, inactive rows, future-ish modification timestamps relative to 2014 clinical events, and fields whose default values can be confused with real observations.
- **Evidence:** Current read-only SQL against the easy-dev database on 2026-04-28, plus source inspection:
    - Table counts repeated from the current easy-dev database: `patient_data` 3, `form_encounter` 3, `lists` 9, `prescriptions` 1, `form_vitals` 3, `history_data` 3, and zero rows in `form_clinical_notes`, `immunizations`, `procedure_order`, `procedure_report`, `procedure_result`, `documents`, and `pnotes`.
    - `lists` has 1 allergy, 3 active medical problems, 4 active medication rows, and 1 inactive medication row. Susan has `Lisinopril` both as an inactive `lists` medication and as an active `prescriptions` row, so medication status can conflict across source families unless provenance is kept.
    - Problem coding is partial: Phil's HTN/renal-insufficiency problems use ICD9; Susan's diabetes problem has no diagnosis code; all `lists.user` and `verification` values are blank in the current demo rows.
    - `history_data` has one row per patient but `tobacco`, `alcohol`, `exercise_patterns`, and `recreational_drugs` are all `NULL`.
    - `form_vitals` has one row per patient on 2014-02-01 only; `src/Services/VitalsService.php` also depends on global unit settings for conversion, so evals must compare normalized units rather than raw display text.
    - `src/Services/ClinicalNotesService.php` returns an empty result if the installed clinical-notes table lacks the expected `code` column, and otherwise treats status as "current" with future entered-in-error/superseded support left open.
    - `src/Services/FHIR/FhirEncounterService.php` emits FHIR Encounter status as fixed `finished` and has a TODO questioning whether the hard-coded check-up type is the only possible encounter type.
- **Implications for the agent:** Graceful degradation is not polish; it is a correctness requirement. The agent must distinguish "not documented", "not authorized", "source unsupported", "source empty", "stale", "inactive/resolved", and "conflicting across sources" instead of flattening them into confident prose.
- **Mitigation / next step:** Make eval cases include explicit empty, stale, inactive, uncoded, and conflicting-source examples, and require outputs to name the data limitation rather than infer around it.
- **Related:** → presearch §9, → presearch §10, → presearch §11, open thread: graceful degradation.

### DataQuality-4: FHIR helps source attribution but does not provide sufficient provenance by itself

- **Severity:** Medium
- **Description:** OpenEMR's FHIR layer is useful for standardized resource reads, patient/date/category filters, and optional Provenance rev-includes, but it does not by itself satisfy AgentForge's source-attribution requirement. FHIR logical ids usually map back to internal UUIDs, while Provenance is synthesized per resource and often points to the primary organization rather than the exact original author/source.
- **Evidence:**
    - `src/RestControllers/RestControllerHelper.php` defines `_revinclude=Provenance:target` support.
    - `src/Services/FHIR/FhirProvenanceService.php` comments that a complete provenance table would be better, but provenance is currently tracked disparately and the service visits each resource to gather surrogate ids; `createProvenanceForDomainResource()` records the target and uses resource `meta.lastUpdated`, then creates author/transmitter agents from a user reference or primary business organization.
    - `src/Services/FHIR/FhirAllergyIntoleranceService.php` is one path that passes recorder information into FHIR Provenance, but this is not a universal guarantee across resources.
    - `FhirConditionService` supports patient, `_id`, and `_lastUpdated`, while category routing happens inside `getAll()`; it does not expose clinical-status search in `loadSearchParameters()`.
    - `FhirObservationService` maps Observation across social history, vitals, laboratory, SDOH, patient, employer, advance-directive, and preference services; `FhirObservationLaboratoryService` accepts broad LOINC-style code searches and removes category before calling `ProcedureService`.
    - `FhirDocumentReferenceService` composes clinical notes, patient documents, and advance directives. `FhirPatientDocumentReferenceService` unsets a category search parameter for uploaded documents after routing, so category filtering does not mean the same thing for every document source.
- **Implications for the agent:** Citations cannot stop at `FHIR/Observation/{id}` or `FHIR/DocumentReference/{id}` if the answer needs clinician-grade traceability. Verification needs the internal source row/resource id, source family, retrieval path, and relevant field names in addition to any FHIR resource id and Provenance bundle.
- **Mitigation / next step:** Treat FHIR Provenance as helpful metadata, not the canonical citation layer; build citations from the chart-read boundary's own source pack.
- **Related:** → presearch §7, → presearch §10, `Security-3`, `Compliance-1`.

### DataQuality-5: Eval ground truth requires hybrid synthetic-plus-curated augmentation

- **Severity:** High
- **Description:** The repository provides two useful data paths, neither sufficient alone for the v1 eval burden. The curated demo data is too small and stale for longitudinal adult PCP evaluation, while Synthea import is the built-in scalable synthetic path but enters OpenEMR through CCDA import and does not supply hand-authored ground-truth answers for AgentForge-specific questions.
- **Evidence:**
    - `CONTRIBUTING.md` documents `dev-reset-install-demodata` for curated demo reset and `import-random-patients <count>` for Synthea-generated random patients imported into OpenEMR.
    - The documented Synthea import development mode directly imports patient data from CCDA, bypasses CCDA document import and `audit_master` / `audit_details`, and turns off audit logging during import; the docs explicitly warn not to use that mode on sites with real data.
    - `interface/modules/zend_modules/module/Carecoordination/src/Carecoordination/Model/CarecoordinationTable.php` imports CCDA-derived immunizations, prescriptions, allergies, medical problems, encounters, care plans, clinical notes, vitals, procedures, lab results, functional/cognitive status, referrals, observations, payers, and files when those sections are parsed.
    - `src/Services/Cda/CdaTemplateParse.php` maps CCDA lab result organizers/observations into `procedure_result` fields including result code, date, status, value, unit, and reference range.
    - `tests/Tests/Fixtures/` contains small hand-authored fixtures for tests, but these are not a longitudinal adult PCP eval corpus.
- **Implications for the agent:** The evidence supports a **hybrid** augmentation decision: use Synthea to create enough synthetic longitudinal chart substrate, then hand-curate a small set of adult PCP cases and ground-truth question/answer/citation fixtures on top. Synthea alone can populate tables but cannot prove that "what changed since last visit" answers are correct; hand-curated data alone is more controllable but too slow to produce breadth.
- **Mitigation / next step:** Before demo/eval implementation, import a small Synthea cohort in non-real-data dev, select 2-3 adult returning patients with usable longitudinal records, and hand-author eval fixtures covering expected answer, required citations, allowed uncertainty, and known missing/conflicting facts.
- **Related:** → presearch §9, → presearch §10, → presearch §14, `DataQuality-1`, open thread: demo-data + BAA acknowledgment.

---

## 5. Compliance & Regulatory

**Scope:** HIPAA-specific obligations not already absorbed by §1 — audit logging requirements, data retention policies, breach-notification posture, BAA (Business Associate Agreement) implications when PHI touches an LLM provider, training-data prohibitions, and minimum-necessary access enforcement.

### Findings

### Compliance-1: OpenEMR has configurable audit logging, but agent reads need their own traceability model

- **Severity:** High
- **Description:** OpenEMR already records many security-relevant events through `EventAuditLogger`, SQL logging, HTTP page-history logging, API response logging, and explicit patient `"view"` events. Those logs are global-flag and route/query dependent, so AgentForge cannot assume every generated answer has a complete read trail unless it deliberately ties each chart read and summary to auditable source access.
- **Evidence:**
    - `src/Common/Logging/EventAuditLogger.php` builds audit configuration from globals such as `enable_auditlog`, `audit_events_query`, `audit_events_http-request`, event-type flags, audit-log encryption, breakglass logging, and optional ATNA forwarding.
    - `src/Common/Session/PatientSessionUtil.php` emits a `"view"` audit event when patient context is set.
    - `interface/globals.php` calls `EventAuditLogger::getInstance()->logHttpRequest()` unless `$skipAuditLog` is set.
    - `src/Common/Logging/EventAuditLogger.php` skips SELECT query logging if query events are disabled or if the SELECT resolves to event `"other"` after table classification.
    - `src/Common/Logging/EventAuditLogger.php` maps many patient, lab, order, scheduling, and security-administration tables into event categories; the mapping is explicit, so reads outside that map need verification before relying on SQL-audit coverage.
- **Implications for the agent:** HIPAA-style auditability requires more than "the UI was open." A clinical copilot needs a defensible record that a specific authenticated user accessed a specific patient/source set for a specific generated answer, while avoiding full PHI duplication in logs.
- **Mitigation / next step:** In Stage 4/5, define an agent read-audit event shape that records user, patient, source identifiers, timestamp, and answer/session id without storing full chart text by default.
- **Related:** → presearch §3, → presearch §12, → presearch §15, `Security-4`.

### Compliance-2: External LLM use requires a PHI boundary decision before any real chart data leaves OpenEMR

- **Severity:** Critical
- **Description:** This fork currently has no implemented AgentForge LLM path, but the compliance boundary is already clear: if prompts, retrieved chart facts, documents, API responses, or generated summaries contain PHI, sending them to an LLM provider creates HIPAA-relevant obligations around BAA status, permitted use, retention, training, auditability, breach response, and minimum-necessary disclosure. OpenEMR's default API/audit logging settings also show that "temporary" API payloads can become retained data unless explicitly controlled.
- **Evidence:**
    - `src/RestControllers/Subscriber/ApiResponseLoggerListener.php` can persist full API JSON responses for non-local API requests when full logging is enabled.
    - `library/globals.inc.php` defaults `api_log_option` to full logging and audit-log encryption to disabled.
    - `src/Common/Logging/EventAuditLogger.php` encrypts audit comments/API fields only when configured; otherwise comments are base64-encoded, not encrypted.
    - `src/Common/Logging/Audit/LogTablesSink.php` persists API request URLs, request bodies, and responses into `api_log`.
    - `Security-4` documents that request paths, SQL statements/binds, and API payloads can all become PHI-bearing records.
- **Implications for the agent:** The v1 demo may use synthetic/demo data, but any path that handles real PHI must gate provider choice and logging design on a BAA/retention/training-data decision. This is a precondition for production-like deployment claims, not a final agent feature.
- **Mitigation / next step:** Before using real patient data with any external model, require a documented provider/BAA posture, disable training/retention where applicable, minimize prompt PHI, and verify logs do not persist full prompts/responses unintentionally.
- **Related:** → presearch §3, → presearch §12, → presearch §14, → presearch §15, `Compliance-3`, open thread: demo-data + BAA acknowledgment.

### Compliance-3: Current audit tables support traceability and tamper review, but do not define an AgentForge retention policy

- **Severity:** High
- **Description:** OpenEMR has persistent audit tables and UI/reporting surfaces for audit review, including tamper detection, but the reviewed current system does not define an AgentForge-specific retention schedule, purge policy, or breach-notification workflow for PHI-bearing agent prompts, responses, source packs, or external LLM payloads. That gap matters because OpenEMR's API/audit logging can store longtext request/response/comment content.
- **Evidence:**
    - `sql/database.sql` defines `api_log` with `request_url`, `request_body`, `response`, and `created_time`; it does not define retention, expiry, or purge metadata for those rows.
    - `sql/database.sql` defines `log` with `date`, `event`, `category`, `user`, `comments`, `user_notes`, `patient_id`, checksum-related fields, and `ccda_doc_id`; it does not define retention, expiry, or breach-workflow fields.
    - `interface/logview/logview.php` reads audit events through `EventAuditLogger::getEvents()`, decrypts or base64-decodes comments, and displays user, patient, API, and comment data for review.
    - `interface/reports/audit_log_tamper_report.php` is gated to `admin/super`, reads audit events through `EventAuditLogger::getEvents()`, recomputes checksums, and reports deleted/tampered log rows.
    - Repository search for `retention`, `purge`, and `breach notification` in reviewed PHP/SQL/Markdown surfaces did not reveal a current application-level policy or workflow covering LLM-bound PHI artifacts.
- **Implications for the agent:** If AgentForge stores prompts, responses, source packs, or provider payloads, those artifacts become PHI records with their own lifecycle. OpenEMR's existing audit log can help reconstruct access, but it does not by itself answer how long agent artifacts are retained, how they are deleted, who reviews them, or how a suspected LLM/provider disclosure triggers breach assessment.
- **Mitigation / next step:** Before any real PHI use, define a retention matrix for agent artifacts, an owner-reviewed purge/export process, and a breach-notification playbook that maps LLM/provider incidents back to OpenEMR audit evidence.
- **Related:** → presearch §3, → presearch §12, → presearch §15, `Security-4`, `Compliance-1`, `Compliance-2`.

### Compliance-4: GPLv3 constrains release shape for in-repo/module integration

- **Severity:** Medium
- **Description:** OpenEMR is distributed under GPLv3, and its PHP files/modules consistently carry GPLv3 headers. For AgentForge, this matters because code shipped inside this fork or as an OpenEMR custom module should be treated as GPLv3 for release-planning purposes unless legal review says otherwise; a separately deployed HTTP/FHIR consumer preserves more licensing optionality.
- **Evidence:**
    - `LICENSE` is GNU General Public License version 3.
    - OpenEMR PHP files reviewed in this audit, including `library/auth.inc.php`, `src/Common/Session/PatientSessionUtil.php`, `src/Common/Logging/Audit/LogTablesSink.php`, and `src/Common/Session/SessionUtil.php`, carry GPLv3 license headers.
    - `Architecture-4` already identified a custom module as the most plausible in-repo v1 demo path and REST/FHIR as the cleaner long-term read boundary.
- **Implications for the agent:** Security/compliance evidence does not block the module path, but it does make the release posture explicit: in-fork demo/module code should be presented as GPLv3-compatible course/portfolio work, while any later separately licensed agent service should communicate with OpenEMR over a clear API boundary.
- **Mitigation / next step:** Keep Stage 4/5 release notes and README language aligned with GPLv3 for in-repo code; defer any non-GPL licensing claims until there is legal review and a true API-only separation.
- **Related:** → presearch §14, `Architecture-4`.

---

## Appendix A — Audit methodology by domain

_Each subsection below records how that domain was audited (tools, queries, file traversals, manual review). Filled in by the cluster that produces the findings._

- **Security:** Cluster 3 audit (2026-04-28) — read-only source traversal of UI authentication/session bootstrap, API/OAuth/FHIR authorization, ACL handoffs, patient/session context, audit logging, and PHI exposure paths. Reviewed `interface/globals.php`, `library/auth.inc.php`, `src/Common/Auth/AuthUtils.php`, `src/Common/Session/*`, `src/RestControllers/ApiApplication.php`, `src/RestControllers/Subscriber/*Authorization*`, `src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php`, `src/Common/Http/HttpRestRouteHandler.php`, `src/RestControllers/FHIR/FhirGenericRestController.php`, `src/RestControllers/Config/RestConfig.php`, `src/Common/Auth/UuidUserAccount.php`, `src/Common/Logging/EventAuditLogger.php`, `src/RestControllers/Subscriber/ApiResponseLoggerListener.php`, `src/Common/Logging/Audit/LogTablesSink.php`, `library/globals.inc.php`, and GPL license headers. No exploit testing, production configuration review, legal advice, or final agent policy design was performed.
- **Performance:** Cluster 5 audit (2026-04-28) — read-only source traversal of adult PCP chart retrieval paths, REST/FHIR request overhead, query shape, payload/context-size risk, caching surfaces, and PHI-safe observability constraints. Reviewed representative services for encounters, conditions/allergies, prescriptions/medications, vitals, procedures/labs/results, clinical notes, documents, history/social history, patient demographics, BaseService search behavior, FHIR service/controller/bundle paths, API dispatch/listeners, response logging, SQL/audit logging, translation cache, and schema indexes in `sql/database.sql`. No runtime benchmarks, data imports, schema changes, or final agent architecture decisions were performed; the main outcome is the measurement plan required before choosing the final read boundary.
- **Architecture:** Cluster 2 audit (2026-04-28) — read-only source traversal of the OpenEMR request/bootstrap paths, API dispatch stack, module/event system, chart-relevant schema tables, service adapters, FHIR resource services, standard REST route maps, and legacy patient-summary fragments. Reviewed `composer.json`, `public/index.php`, `src/BC/FallbackRouter.php`, `interface/globals.php`, `library/` bootstrap/auth touchpoints, `apis/dispatch.php`, `src/RestControllers/*`, `apis/routes/*`, `src/Core/ModulesApplication.php`, `src/Core/ModulesClassLoader.php`, representative custom modules, `sql/database.sql`, `src/Services/*`, `src/Services/FHIR/*`, and `interface/patient_file/summary/*`. No schema changes, runtime mutations, or security/compliance deep dive were performed in Cluster 2; those questions are now captured in Cluster 3 findings.
- **Data Quality:** Cluster 1.5 spike plus Cluster 4 audit (2026-04-28) — read-only inspection of the curated dev demo loaded via `dev-reset-install-demodata`, current easy-dev SQL counts/detail queries, and source traversal of chart-relevant schema/services/FHIR/CCDA import paths. SQL queries against the `openemr` schema in easy-dev MariaDB quantified patient count, age distribution, encounter depth, longitudinal span, table counts, `lists` activity/type distribution, medication-source conflicts, vitals/history rows, and missing labs/notes/documents/immunizations. Source review covered `sql/database.sql`, `src/Services/*` chart readers, `src/Services/FHIR/*` resource services, `src/Services/Cda/*`, `CarecoordinationTable.php`, `CONTRIBUTING.md` devtools documentation, and representative test fixtures. No data was imported, no schema/data mutations were performed, and Synthea output was not generated in this cluster.
- **Compliance:** Cluster 3 audit (2026-04-28) — evidence-only review of HIPAA-relevant logging/retention boundaries, audit-log configurability, PHI-bearing API/log surfaces, off-system disclosure implications for future LLM calls, and GPLv3 release constraints. Reviewed OpenEMR audit/event logging code, defaults in global settings, API logging sinks, patient view events, audit/log schema, audit log UI, tamper-reporting UI, optional ATNA forwarding hooks, and repository license/header posture. Searched reviewed PHP/SQL/Markdown surfaces for retention, purge, and breach-notification workflows. This is compliance evidence and implementation constraint capture, not legal advice; BAA/provider terms and breach-notification procedures require later owner/legal confirmation before real PHI leaves OpenEMR.

## Appendix B — References

_Standards, OpenEMR documentation pages, HIPAA-relevant publications, and external advisories cited above._

- OpenEMR source files and GPLv3 license in this fork, reviewed locally on 2026-04-28.
- HIPAA/BAA implications are captured as project constraints only; no legal conclusion is made in this audit.
