# Clinical Copilot — OpenEMR Audit

> Built on OpenEMR. Developed during the Gauntlet AI AgentForge program. Stage 3 hard-gate deliverable.

> **Status:** Stage 3 hard-gate evidence and constraints document. Static review of the OpenEMR fork at HEAD on 2026-04-28. No live runtime, no production data, no profiler output. This document synthesizes two parallel audits ([`AUDIT.md`](AUDIT.md), [`audit2.md`](audit2.md)) into a single defensible deliverable. Severity legend used throughout: **Critical** (active risk to PHI, patient safety, or compliance — must address before agent touches production data), **High** (material gap that constrains agent design — address before Stage 4 build), **Medium** (notable risk shaping design choices), **Low** (hygiene), **Informational** (observation worth recording).

---

## Executive summary

OpenEMR couples a legacy `library/`/`interface/` UI (session/`globals.php` patient and encounter context) with modern `src/` APIs (FHIR R4, SMART on FHIR). A read-only clinical copilot is feasible; Stage 3 is **pre-code**—architecture must reflect chart context, identity, and risk before any LLM reads PHI. Nine constraints on Stage 4–5:

- **Cleartext PHI at rest** on `patient_data` (e.g. SSN, DOB, contact fields); [`CryptoGen`](src/Common/Crypto/CryptoGen.php) is not wired to clinical demographics. (→ §Security-5)
- **Browser/API session risk:** [`CORSListener`](src/RestControllers/Subscriber/CORSListener.php) reflects `Origin` with credentialed preflight; [`SessionConfigurationBuilder::forCore`](src/Common/Session/SessionConfigurationBuilder.php) sets `cookie_httponly=false` for the main UI cookie—cross-origin and XSS paths matter. (→ §Security-6, §Security-7)
- **OAuth/API role ≠ clinical role; staff `user/` FHIR is not patient-bound.** Principals are `users`/`patient`/`system`; fine-grained roles need ACL + routes. With `user/` scope, many FHIR handlers run GACL then **unbound** `getAll()`/`getOne()`; only `patient/` context passes a patient UUID bind—**AgentForge active-chart binding is the primary cross-patient control** for staff tokens, not a nice-to-have. (→ §Security-2, §Security-3)
- **GACL is action-scoped, not row-scoped**—`AclMain::aclCheckCore()` has no `pid`/encounter; **`admin/super` bypasses**; **`aclCheckAcoSpec()`** is fail-open on empty spec; **CHANGELOG** shows recurring IDOR/missing-ACL issues—**pin a patched baseline**, **no agent from admin**, **no sidecar direct DB**. (→ §Security-10)
- **No single “fetch the chart”**—PCP context spans many tables, wide joins, and **N+1** in services; latency and payload explode if unbounded. (→ §Architecture-2, §Performance-1, §Performance-7)
- **FHIR clinical-note `DocumentReference` reads `form_clinical_notes` only** ([`ClinicalNotesService`](src/Services/ClinicalNotesService.php)); **`form_soap` is not on the FHIR path**—MVP synthetic notes for FHIR belong in `form_clinical_notes` unless you add a custom SOAP endpoint. (→ §Architecture-3, §DataQuality-5)
- **Bundled demo cannot support the v1 returning-PCP persona** (e.g. easy-dev: thin charts, no longitudinal labs/notes richness)—**Synthea + curated fixtures** before meaningful eval. (→ §DataQuality-1, §DataQuality-5)
- **Logs can become PHI stores**—default full `api_log`, SQL audit with binds, audit encryption off. (→ §Security-4, §Compliance-1)
- **No shipped redaction layer, no LLM egress lock, no first-class agent audit actor**—BAA, minimum necessary, and attribution are prerequisites for real PHI outbound. (→ §Compliance-2, §Compliance-5, §Compliance-6)

**Not authorized without closing the above:** PHI to external LLMs without BAA/retention/training posture; “same as clinician sees” from REST/FHIR without **per-route ACL + patient binding**; agent launch from **`admin/super`**; role guarantees from OAuth scope alone; SOAP as FHIR DocumentReference **without** custom plumbing; PCP eval on **stock demo alone**. Evidence and mitigations: §1–§5; design inputs: §6.

---

## 1. Security

**Scope:** authentication, authorization, session management, data exposure vectors, PHI handling boundaries, transport security, secret management, and attack surface introduced or exposed by the AgentForge integration.

### Security-1: Browser UI authentication and chart context are session/global driven

- **Severity:** Medium
- **Description:** Normal OpenEMR UI authentication is enforced through the legacy bootstrap path: browser scripts include [`interface/globals.php`](interface/globals.php), which resolves site context, starts or reuses the active session, includes [`library/auth.inc.php`](library/auth.inc.php) unless `$ignoreAuth` is set, and exposes active `pid`, `encounter`, and authorization state through session/global context.
- **Evidence:**
    - [`interface/globals.php`](interface/globals.php) starts the active session and resolves `site_id` before database access, validates requested site ids, clears the session on site mismatch, and derives site paths from the session site.
    - [`interface/globals.php`](interface/globals.php) includes [`library/auth.inc.php`](library/auth.inc.php) when `$ignoreAuth` is false, initializes modules, seeds session `pid` from request data only when no session `pid` exists, and mirrors `pid`/`encounter`/`userauthorized`/`groupname` into the globals bag.
    - [`src/Common/Auth/AuthUtils.php`](src/Common/Auth/AuthUtils.php) validates active sessions by comparing session `authUser`, `authUserID`, and `authPass` against active `users` / `users_secure` rows and stores those values in the session at login.
    - [`src/Common/Session/PatientSessionUtil.php`](src/Common/Session/PatientSessionUtil.php) updates session/global `pid`, clears encounter on patient change, and emits a `"view"` audit event when patient context changes.
    - [`src/Common/Session/SessionUtil.php`](src/Common/Session/SessionUtil.php) documents that core OpenEMR session cookies are intentionally `HttpOnly=false` (see also Security-7).
- **Implications for the agent:** An embedded panel must treat OpenEMR's current user, site, patient, and encounter as security context, not as convenience state. Any route or module that uses `$ignoreAuth`, bypasses normal `globals.php` context, or accepts a patient id outside the active session needs explicit review before it can read chart data.
- **Mitigation / next step:** In Stage 4/5, keep any v1 embedded surface inside the authenticated OpenEMR context and require explicit evidence before adding non-standard entry points.
- **Related:** `Architecture-1`, `Architecture-4`, `Security-7`.

### Security-2: REST/FHIR auth is OAuth-scope based, but staff job roles collapse to `users`

- **Severity:** High
- **Description:** OpenEMR's API stack has a real authentication and authorization pipeline: site setup, OAuth/local strategies, route security events, OAuth scopes, patient-vs-user-vs-system role checks, and controller ACL checks. The API principal model does not distinguish physician, nurse, resident, or assistant at the token-role layer; staff API users are represented as `users`, with finer distinctions delegated to OpenEMR ACL checks and route/controller behavior.
- **Evidence:**
    - [`src/RestControllers/ApiApplication.php`](src/RestControllers/ApiApplication.php) wires `SiteSetupListener`, `OAuth2AuthorizationListener`, `AuthorizationListener`, and `RoutesExtensionListener` into the API request lifecycle.
    - [`src/RestControllers/Subscriber/SiteSetupListener.php`](src/RestControllers/Subscriber/SiteSetupListener.php) extracts the API site from the path, writes `$_GET['site']` for legacy compatibility, creates API/OAuth sessions, includes [`interface/globals.php`](interface/globals.php), and initializes OAuth keys/base URL.
    - [`src/RestControllers/Subscriber/AuthorizationListener.php`](src/RestControllers/Subscriber/AuthorizationListener.php) registers authorization strategies in order: local API, skip-authorized metadata/version/product routes, then bearer token authorization. Its route security handler enforces patient UUID presence for patient-context requests, blocks patient-role FHIR writes, restricts standard `/api/` calls to user-role scopes, and checks the constructed OAuth scope string.
    - [`src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php`](src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php) verifies bearer tokens, sets session `authUser` / `authUserID` / `authProvider` for `users`, requires `api:oemr` for standard API routes and `api:port` for portal routes, and allows `users` access to API/FHIR while allowing `patient` access to portal/FHIR and `system` access to FHIR.
    - [`src/Common/Auth/UuidUserAccount.php`](src/Common/Auth/UuidUserAccount.php) resolves API subjects only as `users`, `patient`, or `system`.
    - [`src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php`](src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php) has `checkUserHasAccessToPatient()` returning `true` with a TODO describing future provider/clinic patient filtering.
- **Implications for the agent:** A read-only copilot cannot infer clinician-specific read policy from API token role alone. The open handoff is not "OAuth or no OAuth"; it is whether the exact route/resource path also applies the OpenEMR ACLs and patient-binding semantics needed for the v1 clinician persona.
- **Mitigation / next step:** Test candidate chart-read routes with distinct OpenEMR ACL users (physician, nurse, resident) before claiming role-specific behavior; document each route's effective enforcement layer in Stage 5 ARCHITECTURE.md.
- **Related:** `Architecture-3`, `Security-3`, `Security-10`.

### Security-3: FHIR patient-context reads and staff ACL reads follow different enforcement paths

- **Severity:** High
- **Description:** FHIR reads are not one uniform authorization surface. Generic FHIR controllers run configured ACL checks for non-patient requests, but patient-context requests bind to a patient UUID and skip the controller's generic ACL loop before filtering returned resources. For staff `user/` scope, many route handlers authorize the ACO action and then call the controller without a patient UUID bind; only `patient/` context supplies `$puuidBind`.
- **Evidence:**
    - [`src/Common/Http/HttpRestRouteHandler.php`](src/Common/Http/HttpRestRouteHandler.php) marks a request as patient-context when the requested resource's scope context is `patient`, dispatches `RestApiSecurityCheckEvent`, and maps `GET` to `r` for instance reads or `s` for searches.
    - [`src/RestControllers/Subscriber/AuthorizationListener.php`](src/RestControllers/Subscriber/AuthorizationListener.php) changes scope type to `patient` for patient requests with a patient UUID and checks the resulting `patient/<Resource>.<permission>` or `user/<Resource>.<permission>` OAuth scope.
    - [`src/RestControllers/FHIR/FhirGenericRestController.php`](src/RestControllers/FHIR/FhirGenericRestController.php) sets `$puuidBind` from the request when `isPatientRequest()` is true; otherwise it loops through `$this->aclChecks` and calls `RestConfig::request_authorization_check()`.
    - [`src/RestControllers/Config/RestConfig.php`](src/RestControllers/Config/RestConfig.php) delegates those authorization checks to `AclMain::aclCheckCore()` for the request session's `authUser`.
    - [`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`](apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php) repeats the pattern: `isPatientRequest()` branches pass `$request->getPatientUUIDString()` to controller reads, while the `else` branch calls `RestConfig::request_authorization_check()` and then dispatches unbound `getAll()` / `getOne()` calls.
    - [`src/Common/Http/HttpRestRequest.php`](src/Common/Http/HttpRestRequest.php) exposes `getPatientUUIDString()` for the bound patient context; this value is not automatically supplied to staff `user/` route branches.
- **Implications for the agent:** The same clinical fact may be reachable through different security paths depending on whether AgentForge reads it through a user-scoped staff route, a patient-compartment FHIR route, or a local in-browser API call. That matters for minimum-necessary access, auditability, and any future claim about "same permissions as the logged-in clinician." If the sidecar uses staff `user/` scope, its `target_patient_id == active chart patient` check is the primary wall against cross-patient prompt/tool injection, not a secondary control.
- **Mitigation / next step:** For each v1 chart source, record the exact read path and whether enforcement is user ACL, OAuth scope, patient binding, or local session inheritance. For staff-scope FHIR reads, forbid tool calls that accept arbitrary patient UUIDs unless the read boundary first matches them against the OpenEMR active patient/session context.
- **Related:** `Security-2`, `Security-10`, `Architecture-3`.

### Security-4: Current logging surfaces can retain PHI-rich request, SQL, and API payload details

- **Severity:** High
- **Description:** OpenEMR has strong audit surfaces, but those surfaces can also become PHI stores. HTTP request logging records paths and query strings, SQL audit logging records statements and bind values for classified tables, and API response logging can persist full JSON responses when configured for full logging. Audit-log encryption is **disabled** by default.
- **Evidence:**
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) reads global flags for audit logging, query events, HTTP request events, per-event-type flags, audit-log encryption, and optional ATNA sinks.
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) SQL audit logging stores the SQL statement and appends quoted bind values, classifies common patient/lab/order/security tables, and records patient id from session `pid` for patient-record events.
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) stores comments encrypted only when audit-log encryption is enabled; otherwise it base64-encodes them. Its HTTP request logger records `SCRIPT_NAME` plus `QUERY_STRING`.
    - [`src/RestControllers/Subscriber/ApiResponseLoggerListener.php`](src/RestControllers/Subscriber/ApiResponseLoggerListener.php) logs non-local API calls when `api_log_option > 0`; in full mode (`= 2`) it writes the JSON response into both `request_body` and `response`.
    - [`library/globals.inc.php`](library/globals.inc.php) defaults HTTP page-history audit logging to enabled, audit-log encryption to **disabled**, and `api_log_option` to **`2` / full logging**.
    - [`src/Common/Logging/Audit/LogTablesSink.php`](src/Common/Logging/Audit/LogTablesSink.php) writes audit records to `log`, `log_comment_encrypt`, and `api_log`, including request URL/body and response for API entries.
- **Implications for the agent:** AgentForge must assume that chart reads, prompt inputs, generated summaries, and API responses are PHI unless proven otherwise. Before any PHI is sent to an external LLM provider or stored in an agent-specific log, the project needs an explicit PHI logging and retention decision rather than relying on OpenEMR's generic audit defaults.
- **Mitigation / next step:** Log access events and source ids, not full chart text or generated summaries, unless a compliance-reviewed retention/encryption policy says otherwise. Flip `api_log_option` to a redacted/metadata-only mode and enable audit-log encryption in any environment carrying real PHI.
- **Related:** `Compliance-1`, `Compliance-2`, `Compliance-6`.

### Security-5: PHI columns are stored in cleartext at rest; encryption is wired to secrets, not to clinical data

- **Severity:** Critical
- **Description:** OpenEMR's [`CryptoGen`](src/Common/Crypto/CryptoGen.php) implementation is real and reasonable (AES-256-CBC with HMAC-SHA384, encrypt-then-MAC, two key sets — one in the `keys` table, one on disk under `sites/<site>/documents/logs_and_misc/methods/`, with `KeyVersion` enum for backwards compatibility). It is, however, **not** applied to PHI columns on the patient record. Whatever the agent reads from `patient_data`, it reads in cleartext.
- **Evidence:**
    - [`sql/database.sql`](sql/database.sql) `patient_data` definition (line 8334+) declares the following PHI columns as plain `varchar(255) NOT NULL DEFAULT ''` (or `date`): `DOB` (8343), `street` (8344), `postal_code` (8345), `city` (8346), `drivers_license` (8349), `ss` (8350 — social security), `phone_home` / `phone_biz` / `phone_contact` / `phone_cell` (8352–8355), `email` (8365), `email_direct` (8366).
    - [`sql/database.sql`](sql/database.sql) line 1245 — `users.ssn VARCHAR(31) DEFAULT NULL COMMENT 'Should be encrypted in application'` — the schema **explicitly acknowledges** the gap on a different table; the same comment is missing from `patient_data.ss` even though the column has the same sensitivity.
    - [`src/Common/Crypto/CryptoGen.php:61, 144–181`](src/Common/Crypto/CryptoGen.php) — `encryptStandard()`/`coreEncrypt()` use `aes-256-cbc` plus HMAC-SHA384 over `iv . processedValue`, prefix the result with a `KeyVersion` and base64-encode it.
    - Repository-wide search for `encryptStandard|decryptStandard` in `src/` finds usage in payment processing (Stripe, Sphere, Authorize.Net, Rainforest), OAuth (`AuthorizationController`, `TokenIntrospectionRestController`, `OAuth2KeyConfig`, `ClientRepository`), MFA (`MfaUtils`), audit-log comments (`EventAuditLogger`), one-time auth tokens, USPS verification, billing, SMART launch tokens, and a few command/notification utilities — but **not** in `PatientService`, `EncounterService`, `UserService`, or any patient-demographics writer.
- **Implications for the agent:** The agent does not get encrypted-at-rest PHI from the read boundary; it gets PHI in cleartext. That has three downstream consequences: (1) the read service is responsible for any encryption-at-rest contract the agent makes downstream, not OpenEMR; (2) any caching layer that holds chart facts inherits PHI obligations on first byte; (3) database-level dumps and replicas are PHI dumps in the clear unless the operator runs disk encryption.
- **Mitigation / next step:** Treat the OpenEMR database as a cleartext PHI store for design purposes. The "fix at-rest encryption for `patient_data`" project is out of scope for AgentForge's one-week sprint; the in-scope obligation is to (a) avoid materializing additional PHI in caches, logs, or prompts, (b) exclude `ss`, `drivers_license`, and similar identifiers from the default LLM/tool context unless a reviewed use case explicitly requires them, and (c) add disk-level encryption in the deployment plan.
- **Related:** `Compliance-2`, `Compliance-3`, `Performance-5`.

### Security-6: CORS reflects request `Origin` while emitting credentialed responses

- **Severity:** Critical
- **Description:** [`src/RestControllers/Subscriber/CORSListener.php`](src/RestControllers/Subscriber/CORSListener.php) reflects whatever `Origin` header the requesting browser sends back into `Access-Control-Allow-Origin`, and the OPTIONS preflight emits `Access-Control-Allow-Credentials: true`. Combined, any third-party origin a logged-in user's browser visits can issue authenticated cross-origin requests against the OpenEMR API and read the response.
- **Evidence:**
    - [`src/RestControllers/Subscriber/CORSListener.php:57`](src/RestControllers/Subscriber/CORSListener.php) — in `onKernelResponse`, `$response->headers->set("Access-Control-Allow-Origin", $origins[0]);` reflects the first `Origin` header value with no allowlist check.
    - [`src/RestControllers/Subscriber/CORSListener.php:67`](src/RestControllers/Subscriber/CORSListener.php) — the `getInitialResponse()` OPTIONS handler returns `'Access-Control-Allow-Credentials' => 'true'` plus an Origin reflection at line 73.
    - [`src/RestControllers/Subscriber/CORSListener.php:69`](src/RestControllers/Subscriber/CORSListener.php) — syntax error: `"Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, PATCH, TRACE, OPTIONS"` uses a comma instead of `=>` in the array literal, so the `Allow-Methods` header is silently dropped from the preflight (the entry becomes two unkeyed array values).
    - [`src/RestControllers/Subscriber/CORSListener.php:55, 72`](src/RestControllers/Subscriber/CORSListener.php) — TODO comments by `@adunsulag` already flag the open question of whether to allow all origins or restrict.
- **Implications for the agent:** Any browser-embedded copilot UI that reads chart data through the OpenEMR API inherits this trust boundary. Adding an LLM call from the same browser context multiplies the attack surface, because a malicious origin that gets a CORS-authenticated session can also read whatever the agent fetches into the DOM.
- **Mitigation / next step:** Replace reflection with an explicit allowlist of registered SMART app origins (and any internal AgentForge UI host) before any deployment carries real PHI. Fix the line-69 syntax bug at the same time.
- **Related:** `Security-7`, `Security-11`, `Compliance-5`.

### Security-7: Core session cookie is not `HttpOnly` and is not `Secure` by default

- **Severity:** High
- **Description:** [`src/Common/Session/SessionConfigurationBuilder.php`](src/Common/Session/SessionConfigurationBuilder.php) sets reasonable defaults (`use_strict_mode=true`, `cookie_samesite=Strict`, `cookie_httponly=true`, `cookie_secure=false`), but the `forCore()` preset explicitly **overrides** `cookie_httponly` back to `false` for the main UI session so JavaScript can read separate-window logins. `cookie_secure` is left at `false`. Reflected XSS in any UI page can therefore steal the session cookie, and the cookie can travel over plain HTTP if TLS is not enforced upstream.
- **Evidence:**
    - [`src/Common/Session/SessionConfigurationBuilder.php:20–28`](src/Common/Session/SessionConfigurationBuilder.php) — constructor defaults: `cookie_samesite='Strict'`, `cookie_secure=false`, `cookie_httponly=true`.
    - [`src/Common/Session/SessionConfigurationBuilder.php:83–91`](src/Common/Session/SessionConfigurationBuilder.php) — `forCore()` calls `->setCookieHttpOnly(false)` with no compensating `setCookieSecure(true)`.
    - [`src/Common/Session/SessionConfigurationBuilder.php:94–101, 105–112`](src/Common/Session/SessionConfigurationBuilder.php) — by contrast, `forOAuth()` and `forApi()` correctly set `cookie_secure=true` (and `forOAuth()` sets `cookie_samesite='None'` for cross-site OAuth flows). The asymmetry is intentional but means the **most privileged** session has the **weakest** cookie defaults.
    - [`src/Common/Session/SessionConfigurationBuilder.php:115–122`](src/Common/Session/SessionConfigurationBuilder.php) — the portal preset (`forPortal`) also leaves `cookie_secure=false` (default).
- **Implications for the agent:** A clinical copilot embedded in the OpenEMR UI runs in the same JavaScript context as the core session cookie. Any new page the agent introduces is a new XSS attack surface for that cookie. The agent's own UI must set CSP, sanitize all rendered model output, and prefer iframe isolation if model output ever reaches the DOM.
- **Mitigation / next step:** Set `cookie_secure=true` for `forCore()` and `forPortal()` in any production-like deployment. Identify the script(s) that need JS access to `OpenEMR` cookies and migrate them off cookie reads; do not weaken the cookie. Independently, treat the embedded UI as a high-CSP surface from day one.
- **Related:** `Security-1`, `Security-6`, `Security-11`.

### Security-8: API 500 responses leak raw exception messages

- **Severity:** Medium
- **Description:** [`apis/dispatch.php`](apis/dispatch.php) catches `\Throwable` at the top of the API entry point and emits the raw `$e->getMessage()` into the JSON response. This contradicts [`CLAUDE.md`](CLAUDE.md)'s own guidance ("Never expose `$e->getMessage()` in user-facing output. Exception messages may contain internal details (SQL, file paths)"). DB column names, file paths, and internal stack details will leak to any unauthenticated caller that triggers an exception.
- **Evidence:**
    - [`apis/dispatch.php:31–45`](apis/dispatch.php) — `catch (\Throwable $e)` block calls `error_log($e->getMessage())` and `error_log($e->getTraceAsString())` (correct for server logs), then `die(json_encode([... 'message' => $e->getMessage() ...]))` (incorrect for user-facing response).
- **Implications for the agent:** Errors triggered through the agent's own tool calls (malformed SQL parameters, missing FHIR resources) will leak internals through the same path. The agent's tool error surface should normalize 5xx responses before the user-visible message hits the chat UI.
- **Mitigation / next step:** Replace the `'message' => $e->getMessage()` payload with a generic `'message' => 'An error occurred while processing the request.'` plus a correlation id; keep `error_log` calls intact for server-side debugging.
- **Related:** `Security-4`.

### Security-9: Default install posture exposes well-known credentials if leaked to production

- **Severity:** Medium
- **Description:** [`sites/default/sqlconf.php`](sites/default/sqlconf.php) ships with `login = 'openemr'`, `pass = 'openemr'`, `host = 'localhost'`, and the documented default admin user is `admin` / `pass` ([`CLAUDE.md`](CLAUDE.md), [`docker/development-easy/`](docker/development-easy/)). The production Docker compose also documents and sets `OE_USER=admin` / `OE_PASS=pass` by default. The installer normally rewrites these, but a Docker or dev posture leaked to a public demo carries well-known credentials.
- **Evidence:**
    - [`sites/default/sqlconf.php`](sites/default/sqlconf.php) ships with template DB credentials.
    - [`CLAUDE.md`](CLAUDE.md) — "App URL: http://localhost:8300/ ... Login: admin / pass".
    - [`docker/production/docker-compose.yml`](docker/production/docker-compose.yml) comments that `OE_USER` and `OE_PASS` default to `admin` and `pass`, and the checked-in compose file sets those values explicitly.
- **Implications for the agent:** Demo deployments must verify both credentials are rotated before the URL is shareable. A public AgentForge demo that forgets one environment override starts with full administrative OpenEMR access.
- **Mitigation / next step:** Add a deployment pre-flight check that asserts the admin password is not `pass`, `OE_USER` / `OE_PASS` are overridden for any non-loopback deployment, and `sqlconf.php` does not match the template before exposing the deployment URL.
- **Related:** `Compliance-2`, `Security-10`.

### Security-10: GACL semantics, superuser bypass, and fail-open caller bugs

- **Severity:** High
- **Description:** OpenEMR's core GACL check is action-scoped, not row-scoped. `AclMain::aclCheckCore()` evaluates an ACO section/value pair for a user; it does not accept patient id, encounter id, or facility scope. That makes the route/read boundary responsible for patient scoping, and it also means privileged users and caller mistakes can widen access dramatically.
- **Evidence:**
    - [`src/Common/Acl/AclMain.php`](src/Common/Acl/AclMain.php) `aclCheckCore($section, $value, $user, $return_value)` takes section/value/user arguments and no `pid`, encounter, or facility argument.
    - [`src/Common/Acl/AclMain.php`](src/Common/Acl/AclMain.php) short-circuits to allow access when the user has `admin/super`, unless the current check is itself for `admin/super`.
    - [`src/Common/Acl/AclMain.php`](src/Common/Acl/AclMain.php) `aclCheckAcoSpec()` returns `true` when the caller supplies an empty ACO spec, so a missing/empty authorization declaration fails open.
    - [`CHANGELOG.md`](CHANGELOG.md) for the current line includes recent advisories for missing authorization, IDOR, missing ACL checks, `zhAclCheck` explicit-deny behavior, and multiple stored-XSS issues.
- **Implications for the agent:** A sidecar or agent-context service that bypasses OpenEMR routes and reads the database directly bypasses even action-scoped GACL. A staff token issued from an admin account is not equivalent to "physician privileges"; it is effectively superuser. Any custom route or module must use explicit, non-empty ACL declarations and still perform its own patient binding.
- **Mitigation / next step:** Forbid agent launch/token minting from `admin` / `admin/super` accounts, pin a patched OpenEMR version before any PHI-bearing deployment, and treat per-patient binding as a separate invariant from GACL action authorization.
- **Related:** `Security-2`, `Security-3`, `Security-9`, `Architecture-3`.

### Security-11: Embedded UI iframe and OAuth token exposure

- **Severity:** High
- **Description:** The embedded AgentForge UI creates a browser integration seam separate from the OpenEMR API boundary. OpenEMR login and portal entry points set frame-denial headers, but normal encounter/chart pages are meant to host embedded content. The risk for AgentForge is the inverse direction: leaking OAuth bearer material or patient context from the iframe handoff into URLs, referrers, browser history, logs, or an over-broad framing policy.
- **Evidence:**
    - [`interface/login/login.php`](interface/login/login.php) and [`portal/index.php`](portal/index.php) set frame-denial headers; encounter/chart surfaces do not have the same simple global deny posture because they need to render normal authenticated UI.
    - [`src/Common/Session/SessionConfigurationBuilder.php`](src/Common/Session/SessionConfigurationBuilder.php) sets the OAuth session to `SameSite=None; Secure`, which is necessary for cross-site OAuth/iframe flows but means chat/tool endpoints must validate bearer tokens on every call rather than relying on cookie same-site behavior.
    - `Security-7` documents that the core UI session cookie is readable by JavaScript, making model-output rendering and iframe boundaries part of the security story.
- **Implications for the agent:** Passing OAuth tokens in an iframe URL is too leaky for a PHI-bearing copilot. Referrer headers, server access logs, browser history, screenshots, or support tooling can all capture the token-bearing URL. A malicious framed parent/child relationship also needs to be constrained explicitly.
- **Mitigation / next step:** Prefer a parent-to-iframe `postMessage` handshake or short-lived one-time launch code over bearer tokens in URLs. Serve the sidecar with a narrow `Content-Security-Policy: frame-ancestors` allowlist for the OpenEMR origin, sanitize all rendered model output, and validate bearer/launch state on every chat/tool request.
- **Related:** `Security-6`, `Security-7`, `Architecture-4`, `Compliance-5`.

---

## 2. Performance

**Scope:** query latency baselines, database bottlenecks, page render times, payload sizes for chart-relevant data, indexing gaps, and any constraint that will affect the agent's response budget.

### Performance-1: Adult PCP chart context is currently a multi-read aggregation, not a single low-latency chart summary

- **Severity:** High
- **Description:** Current OpenEMR does not expose one bounded, source-attributed "adult PCP chart context" read. The needed context spans patient demographics, encounter timeline, problem/allergy/medication lists, prescriptions, vitals/forms, procedure/lab lineage, clinical notes/documents, and history/social-history snapshots, so response latency will be dominated by aggregation shape unless the v1 read path is explicitly bounded.
- **Evidence:**
    - `Architecture-2` and `DataQuality-2` already identify the source families needed for the v1 chart.
    - [`src/Services/EncounterService.php`](src/Services/EncounterService.php) can return all encounters for a patient through a wide join unless callers pass explicit `limit` / `order` options; its `getMostRecentEncounterForPatient()` exists because default encounter-id ordering is not necessarily clinical recency.
    - [`src/Services/BaseService.php`](src/Services/BaseService.php) documents that an empty search returns all records for the service table, which is dangerous if a chart reader forgets a patient/date/source bound.
    - [`src/Services/SocialHistoryService.php`](src/Services/SocialHistoryService.php) treats `history_data` as insert history and usually returns the latest patient snapshot, while other chart areas use full timelines or one-to-many joins.
- **Implications for the agent:** A between-rooms physician workflow cannot depend on "fetch the chart" as a single cheap operation. The first usable answer needs a measured, bounded source set: likely patient identity, recent encounters, active meds/problems/allergies, recent vitals/labs, and selected notes/doc metadata rather than unbounded history.
- **Mitigation / next step:** Before final architecture, prototype and measure the exact v1 chart-source bundle against augmented longitudinal synthetic data with explicit row/window limits.
- **Related:** `Architecture-2`, `DataQuality-2`, `Performance-7`.

### Performance-2: Chart-relevant service queries use wide joins, unions, and one-to-many hydration

- **Severity:** High
- **Description:** Several current services are optimized for rich API/resource mapping, not for a minimal "what changed since last visit" context packet. The SQL often joins lookup/provider/facility/patient tables, fans out one-to-many clinical rows, and then hydrates/deduplicates in PHP.
- **Evidence:**
    - [`src/Services/EncounterService.php`](src/Services/EncounterService.php) builds a wide encounter projection over `form_encounter` plus categories, class options, facilities, patient ids, providers, referrers, and discharge options, with optional but not default caller-provided limits.
    - [`src/Services/PrescriptionService.php`](src/Services/PrescriptionService.php) builds medications as a `UNION` of `prescriptions` and `lists` medication rows, then joins route/unit/interval/adherence/reporting-source/patient/encounter/practitioner lookups.
    - [`src/Services/VitalsService.php`](src/Services/VitalsService.php) joins `form_vitals` to `forms`, `form_encounter`, `patient_data`, `users`, and `form_vital_details`, then collapses detail rows back into one record per form in PHP.
    - [`src/Services/ProcedureService.php`](src/Services/ProcedureService.php) starts from active `procedure_order` rows and left-joins order codes, reports, results, abnormal flags, procedure types, encounters, labs, documents, providers, and facilities.
    - [`src/Services/AllergyIntoleranceService.php`](src/Services/AllergyIntoleranceService.php) joins `lists` through patient/practitioner/facility/list-option subqueries and then deduplicates rows in PHP when allergies have no associated user.
    - Schema review in [`sql/database.sql`](sql/database.sql) shows useful per-table indexes such as `form_encounter.pid_encounter`, `form_encounter.encounter_date`, `forms.pid_encounter`, `documents.foreign_id`, `history_data.pid`, and procedure-result lineage keys, but `lists` has separate `pid` and `type` keys rather than an obvious composite `(pid, type)` key for problem/allergy/medication slices.
- **Implications for the agent:** Final context size may be small while the retrieval work is large. Medications, vitals, and labs are the highest-risk sources for query/hydration amplification; notes and documents are the highest-risk sources for large text payloads.
- **Mitigation / next step:** Measure per-source SQL count, DB time, hydrated row count, returned item count, bytes, and tokenized payload size before choosing REST/FHIR-only versus an internal/module read boundary.
- **Related:** `DataQuality-2`, `Performance-7`.

### Performance-3: REST/FHIR is cleaner as a boundary but adds per-resource overhead and uneven pagination behavior

- **Severity:** Medium
- **Description:** REST/FHIR reads provide standardized resources, route-level security, and future extraction potential, but each API call pays the full OpenEMR API stack and FHIR serialization cost. Pagination and server-side limiting are not uniform across resource services, so `_count` cannot be assumed to cap database work for every source.
- **Evidence:**
    - [`src/RestControllers/ApiApplication.php`](src/RestControllers/ApiApplication.php) wires exception, telemetry, API response logging, session cleanup, site setup, CORS, OAuth2 authorization, authorization, route extension, and view-renderer subscribers before `OEHttpKernel` handles the request.
    - [`src/RestControllers/Subscriber/RoutesExtensionListener.php`](src/RestControllers/Subscriber/RoutesExtensionListener.php) normalizes FHIR search requests, creates a `FhirRouteFinder`, builds a `FhirServiceLocator`, dispatches through `HttpRestRouteHandler`, and follows a separate route-finder path for standard API calls.
    - [`src/RestControllers/FHIR/FhirGenericRestController.php`](src/RestControllers/FHIR/FhirGenericRestController.php) runs ACL checks for non-patient requests, calls the FHIR service, then applies per-resource `canAccessResource()` filtering before constructing bundle entries.
    - Many hand-authored FHIR routes also call `RestConfig::request_authorization_check()` per resource before dispatching to controllers. A seven-source chart context can therefore pay seven API bootstraps, seven route/security passes, and seven session/auth checks unless the caller parallelizes fan-out or introduces a bounded agent-context read boundary.
    - [`src/Services/FHIR/FhirServiceBase.php`](src/Services/FHIR/FhirServiceBase.php) parses `_revinclude=Provenance:target`, maps FHIR search params into OpenEMR search params, parses `_count` / `_offset` into a `SearchQueryConfig`, but its default `searchForOpenEMRRecordsWithConfig()` simply delegates to `searchForOpenEMRRecords()` unless a concrete service overrides it.
    - [`src/Services/FHIR/FhirPatientService.php`](src/Services/FHIR/FhirPatientService.php) overrides the config-aware search path and passes `SearchQueryConfig` into `PatientService::search()`, while [`src/Services/FHIR/FhirEncounterService.php`](src/Services/FHIR/FhirEncounterService.php) delegates without a config-aware override.
    - [`src/Services/FHIR/FhirResourcesService.php`](src/Services/FHIR/FhirResourcesService.php) creates FHIR bundles whose `total` is `count($resource_array)`, i.e. returned entries, not necessarily full matching-row cardinality.
- **Implications for the agent:** API-only aggregation is attractive for safety and separation, but a chart summary built from Patient, Encounter, Condition, AllergyIntolerance, MedicationRequest, Observation, DiagnosticReport, and DocumentReference may require many HTTP calls, repeated bootstrap/auth work, larger FHIR JSON payloads, and resource-specific pagination validation. Internal service calls can reduce round trips and serialization, but then authorization and audit parity must be proven. The changelog also records a recent `PHPSessionWrapper` read-and-close lock-contention fix, so pinning a patched baseline matters for latency as well as security.
- **Mitigation / next step:** Benchmark the same v1 chart bundle through REST/FHIR and through an in-process module/service boundary before selecting the final read architecture. If FHIR stays as the v1 boundary, parallelize independent resource reads client-side and measure cold/warm latency with audit/API logging enabled.
- **Related:** `Architecture-3`, `Security-2`, `Security-3`.

### Performance-4: Payload and context-window risk comes from wide clinical rows, documents, FHIR wrappers, and observation expansion

- **Severity:** High
- **Description:** Several current read paths can return more text or structure than an LLM should receive. A large-context model would hide the problem during a demo but would not solve latency, cost, privacy, or verification risk.
- **Evidence:**
    - [`src/Services/PatientService.php:659`](src/Services/PatientService.php) uses `SELECT *` for `findByPid()`, while `patient_data` contains a wide demographic/custom-field row.
    - [`sql/database.sql`](sql/database.sql) defines `documents.document_data` as `MEDIUMTEXT`; [`src/Services/DocumentService.php`](src/Services/DocumentService.php) separately supports metadata listing, download links, and full file retrieval through `getFile()`, so metadata and content have very different payload profiles.
    - [`src/Services/ClinicalNotesService.php`](src/Services/ClinicalNotesService.php) selects clinical-note descriptions plus encounter/patient/provider/category joins, and returns empty results when the installed clinical-notes table lacks the expected `code` column.
    - [`src/Services/FHIR/FhirObservationService.php`](src/Services/FHIR/FhirObservationService.php) composes many observation sub-services; when no category/code narrows the search, it searches all mapped services. `FhirObservationVitalsService` can turn each vitals row into many individual FHIR Observations, and `FhirObservationLaboratoryService` turns procedure reports/results into Observation records.
    - FHIR bundle responses include wrapper metadata, full URLs, resource profiles, references, and optional Provenance resources, increasing payload size relative to a slim internal source pack.
- **Implications for the agent:** Context-window selection must follow measured payload sizes, not precede them. For v1 the risk is not only "will it fit"; it is whether the context remains source-attributed, minimum-necessary, fast enough, and cheap enough for a physician moving between rooms.
- **Mitigation / next step:** Measure bytes and tokens by source family and by answer type, especially notes/documents and broad Observation reads, before selecting model/context-window requirements.
- **Related:** `Security-4`, `DataQuality-4`, `Performance-7`.

### Performance-5: Caching and observability can improve latency but are PHI-sensitive and invalidation-heavy

- **Severity:** High
- **Description:** Current OpenEMR has request-local caching and configurable audit/API logging surfaces but no reviewed chart-summary cache or request-level APM built for AgentForge. Any future cache or trace that contains chart facts, prompts, source packs, or generated summaries is a PHI-bearing artifact with invalidation and retention obligations.
- **Evidence:**
    - [`src/Common/Translation/TranslationCache.php`](src/Common/Translation/TranslationCache.php) and [`library/translation.inc.php`](library/translation.inc.php) provide request/process-local translation caching and optional warmup, but that is UI translation support, not chart-context caching.
    - [`src/RestControllers/Subscriber/ApiResponseLoggerListener.php`](src/RestControllers/Subscriber/ApiResponseLoggerListener.php) logs API request URL and, when `api_log_option` is full logging, JSON response content into both `request_body` and `response`.
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php), [`src/Common/Logging/AuditConfig.php`](src/Common/Logging/AuditConfig.php), [`library/ADODB_mysqli_log.php`](library/ADODB_mysqli_log.php), [`src/Common/Database/QueryUtils.php`](src/Common/Database/QueryUtils.php), and [`library/sql.inc.php`](library/sql.inc.php) show that SQL/audit behavior depends on global settings and no-log call paths.
    - [`interface/globals.php`](interface/globals.php) can log HTTP request paths/query strings and warm translation cache depending on global flags.
    - Reviewed telemetry code is usage/version reporting rather than request-level tracing/APM; no OpenTelemetry/Prometheus/New Relic/Datadog-style application tracing was found in the sampled PHP paths. [`src/Common/Utils/CacheUtils.php`](src/Common/Utils/CacheUtils.php) only does asset cache-busting via `?v=`.
- **Implications for the agent:** Performance measurement must record operational metadata without retaining full PHI by default. Caches must be scoped by site, user authorization context, patient, source set, and retrieval timestamp, and invalidated or bypassed when chart data changes, permissions change, or the clinician requests the freshest chart.
- **Mitigation / next step:** Define PHI-minimized observability before implementation and measure cold/warm latency with current audit/API logging settings enabled and disabled in a synthetic-only environment.
- **Related:** `Security-4`, `Compliance-1`, `Compliance-3`.

### Performance-6: Zero foreign keys across ~282 tables; indexing is sparse and uneven

- **Severity:** High
- **Description:** Storage engine is InnoDB across nearly all 282 tables, but **no `FOREIGN KEY` constraints are declared anywhere** in [`sql/database.sql`](sql/database.sql). Cascading deletes, orphan-row prevention, and referential integrity are entirely application-side. Indexing density is roughly 1.85 indexes per table on average, with critical clinical and audit-review paths under-indexed.
- **Evidence:**
    - `grep "FOREIGN KEY" sql/database.sql` returns 0 matches.
    - [`sql/database.sql`](sql/database.sql) `patient_data`: PK on `id`, UNIQUE on `pid` and `uuid`, composite `(lname, fname)`, single-column `DOB`. **No** index on `email`, `pubpid`, `phone_*`, or `ss` — common search axes for clinician lookups and identity reconciliation.
    - [`sql/database.sql`](sql/database.sql) `forms`: PK on `id`, `(pid, encounter)`, `form_id`. **No** index on `form_name`, `formdir`, `deleted`, or `date`.
    - [`sql/database.sql`](sql/database.sql) `form_encounter`: PK + `uuid` + `(pid, encounter)` + `encounter_date`. Reasonable.
    - [`sql/database.sql`](sql/database.sql) `form_clinical_notes`: PK + UNIQUE `uuid`, but **no** `pid`, `encounter`, or `(pid, encounter)` index even though those columns exist. "All notes for patient X" can become a table scan at pilot scale.
    - [`sql/database.sql`](sql/database.sql) `form_soap`: PK only. If SOAP notes become reachable through a custom endpoint, patient-note lookup needs an index before pilot-scale use.
    - [`sql/database.sql`](sql/database.sql) `log`: only `patient_id`. No index on `date`, `event`, `user`, or `category` (see `Performance-9`).
    - 75 columns declared `longtext` across the schema (`forms.form_name`, `forms.formdir`, `users.password` legacy, `users.info`, `lists.comments`, etc.) — stored off-page in InnoDB and pulled whenever a query writer uses `SELECT *`.
- **Implications for the agent:** The agent's chart-timeline join (`forms` → `form_encounter` → `procedure_result` → `lists` → `prescriptions`) is a multi-table hop with no FK enforcement and gappy indexing. A patient with `forms.pid` pointing at a deleted `patient_data.pid` is a possible state, not an impossible one. Identity-by-email or identity-by-phone lookups (e.g., merging external referrals) will full-scan unless the agent restricts to indexed paths. Notes are a special pilot risk: the demo may hide the missing clinical-note indexes because the table is empty, while real note Q&A will hit exactly the unindexed `pid`/`encounter` access pattern.
- **Mitigation / next step:** Treat orphan rows as a possible failure mode in the verification layer (`DataQuality-7`); avoid `SELECT *`; restrict agent lookups to indexed columns. Before pilot-scale note Q&A, evaluate adding `KEY (pid, encounter)` or an equivalent bounded notes-read path for `form_clinical_notes`; do the same for `form_soap` only if SOAP becomes a custom endpoint. Schema-level FK addition is out of scope for AgentForge but worth recording as an upstream OpenEMR issue.
- **Related:** `DataQuality-7`, `Performance-7`, `Performance-9`.

### Performance-7: N+1 query patterns and `SELECT *` survive in services

- **Severity:** High
- **Description:** Several service-layer paths fetch a parent set then issue per-row sub-queries (the classic N+1 pattern), and `SELECT *` against wide rows is still present. For a chart-summary use case that reads tens of children per parent, this is the dominant latency cost — and the strongest argument for a denormalized "agent context" read service rather than agent code calling existing services in a loop.
- **Evidence:**
    - `grep "while.*sqlFetchArray" src/Services/` returns matches in **36 service files**, including [`PatientService`](src/Services/PatientService.php), [`EncounterService`](src/Services/EncounterService.php), [`ProcedureService`](src/Services/ProcedureService.php), [`VitalsService`](src/Services/VitalsService.php), [`AllergyIntoleranceService`](src/Services/AllergyIntoleranceService.php), [`ConditionService`](src/Services/ConditionService.php), [`ImmunizationService`](src/Services/ImmunizationService.php), [`DocumentService`](src/Services/DocumentService.php), [`PractitionerRoleService`](src/Services/PractitionerRoleService.php), [`PatientNameHistoryService`](src/Services/PatientNameHistoryService.php), [`AppointmentService`](src/Services/AppointmentService.php), [`DrugService`](src/Services/DrugService.php), and others.
    - [`src/Services/PatientService.php:659`](src/Services/PatientService.php) — `findByPid()` runs `SELECT * FROM \`$table\`` against `patient_data` (a wide row including custom fields).
    - Symfony Cache is in `composer.json` but `PSR-6 CacheItemPoolInterface` usage is essentially absent outside [`src/BC/ServiceContainer.php`](src/BC/ServiceContainer.php). [`src/Common/Utils/CacheUtils.php`](src/Common/Utils/CacheUtils.php) only does asset cache-busting.
- **Implications for the agent:** Building the agent's chart context by composing existing services in PHP will inherit N+1 amplification on every request. A single denormalized read query (or a small number of bounded queries with explicit column lists) into a dedicated agent-context service is materially cheaper.
- **Mitigation / next step:** The Stage 4 read-boundary design should commit to a small number of explicit-column queries with `LIMIT`/window bounds and avoid composing existing services into loops. `PatientService::findByPid` is the natural first target for a column-projected variant.
- **Related:** `Performance-1`, `Performance-2`, `Architecture-2`.

### Performance-8: Doctrine Migrations is configured but holds only a bootstrap migration; real schema change rides upgrade SQL files

- **Severity:** Medium
- **Description:** Doctrine Migrations is configured in [`db/migration-config.php`](db/migration-config.php) and contains [`db/Migrations/Version00000000000000.php`](db/Migrations/Version00000000000000.php) as its only migration. Real schema changes ship through monolithic per-release SQL files in [`sql/`](sql/) (e.g. `2_6_0-to-2_6_1_upgrade.sql` … `7_0_2-to-7_0_3_upgrade.sql`). Validating an agent's queries against current vs older deployments is therefore not automatic.
- **Evidence:**
    - [`db/migration-config.php`](db/migration-config.php), [`db/Migrations/Version00000000000000.php`](db/Migrations/Version00000000000000.php) — only one migration registered.
    - [`sql/`](sql/) directory contains many `*_upgrade.sql` files, plus the canonical [`sql/database.sql`](sql/database.sql).
- **Implications for the agent:** Until Doctrine Migrations is the source of truth, the agent's queries should be smoke-tested against a fresh `sql/database.sql` dump in CI to catch schema drift. Hand-written agent SQL is a brittle dependency on schema version.
- **Mitigation / next step:** Add a CI smoke test that loads `sql/database.sql` into a throwaway database and runs each agent SQL statement (or the agent-context service's read path) before merge.
- **Related:** `Performance-7`, `DataQuality-7`.

### Performance-9: `log` table indexing is sparse for both write and read paths

- **Severity:** High
- **Description:** [`sql/database.sql`](sql/database.sql) defines the `log` table with only `patient_id` indexed. There is no index on `date`, `event`, `user`, or `category`. The agent will write to `log` on every chart read, and the audit-review UI ([`interface/logview/logview.php`](interface/logview/logview.php), [`interface/reports/audit_log_tamper_report.php`](interface/reports/audit_log_tamper_report.php)) reads from it — both sides degrade as the log grows. There is also no first-class "agent" or "machine" actor in `log_from`.
- **Evidence:**
    - [`sql/database.sql`](sql/database.sql) `log` table — `patient_id` is the only non-PK index.
    - [`library/globals.inc.php`](library/globals.inc.php) — `audit_events_query` defaults to `1`, meaning **every SELECT** can be logged. Combined with sparse indexes and no purge worker, the `log` table grows without bound.
    - `log_from` enum is `'open-emr'` / `'patient-portal'` (no agent value); see `Compliance-6`.
    - No retention/purge worker found in [`src/Services/Background/`](src/Services/Background/) or any cron registration.
- **Implications for the agent:** Audit *review* — the human-side of HIPAA accountability — gets slower as the log grows. The agent should not assume that "we logged it" plus "it's queryable" are both free.
- **Mitigation / next step:** Add `(date)`, `(user, date)`, `(event, date)` indexes on `log` and a nightly background service that rotates rows older than the configured retention window into a cold archive table. Pick an agent actor distinguisher in `log_from` (e.g., `'agent'`) before launch — retrofitting an enum value is harder than picking it once.
- **Related:** `Compliance-1`, `Compliance-3`, `Compliance-6`.

---

## 3. Architecture

**Scope:** how OpenEMR is organized (modules, libraries, namespaces), where data lives (schema layout, separation of concerns), how the request lifecycle flows, how layers interact (UI / controllers / services / data), and what integration points exist for adding the agent (events, hooks, modules, REST/FHIR APIs).

### Architecture takeaway

OpenEMR is best understood as a legacy PHP clinical application with modern layers added around it. The older application is concentrated in [`interface/`](interface/) browser pages and [`library/`](library/) helpers; the newer code is concentrated in [`src/`](src/) services, REST/FHIR controllers, events, and module infrastructure. The practical bridge between those worlds is [`interface/globals.php`](interface/globals.php), which acts as the shared application bootstrap: it establishes site context, session state, database access, global settings, authentication, current patient/encounter context, and module loading.

For AgentForge, the most important fact is that OpenEMR already owns the hard application context: logged-in user, selected patient, selected encounter, site, permissions, and chart data. A new read-only copilot should attach through supported extension points instead of bypassing that context. The architecture evidence points to an embedded custom module as the most practical v1 demo surface, while REST/FHIR remains the cleanest read boundary to preserve testability and future extraction.

### Architecture-1: OpenEMR is a hybrid legacy/modern system with `interface/globals.php` as the shared runtime bridge

- **Severity:** Medium
- **Description:** OpenEMR is not organized around one uniform application framework. Modern namespaced PHP lives under [`src/`](src/) (~1,938 files), while much of the browser UI remains legacy procedural PHP under [`interface/`](interface/) (~1,001 files) and [`library/`](library/) (~596 files). Both browser pages and API requests ultimately converge through [`interface/globals.php`](interface/globals.php) for site, session, database, globals, auth, and module setup.
- **Evidence:**
    - [`composer.json`](composer.json) maps `OpenEMR\` to `src/`, classmaps `library/classes`, and always-loads procedural helper files from `library/` (`global_functions.inc.php`, `htmlspecialchars.inc.php`, `formdata.inc.php`, `sanitize.inc.php`, `formatting.inc.php`, `date_functions.php`, `validate_core.php`, `translation.inc.php`).
    - [`public/index.php`](public/index.php) uses `FallbackRouter::performLegacyRouting()` and finally `require`s the resolved legacy file; comments explicitly say future modern routes should rely on DI and avoid globals.
    - [`src/BC/FallbackRouter.php`](src/BC/FallbackRouter.php) rewrites `/apis`, `/oauth2`, portal, and Zend-module paths to entry scripts, then `chdir`s and rewrites `$_SERVER['SCRIPT_FILENAME']`, `SCRIPT_NAME`, and `PHP_SELF` so legacy relative includes still work.
    - [`interface/globals.php`](interface/globals.php) (~809 lines) creates the `HttpRestRequest`, initializes `OEGlobalsBag`, derives the site, opens the SQL layer, loads site `config.php`, conditionally includes [`library/auth.inc.php`](library/auth.inc.php), initializes modules, then writes active `pid`, `encounter`, and authorization context back into the globals bag.
    - Three template engines coexist: Twig 3.x (modern), Smarty 4.5 (legacy), and PHP file rendering. Frontend uses Angular 1.8 (past EOL Jan 2022), jQuery 3.7, Bootstrap 4.6.
    - Example UI pages still follow the legacy bootstrap pattern: [`interface/main/main_screen.php`](interface/main/main_screen.php) sets `$sessionAllowWrite = true` and then `require_once('../globals.php')`; [`interface/patient_file/summary/demographics.php`](interface/patient_file/summary/demographics.php) requires `../../globals.php` and legacy library includes before rendering the chart summary.
- **Implications for the agent:** Any in-process AgentForge feature must account for two worlds at once: modern services and events are available, but request context and chart state still come from legacy globals/session variables. A read-only copilot should minimize direct dependence on `$GLOBALS`/ambient `$pid` where possible, and isolate any unavoidable use at the boundary.
- **Mitigation / next step:** Prefer an integration path that uses supported module/API/event seams while keeping AgentForge-specific chart aggregation in a small, testable boundary; carry detailed permission-scoping risks forward through `Security-2` and `Security-3`.
- **Related:** `Security-1`, `Security-7`, `Architecture-4`.

### Architecture-2: Chart data for the v1 PCP persona is distributed across clinical tables and service/FHIR adapters

- **Severity:** Medium
- **Description:** The patient chart data AgentForge needs is spread across schema areas and service adapters: demographics, encounters, polymorphic lists, prescriptions, vitals/forms, procedure/lab tables, documents, and users/providers. OpenEMR has useful service and FHIR layers over these tables, but the v1 "what changed since last visit" view will still need an explicit aggregation plan.
- **Evidence:**
    - Core tables in [`sql/database.sql`](sql/database.sql): `patient_data` stores patient demographics and PCP/care-team fields; `form_encounter` stores visit headers keyed by `pid` and `encounter`; `lists` stores typed rows such as problems and allergies; `prescriptions` stores prescription records; `form_vitals` stores vitals while `forms` links encounter forms by `pid`, `encounter`, `form_id`, and `formdir`; `procedure_order`, `procedure_report`, and `procedure_result` model lab/order/result flow; `documents` stores patient-linked document metadata/content; `users` stores practitioners/providers.
    - Service mapping is explicit in [`src/Services/`](src/Services/) (~181 services): `PatientService::TABLE_NAME = 'patient_data'`, `ConditionService` uses `lists` and forces `type = medical_problem`, `AllergyIntoleranceService` uses `lists` and forces `type = allergy`, `VitalsService::TABLE_VITALS = form_vitals`, `ProcedureService` starts from `procedure_order` and joins reports/results, `DocumentService::TABLE_NAME = documents`, and `PractitionerService` uses `users`.
    - FHIR services compose multiple internal sources: `FhirObservationService` registers vitals, laboratory, social-history, form, patient, employer, and preference observation services and narrows by `category`/`code`; `FhirConditionService` maps encounter diagnoses, problem-list items, and health concerns; `FhirDiagnosticReportService` maps clinical notes and laboratory reports.
    - Legacy chart fragments mirror the same distribution: [`interface/patient_file/summary/vitals_fragment.php`](interface/patient_file/summary/vitals_fragment.php) queries `form_vitals` joined to `forms`; [`interface/patient_file/summary/labdata_fragment.php`](interface/patient_file/summary/labdata_fragment.php) joins `procedure_report`, `procedure_order`, and `procedure_order_code` for recent lab data.
- **Implications for the agent:** Agent tools cannot safely treat "chart" as one source. Each claim category needs its own source path and citation model, especially because `lists` is polymorphic and labs require order/report/result traversal.
- **Mitigation / next step:** Define a read-only chart-snapshot/tool layer that normalizes only the v1 sources needed for adult PCP visits and preserves source pointers back to tables/resources.
- **Related:** `DataQuality-1`, `DataQuality-2`, `DataQuality-6`.

### Architecture-3: REST/FHIR APIs provide the cleanest read boundary, but identifier and resource coverage are uneven

- **Severity:** Medium
- **Description:** OpenEMR exposes a modern Symfony-event-driven API stack with both standard REST (~717 routes in [`apis/routes/_rest_routes_standard.inc.php`](apis/routes/_rest_routes_standard.inc.php)) and FHIR routes (~876 lines in [`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`](apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php), backed by 103 services in [`src/Services/FHIR/`](src/Services/FHIR/) and ~918 generated resource classes in [`src/FHIR/R4`](src/FHIR/R4)). The route surface is not uniform, however: standard REST mixes patient UUID and numeric `pid` paths, while FHIR resources are more standardized but federate some data through composite services and patient-binding logic.
- **Evidence:**
    - [`apis/dispatch.php`](apis/dispatch.php) creates an `HttpRestRequest` and runs `ApiApplication`.
    - [`src/RestControllers/ApiApplication.php`](src/RestControllers/ApiApplication.php) wires an event dispatcher with site setup, CORS, OAuth2 authorization, authorization, route extension, and view-renderer subscribers before passing the request to `OEHttpKernel`.
    - `SiteSetupListener` derives the site from the path, writes `$_GET['site']` for legacy compatibility, creates API/OAuth sessions, then includes [`interface/globals.php`](interface/globals.php).
    - `RoutesExtensionListener` branches to FHIR, portal, or standard API processing. `StandardRouteFinder` includes `_rest_routes_standard.inc.php` and dispatches `RestApiCreateEvent`; `FhirRouteFinder` includes `_rest_routes_fhir_r4_us_core_3_1_0.inc.php` and dispatches the same extension event for FHIR routes.
    - Standard routes include `/api/patient/:puuid` and `/api/patient/:puuid/encounter`, but vitals, SOAP notes, and medications use numeric `:pid`/`:eid` style routes. FHIR routes include patient-binding branches for patient requests and ACL checks for user requests.
    - FHIR DocumentReference clinical notes instantiate [`src/Services/FHIR/DocumentReference/FhirClinicalNotesService.php`](src/Services/FHIR/DocumentReference/FhirClinicalNotesService.php), which wraps [`src/Services/ClinicalNotesService.php`](src/Services/ClinicalNotesService.php); that service's table constant is `form_clinical_notes`.
    - Repository search under [`src/Services/FHIR/`](src/Services/FHIR/) finds no `form_soap` references. Legacy SOAP routes/forms exist, but SOAP is not automatically exposed through the FHIR clinical-note DocumentReference path.
    - A separate Node.js TCP service ([`ccdaservice/serveccda.js`](ccdaservice/serveccda.js)) handles CCDA generation/parsing — out-of-process from PHP, must be reachable for CCDA exports/imports.
- **Implications for the agent:** A separate AgentForge backend can consume REST/FHIR without linking directly into core PHP, which is attractive for licensing, testing, and long-term separation. For the in-course demo, it still needs an identifier-normalization layer (`puuid`/`pid`/`encounter`/FHIR ids) and a resource-selection policy that avoids expensive or ambiguous all-observation reads. If v1 note search uses FHIR DocumentReference, synthetic narrative data must be written into `form_clinical_notes`; treating legacy `form_soap` as covered by FHIR without a custom path is incorrect.
- **Mitigation / next step:** Use FHIR/REST as the preferred data-access boundary where practical, but prototype v1 chart reads against the exact resources needed before committing to API-only integration. Decide explicitly whether MVP skips SOAP, mirrors synthetic note content into `form_clinical_notes`, or adds a narrow custom SOAP endpoint.
- **Related:** `Security-2`, `Security-3`, `DataQuality-5`, `DataQuality-7`, `Performance-3`, `Performance-6`.

### Architecture-4: Custom modules plus event hooks are the most plausible in-repo integration path for a v1 embedded read-only copilot

- **Severity:** Informational
- **Description:** OpenEMR has first-class extension seams for custom modules, menu/page-heading hooks, route extension events, and a polled background-service registry. A custom module can provide an embedded read-only UI and optionally register new read-only API routes without editing core services for a course demo.
- **Evidence:**
    - [`interface/globals.php`](interface/globals.php) initializes `ModulesApplication` when the `modules` table exists and records module roots as `interface/modules/`, `custom_modules`, and `zend_modules`.
    - [`src/Core/ModulesApplication.php`](src/Core/ModulesApplication.php) loads Laminas modules, prepares `ModulesClassLoader`, queries active custom modules from the `modules` table, includes each module's `openemr.bootstrap.php`, passes in the Symfony `EventDispatcherInterface`, dispatches `ModuleLoadEvents::MODULES_LOADED`, and blocks direct script access to disabled module directories.
    - [`src/Core/ModulesClassLoader.php`](src/Core/ModulesClassLoader.php) documents module namespace registration without requiring a root Composer autoload dump.
    - Existing modules demonstrate UI hook patterns: [`interface/modules/custom_modules/oe-module-prior-authorizations/openemr.bootstrap.php`](interface/modules/custom_modules/oe-module-prior-authorizations/openemr.bootstrap.php) registers `MenuEvent::MENU_UPDATE` and `PatientMenuEvent::MENU_UPDATE`; [`interface/modules/custom_modules/oe-module-dashboard-context/src/Bootstrap.php`](interface/modules/custom_modules/oe-module-dashboard-context/src/Bootstrap.php) registers `PageHeadingRenderEvent::EVENT_PAGE_HEADING_RENDER`.
    - [`tests/eventdispatcher/RestApiEventHookExample/Module.php`](tests/eventdispatcher/RestApiEventHookExample/Module.php) demonstrates adding standard and FHIR routes through `RestApiCreateEvent`.
    - The `background_services` table plus [`src/Services/Background/`](src/Services/Background/) provides a polled cron-like surface where agent-side jobs (eval runs, retention sweeps, prefetch warm-ups) could live without external schedulers.
    - The repository is GPLv3 ([`LICENSE`](LICENSE)), and OpenEMR PHP files/modules consistently carry GPLv3 license headers; code shipped inside this fork should be treated as GPLv3 unless a later legal review says otherwise (see `Compliance-4`).
- **Implications for the agent:** For v1, a custom module is the strongest in-repo demo surface: it keeps AgentForge code separated from core, can live inside the authenticated OpenEMR UI, can add menus/panels, and can optionally expose narrow read-only routes. A pure external REST/FHIR consumer remains viable for long-term decoupling, but it gives up the embedded UX unless paired with a module or separate frontend.
- **Mitigation / next step:** Recommend a custom module with an embedded read-only page/panel and a narrow chart-read service/API boundary for v1; keep API-only extraction as a design constraint, not an immediate requirement.
- **Related:** `Architecture-1`, `Architecture-3`, `Compliance-4`.

---

## 4. Data Quality

**Scope:** completeness of demo data (and structural assumptions about real charts), formatting consistency, duplicate records, stale data, missing fields that downstream verification depends on, and any known data-shape pitfalls that will surface as agent failure modes.

### DataQuality-1: Persona viability — adult PCP returning-patient demo coverage

- **Severity:** High
- **Description:** The bundled OpenEMR development demo dataset (loaded via `dev-reset-install-demodata`) does not support the v1 persona. The dataset contains 3 patients with 1 encounter each, all dated 2014-02-01, with placeholder SOAP narratives and no labs, immunizations, longitudinal vitals, or modern clinical-notes content. The persona — adult PCP, non-emergent, **returning patients with rich charts** — depends on multi-visit history, lab trends, and meaningful narratives that this dataset cannot produce. This finding describes the curated dev dataset shipped with OpenEMR, not a guarantee about real production charts.
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
- **Implications for the agent:** The case-study scenario the v1 persona is built around — *"what changed since the last visit"*, *"dense EHR notes... lab results... medication lists"* — cannot be demonstrated, evaluated, or red-teamed against this dataset. Three follow-on consequences: **(1)** any agent demo built directly on the bundled dataset will fail at the persona's core promise; a data-augmentation step (Synthea import or hand-curated longitudinal patients) is a hard prerequisite. **(2)** Eval ground truth for verification implementation cannot be authored against patient charts that don't exist — the eval harness requires augmented data first. **(3)** If the verification layer is exercised against this dataset as-is, every claim hits the empty/missing path — useful for refusal/negation behavior but not for source-attribution behavior on populated fields.
- **Mitigation / next step:** Treat data augmentation as a hard prerequisite gate before verification/eval implementation. Resolution direction: hybrid Synthea import (`/root/devtools import-random-patients`) plus hand-curated golden fixtures; see `DataQuality-5`.
- **Related:** `DataQuality-5`, `Architecture-3`, `Performance-1`.

### DataQuality-2: Adult PCP chart facts come from multiple source families with different identifiers, statuses, and freshness semantics

- **Severity:** High
- **Description:** Current OpenEMR chart data is not a single coherent "chart summary" object. For the adult PCP returning-patient persona, the concrete chart sources span demographics/care team, encounters, problem/allergy/medication lists, prescriptions, vitals/forms, procedure/lab tables, notes/documents, history, and immunizations, each with its own identifiers, date fields, and active/status conventions.
- **Evidence:**
    - Schema source tables in [`sql/database.sql`](sql/database.sql) include `patient_data`, `form_encounter`, `lists`, `lists_medication`, `prescriptions`, `form_vitals`, `forms`, `form_clinical_notes`, `history_data`, `immunizations`, `procedure_order`, `procedure_order_code`, `procedure_report`, `procedure_result`, `documents`, and `pnotes`.
    - [`src/Services/ConditionService.php`](src/Services/ConditionService.php) and [`src/Services/AllergyIntoleranceService.php`](src/Services/AllergyIntoleranceService.php) both read from the polymorphic `lists` table, forcing `type = medical_problem` or `type = allergy`; allergy search also deduplicates rows caused by joins when a `lists.user` association is missing.
    - [`src/Services/PrescriptionService.php`](src/Services/PrescriptionService.php) builds medication requests as a `UNION` of `prescriptions` rows and `lists` rows with `type = medication`; it carries `source_table`, derives status from `active`/`end_date` or `activity`/`enddate`, and notes that a medication issue can be tied to multiple encounters while FHIR treats the relationship as 0..1.
    - [`src/Services/VitalsService.php`](src/Services/VitalsService.php) reads `form_vitals` joined to `forms` and `form_encounter`, while [`src/Services/FHIR/Observation/FhirObservationVitalsService.php`](src/Services/FHIR/Observation/FhirObservationVitalsService.php) maps individual vital columns to LOINC-coded observations.
    - [`src/Services/ProcedureService.php`](src/Services/ProcedureService.php) starts from `procedure_order` and LEFT JOINs reports/results so orders without results can still appear; labs then surface through `FhirObservationLaboratoryService` and `FhirDiagnosticReportService`.
    - [`src/Services/SocialHistoryService.php`](src/Services/SocialHistoryService.php) documents `history_data` as one row per insert and commonly returns the latest row only.
- **Implications for the agent:** Every v1 claim category must preserve its exact source family and source pointer. "Active med", "no allergies", "recent labs", "BP trend", "last visit", and "social history" cannot share one verification rule because their data freshness, missingness, and status signals differ.
- **Mitigation / next step:** In Stage 4/5, define a source pack that records table/resource, row UUID/id, patient id, encounter/date, status/activity fields, retrieval path, and freshness timestamp for each extracted fact.
- **Related:** `Architecture-2`, `Architecture-3`, `DataQuality-6`.

### DataQuality-3: Missing, empty, stale, and conflicting chart states are normal current behavior, not edge cases

- **Severity:** High
- **Description:** The currently loaded dev data and source schemas show that AgentForge must treat absence, staleness, and conflicts as first-class verification states. The demo data is not only thin; it also contains null history fields, inconsistent medication sources, absent coding, inactive rows, future-ish modification timestamps relative to 2014 clinical events, and fields whose default values can be confused with real observations.
- **Evidence:** Current read-only SQL against the easy-dev database on 2026-04-28, plus source inspection:
    - Table counts repeated from the current easy-dev database: `patient_data` 3, `form_encounter` 3, `lists` 9, `prescriptions` 1, `form_vitals` 3, `history_data` 3, and zero rows in `form_clinical_notes`, `immunizations`, `procedure_order`, `procedure_report`, `procedure_result`, `documents`, and `pnotes`.
    - `lists` has 1 allergy, 3 active medical problems, 4 active medication rows, and 1 inactive medication row. Susan has `Lisinopril` both as an inactive `lists` medication and as an active `prescriptions` row, so medication status can conflict across source families unless provenance is kept.
    - Problem coding is partial: Phil's HTN/renal-insufficiency problems use ICD9; Susan's diabetes problem has no diagnosis code; all `lists.user` and `verification` values are blank in the current demo rows.
    - `history_data` has one row per patient but `tobacco`, `alcohol`, `exercise_patterns`, and `recreational_drugs` are all `NULL`.
    - `form_vitals` has one row per patient on 2014-02-01 only; [`src/Services/VitalsService.php`](src/Services/VitalsService.php) also depends on global unit settings for conversion, so evals must compare normalized units rather than raw display text.
    - [`src/Services/ClinicalNotesService.php`](src/Services/ClinicalNotesService.php) returns an empty result if the installed clinical-notes table lacks the expected `code` column, and otherwise treats status as "current" with future entered-in-error/superseded support left open.
    - [`src/Services/FHIR/FhirEncounterService.php`](src/Services/FHIR/FhirEncounterService.php) emits FHIR Encounter status as fixed `finished` and has a TODO questioning whether the hard-coded check-up type is the only possible encounter type.
- **Implications for the agent:** Graceful degradation is not polish; it is a correctness requirement. The agent must distinguish "not documented", "not authorized", "source unsupported", "source empty", "stale", "inactive/resolved", and "conflicting across sources" instead of flattening them into confident prose.
- **Mitigation / next step:** Make eval cases include explicit empty, stale, inactive, uncoded, and conflicting-source examples, and require outputs to name the data limitation rather than infer around it.
- **Related:** `DataQuality-2`, `DataQuality-6`.

### DataQuality-4: FHIR helps source attribution but does not provide sufficient provenance by itself

- **Severity:** Medium
- **Description:** OpenEMR's FHIR layer is useful for standardized resource reads, patient/date/category filters, and optional Provenance rev-includes, but it does not by itself satisfy AgentForge's source-attribution requirement. FHIR logical ids usually map back to internal UUIDs, while Provenance is synthesized per resource and often points to the primary organization rather than the exact original author/source.
- **Evidence:**
    - [`src/RestControllers/RestControllerHelper.php`](src/RestControllers/RestControllerHelper.php) defines `_revinclude=Provenance:target` support.
    - [`src/Services/FHIR/FhirProvenanceService.php`](src/Services/FHIR/FhirProvenanceService.php) comments that a complete provenance table would be better, but provenance is currently tracked disparately and the service visits each resource to gather surrogate ids; `createProvenanceForDomainResource()` records the target and uses resource `meta.lastUpdated`, then creates author/transmitter agents from a user reference or primary business organization.
    - [`src/Services/FHIR/FhirAllergyIntoleranceService.php`](src/Services/FHIR/FhirAllergyIntoleranceService.php) is one path that passes recorder information into FHIR Provenance, but this is not a universal guarantee across resources.
    - `FhirConditionService` supports patient, `_id`, and `_lastUpdated`, while category routing happens inside `getAll()`; it does not expose clinical-status search in `loadSearchParameters()`.
    - `FhirObservationService` maps Observation across social history, vitals, laboratory, SDOH, patient, employer, advance-directive, and preference services; `FhirObservationLaboratoryService` accepts broad LOINC-style code searches and removes category before calling `ProcedureService`.
    - `FhirDocumentReferenceService` composes clinical notes, patient documents, and advance directives. `FhirPatientDocumentReferenceService` unsets a category search parameter for uploaded documents after routing, so category filtering does not mean the same thing for every document source.
- **Implications for the agent:** Citations cannot stop at `FHIR/Observation/{id}` or `FHIR/DocumentReference/{id}` if the answer needs clinician-grade traceability. Verification needs the internal source row/resource id, source family, retrieval path, and relevant field names in addition to any FHIR resource id and Provenance bundle.
- **Mitigation / next step:** Treat FHIR Provenance as helpful metadata, not the canonical citation layer; build citations from the chart-read boundary's own source pack.
- **Related:** `Security-3`, `Compliance-1`.

### DataQuality-5: Eval ground truth requires hybrid synthetic-plus-curated augmentation

- **Severity:** High
- **Description:** The repository provides two useful data paths, neither sufficient alone for the v1 eval burden. The curated demo data is too small and stale for longitudinal adult PCP evaluation, while Synthea import is the built-in scalable synthetic path but enters OpenEMR through CCDA import and does not supply hand-authored ground-truth answers for AgentForge-specific questions.
- **Evidence:**
    - [`CONTRIBUTING.md`](CONTRIBUTING.md) documents `dev-reset-install-demodata` for curated demo reset and `import-random-patients <count>` for Synthea-generated random patients imported into OpenEMR.
    - The documented Synthea import development mode directly imports patient data from CCDA, bypasses CCDA document import and `audit_master` / `audit_details`, and turns off audit logging during import; the docs explicitly warn not to use that mode on sites with real data.
    - [`interface/modules/zend_modules/module/Carecoordination/src/Carecoordination/Model/CarecoordinationTable.php`](interface/modules/zend_modules/module/Carecoordination/src/Carecoordination/Model/CarecoordinationTable.php) imports CCDA-derived immunizations, prescriptions, allergies, medical problems, encounters, care plans, clinical notes, vitals, procedures, lab results, functional/cognitive status, referrals, observations, payers, and files when those sections are parsed.
    - [`src/Services/Cda/CdaTemplateParse.php`](src/Services/Cda/CdaTemplateParse.php) maps CCDA lab result organizers/observations into `procedure_result` fields including result code, date, status, value, unit, and reference range.
    - [`tests/Tests/Fixtures/`](tests/Tests/Fixtures/) contains small hand-authored fixtures for tests, but these are not a longitudinal adult PCP eval corpus.
    - `Architecture-3` documents that FHIR DocumentReference clinical-note reads come from `form_clinical_notes`, not legacy `form_soap`.
- **Implications for the agent:** The evidence supports a **hybrid** augmentation decision: use Synthea to create enough synthetic longitudinal chart substrate, then hand-curate a small set of adult PCP cases and ground-truth question/answer/citation fixtures on top. Synthea alone can populate tables but cannot prove that "what changed since last visit" answers are correct; hand-curated data alone is more controllable but too slow to produce breadth. If note search is FHIR-backed, the curated notes need to live in `form_clinical_notes`; SOAP-only fixtures would exercise legacy UI data, not the planned FHIR DocumentReference path.
- **Mitigation / next step:** Before demo/eval implementation, import a small Synthea cohort in non-real-data dev, select 2-3 adult returning patients with usable longitudinal records, and hand-author eval fixtures covering expected answer, required citations, allowed uncertainty, and known missing/conflicting facts. For MVP, generate clinical narratives into `form_clinical_notes` unless Stage 4 deliberately adds a custom SOAP endpoint.
- **Related:** `DataQuality-1`, `Architecture-3`, `Compliance-2`.

### DataQuality-6: Schema-level data-quality signals — empty-string sentinels, stringly-typed clinical fields, polymorphic `lists`, global picklists

- **Severity:** High
- **Description:** Schema choices encode normalization decisions the agent must reverse-engineer at read time. Empty-string-as-sentinel, stringly-typed clinical fields, polymorphic discriminators, and a global picklist table all mean that "is a value present" and "what does this code mean" are not free lookups.
- **Evidence:**
    - 54 columns declared `varchar(255) NOT NULL DEFAULT ''` in [`sql/database.sql`](sql/database.sql). An agent's "is this populated" check must test both `NULL` and the empty string.
    - Stringly-typed clinical fields: `procedure_result.result varchar(255)`, `procedure_result.units varchar(31)`, `procedure_result.abnormal varchar(31)` (comment indicates allowed values `no,yes,high,low` — but no CHECK constraint), `procedure_result.result_data_type char(1)` with `N`/`S`/`F`/`E`/`L` meanings encoded in a comment.
    - `lists` is a polymorphic table holding allergies, medications, problems, surgeries, and more, with `type` as the discriminator and many overlapping fields (`title`, `diagnosis`, `extrainfo`, `comments`). "The patient's diagnosis list" depends on `type='medical_problem'` filtering — a magic string the agent must know.
    - `list_options` is a global key-value table for almost every clinical vocabulary (sex, race, ethnicity, occurrence, disclosure_type, etc.). 100-character `option_id` strings are referenced from other tables (e.g., `patient_data.interpreter_needed`) without FK enforcement.
    - [`src/Services/PatientService.php:659`](src/Services/PatientService.php) `findByPid()` runs `SELECT * FROM \`$table\`` (see `Performance-7`).
- **Implications for the agent:** Every "is this field present" check must handle the NULL / empty-string pair. Every read of `lists` needs an explicit `type` filter and an awareness that the same row family carries different semantics for problems vs allergies vs medications. Every `list_options` lookup pays the price of a global key-value indirection.
- **Mitigation / next step:** Centralize these conventions in the agent-context read service (the single read boundary). The verification layer should treat empty string as "not documented", not as a real value.
- **Related:** `DataQuality-2`, `DataQuality-3`, `Performance-7`.

### DataQuality-7: ID multiplicity and inconsistent soft-delete; orphan rows are a possible state

- **Severity:** High
- **Description:** Multiple ID systems coexist: integer `id`, `pid` (patient-facing int), `pubpid` (public-facing string), and `uuid` (`binary(16)`). FHIR uses the UUID; internal joins use `pid`. Soft-delete is inconsistent: `forms.deleted` and `documents.deleted` exist; `patient_data` has no `deleted` column — patient deletion is a hard delete via the `super` ACL, leaving related rows in `forms`, `lists`, `prescriptions`, etc. orphaned (no FK to enforce cascade — see `Performance-6`).
- **Evidence:**
    - [`sql/database.sql`](sql/database.sql) `patient_data` defines `id`, `pid` (UNIQUE), `pubpid varchar(255)`, and `uuid binary(16)` (UNIQUE).
    - [`sql/database.sql`](sql/database.sql) `forms` has `deleted tinyint default 0`; `documents` has `deleted tinyint default 0`. `patient_data` has no `deleted` column.
    - `encounter` numbers in `forms` / `form_encounter` are not constrained to be unique within a patient — same `encounter` integer can appear in multiple `pid` rows in practice (it is a per-patient sequence by convention only).
    - Zero foreign keys repository-wide (`Performance-6`) means no DB-level enforcement that a `forms.pid` references an extant `patient_data.pid`.
- **Implications for the agent:** The agent's I/O contract should pick **one** identifier system. UUID is the FHIR-stable identifier and the only one that survives patient merges cleanly; explicit `pid ↔ uuid` translation should live at the read boundary, not be sprinkled through agent code. The verification layer should treat orphaned rows as a possible failure mode and refuse to render claims when the patient row is missing.
- **Mitigation / next step:** Pick UUID as the agent's external identifier; encapsulate `pid` lookups inside the read boundary; surface an explicit "patient not found" branch when `patient_data` is absent for a referenced `pid`.
- **Related:** `Architecture-3`, `Performance-6`, `Performance-8`.

---

## 5. Compliance & Regulatory

**Scope:** HIPAA-specific obligations not already absorbed by §1 — audit logging requirements, data retention policies, breach-notification posture, BAA implications when PHI touches an LLM provider, training-data prohibitions, and minimum-necessary access enforcement.

### Compliance-1: OpenEMR has configurable audit logging, but agent reads need their own traceability model

- **Severity:** High
- **Description:** OpenEMR already records many security-relevant events through `EventAuditLogger`, SQL logging, HTTP page-history logging, API response logging, and explicit patient `"view"` events. Those logs are global-flag and route/query dependent, so AgentForge cannot assume every generated answer has a complete read trail unless it deliberately ties each chart read and summary to auditable source access. An agent fetching a chart on behalf of a third party should *also* be writing to the existing disclosure-tracking surface.
- **Evidence:**
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) builds audit configuration from globals such as `enable_auditlog`, `audit_events_query`, `audit_events_http-request`, event-type flags, audit-log encryption, breakglass logging, and optional ATNA forwarding.
    - [`src/Common/Session/PatientSessionUtil.php`](src/Common/Session/PatientSessionUtil.php) emits a `"view"` audit event when patient context is set.
    - [`interface/globals.php`](interface/globals.php) calls `EventAuditLogger::getInstance()->logHttpRequest()` unless `$skipAuditLog` is set.
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) skips SELECT query logging if query events are disabled or if the SELECT resolves to event `"other"` after table classification.
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) maps many patient, lab, order, scheduling, and security-administration tables into event categories; reads outside that map need verification before relying on SQL-audit coverage.
    - [`sql/database.sql`](sql/database.sql) `audit_master` / `audit_details` model approval/change-tracking records with approval statuses, comments, and field values. They are not a per-read PHI access log and should not be confused with `log` / `api_log` access evidence.
    - Disclosure tracking exists: [`interface/patient_file/summary/record_disclosure.php`](interface/patient_file/summary/record_disclosure.php) plus `list_options` `disclosure_type` (treatment / payment / healthcareoperations / etc.). An agent that fetches a chart on behalf of a third party (e.g., a referral) should write to this surface.
    - Amendments are tracked via `amendments` and `amendments_history` tables; portal access uses `patient_access_onsite.portal_pwd` for hashed credentials.
- **Implications for the agent:** HIPAA-style auditability requires more than "the UI was open." A clinical copilot needs a defensible record that a specific authenticated user accessed a specific patient/source set for a specific generated answer, while avoiding full PHI duplication in logs. `audit_master` does not satisfy that access-provenance need; `log` / `api_log` provide useful evidence but still lack agent-specific fields and should be treated as inputs to, not substitutes for, an AgentForge read-audit model. Where the agent acts on behalf of a disclosure (third-party request), the existing `record_disclosure` surface should be used.
- **Mitigation / next step:** In Stage 4/5, define an agent read-audit event shape that records user, patient, source identifiers, timestamp, and answer/session id without storing full chart text by default. Wire disclosure-triggered agent actions into `record_disclosure`.
- **Related:** `Security-4`, `Compliance-6`, `Performance-9`.

### Compliance-2: External LLM use requires a PHI boundary decision before any real chart data leaves OpenEMR

- **Severity:** Critical
- **Description:** This fork currently has no implemented AgentForge LLM path, but the compliance boundary is already clear: if prompts, retrieved chart facts, documents, API responses, or generated summaries contain PHI, sending them to an LLM provider creates HIPAA-relevant obligations around BAA status, permitted use, retention, training, auditability, breach response, and minimum-necessary disclosure. OpenEMR's default API/audit logging settings also show that "temporary" API payloads can become retained data unless explicitly controlled.
- **Evidence:**
    - [`src/RestControllers/Subscriber/ApiResponseLoggerListener.php`](src/RestControllers/Subscriber/ApiResponseLoggerListener.php) can persist full API JSON responses for non-local API requests when full logging is enabled.
    - [`library/globals.inc.php`](library/globals.inc.php) defaults `api_log_option` to `2` (full logging) and audit-log encryption to disabled.
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) encrypts audit comments/API fields only when configured; otherwise comments are base64-encoded, not encrypted.
    - [`src/Common/Logging/Audit/LogTablesSink.php`](src/Common/Logging/Audit/LogTablesSink.php) persists API request URLs, request bodies, and responses into `api_log`.
    - `Security-4` documents that request paths, SQL statements/binds, and API payloads can all become PHI-bearing records.
    - No PHI redaction layer exists in the repository: there is no `Services/Deidentification/`, no Safe Harbor (§164.514) scrubber, and any service call that returns patient data returns full demographics + clinical narrative verbatim.
- **Implications for the agent:** The v1 demo may use synthetic/demo data, but any path that handles real PHI must gate provider choice and logging design on a BAA/retention/training-data decision. This is a precondition for production-like deployment claims, not a final agent feature. The case-study brief notes that for Gauntlet projects, students should **act as if** a signed BAA is in place with all LLM providers and that no data will be used for training; that is a working assumption for the sprint, not a substitute for the real contract.
- **Mitigation / next step:** Before using real patient data with any external model: (a) document the BAA-bearing provider — practical short-list of providers offering BAAs as of writing includes Anthropic (direct BAA, or Claude on AWS Bedrock with HIPAA-eligible config), OpenAI (Azure OpenAI Service with BAA, or direct enterprise BAA), and Google (Vertex AI under Workspace+GCP BAA); the choice is a contract decision, not a model decision. (b) Disable training/retention with the chosen provider in writing. (c) Add a PHI-redaction pass for §164.514 identifiers when not strictly needed for the answer; the unredacted path is opt-in and logged. (d) Verify logs do not persist full prompts/responses unintentionally.
- **Related:** `Security-4`, `Security-5`, `Compliance-3`, `Compliance-5`, `Compliance-6`.

### Compliance-3: Current audit tables support traceability and tamper review, but do not define an AgentForge retention policy

- **Severity:** High
- **Description:** OpenEMR has persistent audit tables and UI/reporting surfaces for audit review, including tamper detection, but the reviewed current system does not define an AgentForge-specific retention schedule, purge policy, or breach-notification workflow for PHI-bearing agent prompts, responses, source packs, or external LLM payloads. HIPAA §164.316 requires minimum 6-year retention of audit records; state laws (e.g., NY 6 years, MA 30 years for hospitals) and practice policy may require longer.
- **Evidence:**
    - [`sql/database.sql`](sql/database.sql) defines `api_log` with `request_url`, `request_body`, `response`, and `created_time`; it does not define retention, expiry, or purge metadata for those rows.
    - [`sql/database.sql`](sql/database.sql) defines `log` with `date`, `event`, `category`, `user`, `comments`, `user_notes`, `patient_id`, checksum-related fields, and `ccda_doc_id`; it does not define retention, expiry, or breach-workflow fields.
    - [`interface/logview/logview.php`](interface/logview/logview.php) reads audit events through `EventAuditLogger::getEvents()`, decrypts or base64-decodes comments, and displays user, patient, API, and comment data for review.
    - [`interface/reports/audit_log_tamper_report.php`](interface/reports/audit_log_tamper_report.php) is gated to `admin/super`, reads audit events through `EventAuditLogger::getEvents()`, recomputes checksums, and reports deleted/tampered log rows.
    - Repository search for `retention`, `purge_log`, `data_retention` in reviewed PHP/SQL/Markdown surfaces did not reveal a current application-level policy or workflow covering LLM-bound PHI artifacts; only `password_expiration_days` and certificate-expiration matches surface.
- **Implications for the agent:** If AgentForge stores prompts, responses, source packs, or provider payloads, those artifacts become PHI records with their own lifecycle. OpenEMR's existing audit log can help reconstruct access, but it does not by itself answer how long agent artifacts are retained, how they are deleted, who reviews them, or how a suspected LLM/provider disclosure triggers breach assessment.
- **Mitigation / next step:** Before any real PHI use, define a retention matrix for agent artifacts, an owner-reviewed purge/export process, and a breach-notification playbook that maps LLM/provider incidents back to OpenEMR audit evidence. Add `log` purge worker and indexes (see `Performance-9`).
- **Related:** `Security-4`, `Compliance-1`, `Compliance-2`, `Performance-9`.

### Compliance-4: GPLv3 constrains release shape for in-repo/module integration

- **Severity:** Medium
- **Description:** OpenEMR is distributed under GPLv3, and its PHP files/modules consistently carry GPLv3 headers. For AgentForge, this matters because code shipped inside this fork or as an OpenEMR custom module should be treated as GPLv3 for release-planning purposes unless legal review says otherwise; a separately deployed HTTP/FHIR consumer preserves more licensing optionality.
- **Evidence:**
    - [`LICENSE`](LICENSE) is GNU General Public License version 3.
    - OpenEMR PHP files reviewed in this audit, including [`library/auth.inc.php`](library/auth.inc.php), [`src/Common/Session/PatientSessionUtil.php`](src/Common/Session/PatientSessionUtil.php), [`src/Common/Logging/Audit/LogTablesSink.php`](src/Common/Logging/Audit/LogTablesSink.php), and [`src/Common/Session/SessionUtil.php`](src/Common/Session/SessionUtil.php), carry GPLv3 license headers.
    - `Architecture-4` already identified a custom module as the most plausible in-repo v1 demo path and REST/FHIR as the cleaner long-term read boundary.
    - README references ONC certification (Stage III Meaningful Use) and Inferno test workflow ([`.github/workflows/inferno-test.yml`](.github/workflows/inferno-test.yml)). Maintaining ONC certification while adding an agent is a separate compliance track and should be reviewed with whoever owns the ONC submission.
- **Implications for the agent:** Security/compliance evidence does not block the module path, but it does make the release posture explicit: in-fork demo/module code should be presented as GPLv3-compatible course/portfolio work, while any later separately licensed agent service should communicate with OpenEMR over a clear API boundary. ONC certification is a parallel track.
- **Mitigation / next step:** Keep Stage 4/5 release notes and README language aligned with GPLv3 for in-repo code; defer any non-GPL licensing claims until there is legal review and a true API-only separation. Note ONC cert implications when scoping agent surfaces.
- **Related:** `Architecture-4`.

### Compliance-5: No outbound network egress controls; the LLM call would be the first PHI-bearing outbound

- **Severity:** High
- **Description:** PHP `curl` / Guzzle in OpenEMR reaches whatever DNS resolves. There is no proxy, no allowlist, and no per-endpoint policy. Outbound HTTP today goes to USPS address verification, payment processors (Stripe / Sphere / Authorize.Net / Rainforest), Twilio / RingCentral (faxsms), Google OAuth, and eRx/NewCrop. None of those currently send clinical narrative — the agent's LLM call would be the first.
- **Evidence:**
    - [`src/USPS/USPSAddressVerifyV3.php`](src/USPS/USPSAddressVerifyV3.php) — outbound to USPS.
    - [`src/PaymentProcessing/`](src/PaymentProcessing/) — outbound to payment processors.
    - [`library/classes/Faxsms/`](library/classes/Faxsms/) and `src/Common/Command/PhoneNotificationCommand.php` — outbound to Twilio / RingCentral.
    - [`src/RestControllers/AuthorizationController.php`](src/RestControllers/AuthorizationController.php) and Google OAuth integration — outbound to Google identity.
    - No proxy configuration, allowlist, or per-endpoint enforcement found in the reviewed codebase.
- **Implications for the agent:** A misconfiguration (or a malicious model-side instruction that the agent dutifully follows when constructing a tool call) that points the LLM client at a non-BAA endpoint will succeed silently. Network egress is the last line of defense if every other control fails; today there isn't one.
- **Mitigation / next step:** The agent's LLM client should ride a constrained egress path — outbound proxy with endpoint allowlist, or an env-controlled base URL whose value is asserted at startup. Network egress should be alerted on, not assumed.
- **Related:** `Security-6`, `Compliance-2`.

### Compliance-6: Log tamper-evidence is partial and optional; there is no first-class agent actor

- **Severity:** High
- **Description:** `EventAuditLogger` writes to `log` (basic event row) and `log_comment_encrypt` (optionally encrypted comments) and *optionally* to `extended_log` (which has `checksum` and `checksum_api`). The `log` table itself has **no** row-level integrity hash. ATNA syslog forwarding (RFC 3881 over TLS via [`src/Common/Logging/Audit/Atna/TcpWriter.php`](src/Common/Logging/Audit/Atna/TcpWriter.php)) is supported but disabled by default. The `log_from` enum is `'open-emr'` / `'patient-portal'` — there is **no** first-class agent or machine actor today.
- **Evidence:**
    - [`src/Common/Logging/EventAuditLogger.php`](src/Common/Logging/EventAuditLogger.php) writes to `log`, `log_comment_encrypt`, and `extended_log`.
    - [`sql/database.sql`](sql/database.sql) `log` definition has checksum-related fields used by `extended_log`, not by `log` itself, and the tamper-detection surface depends on the optional `extended_log` shadow.
    - [`sql/database.sql`](sql/database.sql) `log_from` column type — `'open-emr'`/`'patient-portal'` only.
    - [`library/globals.inc.php`](library/globals.inc.php) ATNA controls (`enable_atna_audit`, etc.) default off in the reviewed configuration.
    - There is no application-level breach-detection or anomalous-access detector, and no patient-facing breach-notification template ([`src/Services/`](src/Services/), [`interface/`](interface/) reviewed). HIPAA §164.404 obligations are entirely operator-side.
- **Implications for the agent:** A privileged DB user can edit `log` rows undetected unless ATNA syslog (or the optional `extended_log` shadow) is also configured. The agent's audit needs cannot rely on `log` being tamper-evident by default. Picking an agent value for `log_from` (e.g., `'agent'`) is a one-time decision that becomes much harder to retrofit once data has accumulated.
- **Mitigation / next step:** (1) Enable ATNA forwarding (or the `extended_log` shadow) in any deployment carrying real PHI, plus a log integrity verification job. (2) Pick the agent's `log_from` value before launch. (3) Log the LLM call itself with model id, redaction policy version, payload hash (not payload), token counts, and response stored doc id; none of these fields exist in `api_log` today, so they ride in `log_comment_encrypt` or a dedicated agent-audit table.
- **Related:** `Compliance-1`, `Compliance-3`, `Performance-9`.

---

## 6. Pre-Build Imperatives (Stage 4 design inputs)

This audit is deliberately pre-code. The findings above are evidence and constraints, not a punch list against OpenEMR core. The list below distills them into design inputs that need owners *before* Stage 4 [`ARCHITECTURE.md`](ARCHITECTURE.md) commits to anything load-bearing. None of these are "fix this now in OpenEMR upstream"; they are decisions that block PHI-bearing agent code.

1. **Pick the LLM provider on contract grounds, then document the BAA.** No code path that touches real PHI gets reviewed until a BAA-bearing provider is documented with retention and training-prohibition posture. The case-study brief permits acting *as if* a BAA exists for the sprint, but the real document is a Stage 4 decision input. (→ `Compliance-2`)

2. **Design a single read-only "agent context" service.** It owns the patient-timeline query, enforces ACL, normalizes identifiers (UUID in/UUID out — see #10), decrypts on egress where applicable, and emits a distinct audit event (`log_from='agent'` or equivalent). Don't let agent code reach into legacy services in a loop — that path inherits N+1 amplification from `Performance-7` and authorization ambiguity from `Security-2/3`. (→ `Architecture-2`, `Performance-1`, `Performance-7`, `Security-3`)

3. **Enforce patient binding as a primary invariant for staff-scope FHIR reads.** When using `user/` scope, every FHIR/tool call that names a patient must first match that patient to the active OpenEMR chart/session context. Do not rely on GACL action authorization alone for cross-patient control. (→ `Security-3`, `Security-10`, `Architecture-3`)

4. **Forbid agent launch from admin/superuser accounts.** `admin/super` bypasses normal ACL checks; any demo or pilot user that can launch AgentForge must be a role-scoped clinical user, not the default admin account. (→ `Security-9`, `Security-10`)

5. **Pin OpenEMR to a patched baseline and track ACL/IDOR advisories.** Recent changelog entries include missing authorization, missing ACL, IDOR, explicit-deny, and session-lock fixes. Stage 4 should name the minimum OpenEMR version/commit before any PHI-bearing deployment. (→ `Security-10`, `Performance-3`)

6. **Define a PHI redaction layer in front of the LLM call.** §164.514 Safe Harbor identifiers are stripped when not strictly needed for the answer. The default context excludes SSN, driver's license, and similar identifiers; the unredacted path is opt-in, logged, and tied to a documented use case. (→ `Security-5`, `Compliance-2`)

7. **Fix three security defaults before any deployment carries real PHI.** CORS allowlist with credentialed origins (→ `Security-6`); `cookie_httponly=true` and `cookie_secure=true` on the core session, with a documented migration off any JS-cookie-read paths (→ `Security-7`); generic 500 messages on the API entry point (→ `Security-8`).

8. **Keep OAuth bearer material out of iframe URLs.** Use a postMessage handshake, one-time launch code, or equivalent token exchange; serve the sidecar with a narrow `frame-ancestors` allowlist for the OpenEMR origin. (→ `Security-11`)

9. **Add `log` indexes and a retention worker.** `(date)`, `(user, date)`, `(event, date)` on `log`. A nightly background service rotates rows older than the configured retention window into a cold archive table. ATNA forwarding or `extended_log` enabled in any production-like environment. (→ `Performance-9`, `Compliance-3`, `Compliance-6`)

10. **Pick UUID as the agent's I/O identifier.** It is the FHIR-stable identifier and the only one that survives patient merges cleanly. `pid ↔ uuid` translation is encapsulated in the read boundary, not sprinkled through agent code. (→ `DataQuality-7`, `Architecture-3`)

11. **Constrain LLM egress.** The LLM client rides an outbound allowlist (proxy or asserted env-controlled base URL), so a misconfiguration cannot silently send PHI to a non-BAA endpoint. (→ `Compliance-5`)

12. **Pick an agent actor in the audit model.** `log_from='agent'` (or the chosen value) is selected once, before launch, and used for every agent-initiated read. This is a five-minute decision that becomes a multi-day migration once data has accumulated. (→ `Compliance-1`, `Compliance-6`)

13. **Validate agent SQL against current schema in CI.** A smoke test loads `sql/database.sql` into a throwaway database and runs each agent SQL statement (or the agent-context service's read path) before merge. Until Doctrine Migrations is the source of truth, this is the only structural defense against schema drift. (→ `Performance-8`)

14. **Treat demo data augmentation as a hard prerequisite.** Synthea import (`/root/devtools import-random-patients`) plus a small hand-curated longitudinal cohort with golden eval fixtures, before verification/eval implementation begins. FHIR-backed note fixtures should target `form_clinical_notes`; SOAP fixtures require a custom endpoint decision. Before pilot-scale note Q&A, evaluate `form_clinical_notes` indexing or a bounded notes-read path. (→ `DataQuality-1`, `DataQuality-5`, `Architecture-3`, `Performance-6`)

---

## Appendix — Audit methodology

Static, read-only review of the OpenEMR fork at HEAD on 2026-04-28. Targets: bootstrap and authentication paths (`interface/globals.php`, `library/auth.inc.php`, `src/Common/Auth/*`, `src/Common/Session/*`), the API/OAuth/FHIR stack (`apis/dispatch.php`, `src/RestControllers/*`, `apis/routes/*`, `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`, `src/Services/FHIR/*`, `src/Services/FHIR/DocumentReference/FhirClinicalNotesService.php`), chart-relevant services (`src/Services/*` covering encounters, conditions/allergies, prescriptions/medications, vitals, procedures/labs, clinical notes, documents, history, patient demographics, including `src/Services/ClinicalNotesService.php`), audit and logging surfaces (`src/Common/Logging/*`, `library/globals.inc.php`, `library/sql.inc.php`, `library/ADODB_mysqli_log.php`), ACL behavior (`src/Common/Acl/AclMain.php`), schema (`sql/database.sql`), CORS and cookie configuration (`src/RestControllers/Subscriber/CORSListener.php`, `src/Common/Session/SessionConfigurationBuilder.php`), encryption (`src/Common/Crypto/CryptoGen.php`), deployment defaults (`docker/production/docker-compose.yml`), release/security history (`CHANGELOG.md`), the modules system (`src/Core/ModulesApplication.php`, representative custom modules), the build system (`composer.json`, `db/Migrations/`, `db/migration-config.php`), and the bundled demo dataset via `docker compose exec` SQL queries against the easy-dev MariaDB instance. No live runtime profiling, no exploit testing, no production data observed, no schema or data mutations performed, no legal advice rendered. Some performance claims (cold-start latency, log growth) are inferred from file size and query patterns and would benefit from real `EXPLAIN` / APM observation in Stage 4. BAA, breach-notification, and ONC-certification posture require operator and legal confirmation before real PHI leaves OpenEMR.
