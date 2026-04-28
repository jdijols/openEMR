# OpenEMR System Audit — Pre-AgentForge

**Auditor:** Claude (Opus 4.7)
**Date:** 2026-04-28
**Scope:** Repository at HEAD of `claude/ecstatic-payne-048728` (fork of upstream OpenEMR). Static code review only — no live runtime, no production data observed. Everything below is grounded in files actually read in the working tree; line and table references are inline.

---

## Executive Summary (~500 words)

OpenEMR is a 20+ year old PHP electronic-health-record system. It is large (~4,450 PHP files, ~282 SQL tables, 10k+ lines of OpenAPI), partially modernized (PSR-4 `src/`, Symfony DI kernel, Doctrine DBAL, PHPStan level 10) but still anchored to a pile of pre-strict-typing legacy in `library/` and `interface/` (the six largest legacy files alone are >17k lines). Building a clinical AI agent on top of it is feasible, but five issues should shape the design before a single LLM call is made.

**1. PHI sits in the clear at rest.** `patient_data` stores SSN, drivers_license, DOB, full address, phones, and email as plain `varchar(255)` (sql/database.sql:14+). The schema even comments `ssn` "should be encrypted in application" and never delivers — `CryptoGen::encryptStandard` is wired only to payment tokens, OAuth secrets, and audit-log comments. Whatever the agent reads from the patient record, it reads in cleartext.

**2. The audit trail is incomplete for an LLM workload.** `EventAuditLogger` records writes and selected reads, but the `log` table has no row-version, no integrity hash on the row itself (only on the optional `extended_log` shadow), and no purge/retention worker. There is ATNA syslog support and a "breakglass" bypass, but nothing that distinguishes an LLM-initiated read from a human one. HIPAA §164.312(b) requires the agent's reads to be attributable.

**3. Three CORS / session defaults will leak credentials over the network.** `CORSListener.php:57` reflects the request's `Origin` header into `Access-Control-Allow-Origin` while also setting `Allow-Credentials: true` — any site can issue authenticated calls from a victim's browser. The core session cookie ships with `cookie_secure=false` and `cookie_httponly=false` (SessionConfigurationBuilder.php:26-28, 88) so it can be read by JavaScript and sent over HTTP. `apis/dispatch.php` echoes `$e->getMessage()` in 500 responses, leaking stack details.

**4. The database is not modeled for fast slicing.** Zero foreign keys across the 282 tables (no `FOREIGN KEY` clauses anywhere), only a handful of composite indexes (`patient_data` has `(lname, fname)` and `DOB`; `forms` has `(pid, encounter)`), and ~256 `tinyint` plus 75 `longtext` columns means joining the patient timeline (forms → form_encounter → procedure_result → lists → prescriptions) is a five-table hop with no FK enforcement. Doctrine Migrations exists but holds exactly one bootstrap migration — schema changes still ride monolithic `sql/*_upgrade.sql` files.

**5. Data quality is uneven by design.** `list_options` is a global key-value table for nearly every clinical vocabulary; `procedure_result.units` is a free-text varchar(31); `lists.diagnosis` and `lists.title` overlap; many demographic fields default to empty string instead of `NULL`. An agent that summarizes a chart cannot trust any of these to be normalized.

**Highest-impact actions before adding an agent:** (a) add a thin read-only "agent context" service that decrypts on egress and logs every fetch with a distinct `log_from='agent'` value; (b) fix the CORS reflection and session-cookie defaults; (c) build a BAA-aware redaction layer in front of any LLM provider; (d) decide explicitly which provider holds the BAA and document it before sending the first PHI byte.

---

## 1. Security Audit

### 1.1 Authentication

- **Password hashing is correct.** `AuthHash` (src/Common/Auth/AuthHash.php:1-100) uses `password_hash`/`password_verify` with admin-configurable algorithm: BCRYPT, ARGON2I, ARGON2ID, or SHA512HASH. Falls back gracefully when an algorithm is unsupported. No MD5 or SHA1 anywhere in `library/auth.inc.php` or `src/Common/`.
- **Timing attack protection is in place** — `AuthUtils::__construct` (src/Common/Auth/AuthUtils.php:73-120) maintains a "dummy hash" in `globals.gl_value` and verifies against it for non-existent users so login response time is constant.
- **MFA supports TOTP and U2F** (`MfaUtils.php:21-94`). Method registrations live in `login_mfa_registrations`. WebAuthn/passkeys are not implemented.
- **Google Sign-In (OIDC)** is supported (`AuthUtils::verifyGoogleSignIn`). Note: when SSO is used, the local lockout counter and password-expiration logic are bypassed (see header comment of AuthUtils).
- **OAuth2 server** (`league/oauth2-server`) is wired through `oauth2/authorize.php` and `src/RestControllers/AuthorizationController.php`. Tokens land in `api_token` / `api_refresh_token`; client secrets in `oauth_clients.client_secret` (text). SMART-on-FHIR launch flow is implemented (`src/RestControllers/SMART/`).

### 1.2 Authorization

- **ACL is provided by GACL** (legacy library) with a thin façade in `src/Common/Acl/AclMain.php`. Every REST handler in `apis/routes/_rest_routes_standard.inc.php` calls `RestConfig::request_authorization_check($request, "encounters", "auth_a")` style guards before dispatching to a controller — that is a positive pattern.
- The ACL surface is large and stringly-typed: section + acl + permission triples (`patients`, `med`, `write`, `addonly`, `wsome`, etc.). Drift between routes and ACL keys is easy to introduce and not statically enforced.
- **Break-glass / emergency access** is a real feature: `BreakglassChecker` checks group membership; `gbl_force_log_breakglass` toggles forced auditing of break-glass users. This is HIPAA-aligned but only useful if a retention/review workflow exists outside the app — none observed.

### 1.3 Cryptography

- **At-rest cipher is AES-256-CBC + HMAC-SHA384 (encrypt-then-MAC)** in `src/Common/Crypto/CryptoGen.php:159-178`. That construction is acceptable, but AES-256-GCM would be the modern choice and would remove the manual HMAC code path.
- **Two key sets** (one in DB `keys` table, one on disk under `sites/<site>/documents/logs_and_misc/methods/`). On-disk set is itself encrypted with the DB set. Versioned via `KeyVersion` enum so legacy ciphertexts stay decryptable.
- **Encryption is *not* applied to PHI columns.** Repo-wide grep for `encryptStandard|decryptStandard` shows usage only in `PaymentProcessing/`, `AuthorizationController`, `TokenIntrospectionRestController`, `USPSAddressVerifyV3`, and `BC/Crypto`. `PatientService`, `EncounterService`, `UserService` — none of them encrypt. SSN, DOB, etc. are plaintext.
- **CSRF** (`src/Common/Csrf/CsrfUtils.php`) is correctly implemented: 32-byte private key per session, `hash_hmac('sha256', subject, key)` truncated to 40 chars, `hash_equals` for constant-time comparison.

### 1.4 Session management

- `SessionConfigurationBuilder.php:20-28` defaults: `use_strict_mode=true`, `cookie_samesite=Strict`, `cookie_httponly=true`, `cookie_secure=false`. SameSite=Strict is good, but `cookie_secure=false` permits the cookie over plain HTTP if TLS is not enforced upstream.
- **Worse:** the `forCore()` preset (line 88) explicitly *overrides* HttpOnly back to `false` for the main UI session — a comment on the line cites a need for client-side scripts to read the cookie. Any reflected XSS in the UI can steal that cookie.
- OAuth and API session presets correctly set `cookie_secure=true` and `cookie_samesite='None'` (lines 99, 110). Asymmetric defaults across surfaces.

### 1.5 CORS

- **`src/RestControllers/Subscriber/CORSListener.php:57`** reflects `request.headers.Origin` directly into `Access-Control-Allow-Origin`, and the OPTIONS preflight (line 67) sets `Access-Control-Allow-Credentials: true`. Combined, this means *any* third-party site can issue cross-origin authenticated requests against the API and read the response. The TODO at line 72 acknowledges the issue. There is a syntax bug at line 69 (`"Access-Control-Allow-Methods", "GET, ..."` — comma should be `=>`) so the methods header is silently dropped.

### 1.6 Input handling and SQL

- All new code routes through `QueryUtils::sqlStatementThrowException` with parameter binding (`library/sql.inc.php:96-435`). This is the right pattern. Risk is concentrated in legacy `library/*.inc.php` and `interface/*.php` where direct `mysqli_query` and string concatenation still appear in older files (e.g. inside `EventAuditLogger.php:609` you can see `add_escape_custom($deletelid)` rather than a bound parameter — that one is on a numeric column but it sets a poor example).
- **Error leakage:** `apis/dispatch.php:38-40` catches `\Throwable` and JSON-encodes `$e->getMessage()` straight to the client. This contradicts CLAUDE.md's own guidance ("Never expose `$e->getMessage()` in user-facing output") and will leak DB column names and file paths in 500s.

### 1.7 Default install posture

- `sites/default/sqlconf.php` ships with `login = 'openemr'`, `pass = 'openemr'`, `host = 'localhost'`. This is a *template* — installer normally rewrites it — but if Docker/dev posture leaks to production, credentials are well-known.
- Default admin credentials are `admin` / `pass` (CLAUDE.md, dev compose file).

---

## 2. Performance Audit

### 2.1 Database

- **Storage engine:** InnoDB everywhere (276 of 282 tables; the rest are typos `InnoDb`/`INNODB`). Good — supports row locking and ACID.
- **Indexing is sparse.** ~521 `KEY`/`INDEX` clauses across 282 tables ≈ 1.85 indexes/table. Critical paths inspected:
  - `patient_data`: PK on `id`, UNIQUE on `pid` and `uuid`, `(lname,fname)` composite, `DOB`. No index on `email`, `pubpid`, `phone_*`, or `ss` — common search axes.
  - `forms`: PK on `id`, `(pid,encounter)`, `form_id`. No index on `form_name`, `formdir`, `deleted`, or `date`.
  - `form_encounter`: PK + `uuid` + `(pid,encounter)` + `encounter_date`. Reasonable.
  - `log`: only `patient_id`. No index on `date`, `event`, `user`, or `category`. Audit-log queries by user or date will full-scan.
- **Zero foreign keys.** `grep "FOREIGN KEY"` against `sql/database.sql` returns 0. Cascading deletes and orphaned-row prevention are all application-side. For an agent reading the chart, this means: a patient with `forms.pid` pointing at a deleted `patient_data.pid` is a possible state, not an impossible one.
- **`longtext` is overused** — 75 occurrences. `forms.form_name`, `forms.formdir`, `users.password`, `users.info`, `lists.comments`, etc. Stored off-page in InnoDB; range scans pull them whether you select them or not when a poor query writer uses `SELECT *`.
- **Migrations are bifurcated.** Doctrine Migrations is configured (`db/migration-config.php`, `db/Migrations/Version00000000000000.php`), but contains only one bootstrap migration. All real schema changes still live in `sql/2_6_0-to-2_6_1_upgrade.sql` … `sql/7_0_2-to-7_0_3_upgrade.sql` (one file per release). Validating an agent's queries against current vs. older deployments is hard.

### 2.2 Application-level performance

- **Caching is minimal.** `src/Common/Utils/CacheUtils.php` only does asset cache-busting via `?v=`. `TranslationCache` is an in-process static array. Symfony Cache is required by composer but I found no use of `CacheItemPoolInterface` anywhere outside `BC/ServiceContainer.php`. There is no application data cache (no Redis, no Memcached).
- **N+1 patterns are common in services.** `grep "while.*sqlFetchArray"` returns 10+ hits in `src/Services/` (PatientNameHistoryService, PractitionerRoleService, ImmunizationService, DocumentService, etc.). The pattern fetches a parent set then issues per-row sub-queries. For a chart-summary use case that reads tens of children per parent, this is the dominant latency cost.
- **`SELECT *` survives in services.** `PatientService.php:659` runs `SELECT * FROM patient_data` for `findByPid`. Wide rows + zero column projection = wasted I/O. Fine for a single-row lookup; bad if generalized.
- **Legacy hot paths are huge.** `library/options.inc.php` is 4,869 lines, `library/globals.inc.php` is 4,583 lines, `library/clinical_rules.php` is 3,532 lines. These are required-once on most page loads via `interface/globals.php`. Opcache helps, but cold-start latency on a fresh PHP-FPM worker is non-trivial.

### 2.3 Frontend

- **Angular 1.8** (per CLAUDE.md tech stack) is past EOL (Jan 2022) — long-term liability.
- **jQuery 3.7 + Bootstrap 4.6 + Smarty 4.5 alongside Twig 3.x** — three template engines coexist. The agent's UI will need to pick one and stay in it.

### 2.4 Implications for an LLM agent

- Latency budget for "fetch patient timeline" will be dominated by N+1 queries plus full-text/longtext columns. Consider materializing a denormalized "agent context" view or a service that pre-joins forms/encounter/results into a single query with explicit columns.
- Without indexes on `log.date` or `log.event`, audit queries (which the agent will write to record itself) will get slower as the log grows. Plan a partition or rotation policy now.

---

## 3. Architecture Audit

### 3.1 Code organization

- `/src/` (1,938 PHP files): modern PSR-4 `OpenEMR\` namespace, strict typing in newer files, classes per CLAUDE.md.
- `/library/` (596 PHP files): legacy procedural — `auth.inc.php`, `sql.inc.php`, `patient.inc.php`, etc. Some are still loaded via `composer.json` `autoload.files` (`global_functions.inc.php`, `htmlspecialchars.inc.php`, `formdata.inc.php`, `sanitize.inc.php`, `formatting.inc.php`, `date_functions.php`, `validate_core.php`, `translation.inc.php`).
- `/interface/` (1,001 PHP files): legacy UI controllers and Smarty templates.
- `/portal/` (174 PHP files): patient portal — separate session cookie (`SessionConfigurationBuilder::forPortal`), separate auth surface (`patient_access_onsite` table).
- `/apis/` + `/oauth2/`: REST and OAuth2 entry points, dispatched through Symfony HttpKernel.
- `/ccdaservice/`: a separate Node.js TCP service for CCDA generation/parsing (`serveccda.js`) — talks to PHP over a TCP socket. Adds an out-of-process dependency that needs to be reachable from PHP for CCDA exports/imports.

### 3.2 Layering

- Modern stack: Symfony DI container (`src/Core/Kernel.php`), Symfony EventDispatcher, Doctrine DBAL 4, Twig 3, Laminas MVC.
- Legacy stack: Smarty 4.5, ADODB surface API for SQL (wrapping Doctrine DBAL underneath), `$GLOBALS` and `$_SESSION` as service locators.
- Both stacks coexist on the same page. `interface/globals.php` (809 lines) is required at the top of nearly every legacy script and pulls in 33 `$GLOBALS[...]` definitions. The two worlds connect via `OEGlobalsBag` (Symfony ParameterBag wrapper) which both reads from and writes to `$GLOBALS`.

### 3.3 Integration points (where an agent could plug in)

- **REST API** (`/apis/api/...`): standard CRUD-ish surface, ACL-guarded. ~717 routes (lines in `_rest_routes_standard.inc.php`). Each route pattern requires an explicit `request_authorization_check`.
- **FHIR R4 API** (`/apis/fhir/...`): US Core 8.0 + SMART-on-FHIR v2.2.0. ~876 lines in `_rest_routes_fhir_r4_us_core_3_1_0.inc.php`. 103 PHP files in `src/Services/FHIR/`. Strongly typed against the `philips/fhir` data classes (918 generated FHIR resource files in `src/FHIR/R4`).
- **Service layer** (`src/Services/*Service.php`, ~181 services): the right place to call from a controller — most extend `BaseService` and use `QueryUtils`.
- **Event system** (`src/Events/`): Symfony EventDispatcher with project-specific events (`PatientDemographics`, `Patient`, `Encounter`, `Messaging`, etc.). An agent can subscribe to events without touching controller code.
- **Background services** (`background_services` table, `src/Services/Background/`): a polled cron-like surface where agent jobs could live — currently used for tasks like reminders and SMS.

### 3.4 Configuration surface

- Per-site config in `sites/<site>/sqlconf.php` (DB credentials), `sites/<site>/config.php`, plus runtime `globals` SQL table (~2,000 entries via `library/globals.inc.php`).
- `.env` is minimal — only `OPENEMR__ENVIRONMENT` and `OPENEMR__NO_BACKGROUND_TASKS` are documented in `.env.example`. Nearly all real config is DB-resident, which is good for ops but brittle for tests.

### 3.5 Implications for an LLM agent

- The cleanest plug-in points are: (a) a new REST controller under `src/RestControllers/`, (b) an event subscriber in `src/Events/`, or (c) a background service registered in `background_services`. Avoid touching `library/` or `interface/` for net-new logic.
- Cross-cutting concerns (auth, logging, ACL) are reachable from `src/`. The agent should never have to import a `library/*.inc.php` file directly.

---

## 4. Data Quality Audit

### 4.1 Schema-level signals

- **Empty-string sentinels everywhere.** 54 columns are declared `varchar(255) NOT NULL DEFAULT ''`. An agent looking for "is a value present" must check both NULL and `''`.
- **Stringly-typed clinical fields.** `procedure_result.result` is varchar(255), `units` varchar(31), `abnormal` varchar(31) (comment: "no,yes,high,low" — but no CHECK constraint enforces it). `procedure_result.result_data_type` is `char(1)` with N/S/F/E/L meanings encoded in a comment.
- **`lists` is a polymorphic table** holding allergies, medications, problems, surgeries, etc., with `type` as the discriminator and many overlapping fields (`title`, `diagnosis`, `extrainfo`, `comments`). What "the patient's diagnosis list" means depends on `type='medical_problem'` filtering — an agent must know the magic strings.
- **`list_options`** is a global key-value table for *all* picklists (sex, race, ethnicity, occurrence, disclosure_type…). 100-char `option_id` strings are referenced by other tables (e.g. `patient_data.interpreter_needed`) without FK enforcement.

### 4.2 PHI completeness

- `patient_data` requires only `id` and `pid`. `fname`, `lname`, `DOB`, `sex`, addresses, phones — all default to `''` or NULL. Patient records can exist with no demographics at all.
- `users.password` is `longtext` (legacy), but real password storage moved to `users_secure.password` (`varchar(255)`). The legacy column persists; an agent reading the user table cannot trust which is authoritative without checking both.
- Soft-delete is inconsistent: `forms.deleted tinyint default 0`, `documents.deleted tinyint default 0`, but `patient_data` has no `deleted` column — patient deletion is hard-delete via the `super` ACL. If a patient is deleted, all related rows in `forms`, `lists`, `prescriptions` etc. are orphaned (no FK).

### 4.3 Identifiers

- Multiple ID systems coexist: integer `id`, `pid` (patient-facing), `pubpid` (public-facing string), and `uuid` (`binary(16)`). FHIR uses the UUID. Internal joins use `pid`. An agent that returns FHIR-compatible references must carry both.
- `encounter` numbers in `forms`/`form_encounter` are also reused — same `encounter` integer can appear in multiple `pid` rows (it is a per-patient sequence in practice but not constrained as such).

### 4.4 Free-text drag

- `lists.comments`, `pnotes` body, `forms_dictation` content, `procedure_result.comments` — all longtext/text without structure. These are where clinical narrative actually lives. An agent summarizing a patient must treat these as the primary signal but also as un-validated, potentially copy-pasted, and frequently containing PHI of *other* patients (carryover from other charts).

### 4.5 Stale data

- `last_updated` / `modifydate` columns exist on most clinical tables but are populated by `ON UPDATE CURRENT_TIMESTAMP` triggers, which means they reflect *any* row touch — including a no-op admin save — not just clinically meaningful changes.
- No "verified at" or "review date" columns on `patient_data`. The system has no built-in concept of "this demographic was last confirmed correct on X."

---

## 5. Compliance & Regulatory Audit

### 5.1 Audit logging (HIPAA §164.312(b))

- **What is logged:** `EventAuditLogger::newEvent` → `log` and `log_comment_encrypt` and (optionally) `extended_log` plus `api_log`. ATNA syslog (RFC 3881) over TLS is supported via `src/Common/Logging/Audit/Atna/TcpWriter.php` when `enable_atna_audit=1`.
- **What is configurable** (per `library/globals.inc.php`):
  - `enable_auditlog` (default 1)
  - `audit_events_patient-record` (1)
  - `audit_events_scheduling` (1)
  - `audit_events_order` (1)
  - `audit_events_lab-results` (1)
  - `audit_events_security-administration` (1)
  - `audit_events_backup` (1)
  - `audit_events_other` (1)
  - `audit_events_query` (1) — *every SELECT*, which is expensive
  - `audit_events_cdr` (0) — clinical-decision-rule queries off by default
  - `gbl_force_log_breakglass` (1)
- **Gaps:**
  - The `log` table itself has no integrity hash (`extended_log` does have `checksum` and `checksum_api`, but it is optional). A privileged DB user can edit the log undetected unless ATNA syslog is also configured.
  - No log integrity verification job is shipped.
  - There is no first-class "agent" or "machine" actor. Adding an LLM means choosing whether to log it as a synthetic user or extending `log_from` (currently `'open-emr'` or `'patient-portal'`) — pick one before launch.
  - Indexes on `log` are missing for `date`, `event`, `user` — audit *review* will be slow at scale.

### 5.2 Data retention

- **No retention policy is implemented.** Search for `retention`, `purge_log`, `data_retention`: the only hits are `password_expiration_days` (user passwords) and certificate expiration. There is no scheduled deletion of log rows, no automatic archival, no per-record retention timer.
- HIPAA does not mandate a deletion schedule (it requires *minimum* 6-year retention of audit records under §164.316), but state laws (e.g. NY 6 years, MA 30 years for hospitals) and practice policy do. The current system pushes that decision entirely onto the operator.

### 5.3 Breach notification

- No application-level breach detection or notification flow exists. Failed-login lockout is implemented (`users_secure.login_fail_counter`, `auto_block_emailed`), and the audit log records access patterns, but there is no "anomalous access" detector and no notification template aimed at patients in the event of a breach.
- HIPAA §164.404 notification obligations are entirely operator-side. An agent that exfiltrates a chart to a cloud LLM provider creates a new breach surface that the system would not detect.

### 5.4 Patient rights

- **Disclosure tracking exists** (`interface/patient_file/summary/record_disclosure.php`, list_options entries `disclosure_type` → treatment/payment/healthcareoperations, etc.). An agent that fetches a chart on behalf of a third party should be writing into this surface.
- **Amendments** are tracked (`amendments`, `amendments_history`).
- **Patient Access** is via the portal (`patient_access_onsite`, `patient_access_offsite_test`). Portal credentials are hashed in `patient_access_onsite.portal_pwd` (varchar(255)).

### 5.5 BAA implications of sending PHI to an LLM provider

- **No PHI-redaction layer exists.** Any service call that returns patient data returns full demographics + clinical notes verbatim. There is no de-identification step (no `Services/Deidentification/`, no Safe Harbor scrubber).
- **No outbound-call inventory.** Outbound HTTP from PHP is via Guzzle, primarily for: USPS address validation (`src/USPS/`), payment processors (Stripe, Sphere, Authorize.Net, Rainforest), Twilio/RingCentral (faxsms), Google OAuth, eRx/NewCrop. None of these currently send clinical narrative — the agent would be the first.
- **A BAA must be in place** with the LLM provider before *any* identifier in the §164.514 list is sent. Practical short-list of providers offering BAAs as of writing: Anthropic (Claude on AWS Bedrock with HIPAA-eligible config; direct BAA available), OpenAI (Azure OpenAI Service with BAA; direct BAA on enterprise), Google (Vertex AI with BAA on Workspace+GCP). The choice is a contract decision, not a model decision — document it before code.
- **Logging the LLM call itself** is not currently structured. The agent will need to log: model id, redaction policy version, payload hash (not payload), token counts, response stored doc id. None of these fields exist in `api_log` today.
- **Network egress controls.** PHP `curl`/Guzzle goes wherever DNS resolves. No allowlist, no proxy. Adding an LLM provider should ride through a constrained egress path so PHI cannot leak to non-BAA endpoints by misconfiguration.

### 5.6 Certifications referenced

- README mentions ONC certification (Stage III Meaningful Use) and Inferno test workflow (`.github/workflows/inferno-test.yml`). FHIR R4 + US Core 8.0 + SMART v2.2.0 are advertised in `API_README.md`. Maintaining ONC certification while adding an agent is a separate compliance track and should be reviewed with whoever owns the ONC submission.

---

## 6. Recommendations Before Building the Agent

Roughly in priority order:

1. **Choose the LLM provider on contract grounds, then document the BAA.** Without this every other control is theater.
2. **Build a single read service for "agent context."** It owns the patient timeline query (one well-indexed join), enforces ACL, decrypts on egress, and emits a distinct audit event (`log_from='agent'`, custom event category). Don't let agent code call legacy services directly.
3. **Add a redaction pass** in front of the LLM call for §164.514 identifiers when not strictly needed for the task. Make the unredacted path opt-in and logged.
4. **Fix the three highest-value security defaults** before any production traffic:
   - `CORSListener.php`: don't reflect arbitrary `Origin` with credentials. Allow-list known SMART app origins.
   - `SessionConfigurationBuilder::forCore`: `cookie_secure=true`, `cookie_httponly=true`. Find and fix the script that needed JS access; do not weaken the cookie.
   - `apis/dispatch.php`: don't echo `$e->getMessage()`.
5. **Add log indexes and a retention worker.** `(date)`, `(user, date)`, `(event, date)` on `log`. A nightly `BackgroundService` that rotates rows older than the configured retention window into a cold archive table.
6. **Validate the agent's queries against current schema.** Because Doctrine Migrations is unused, write a small smoke test that runs the agent's SQL against a fresh `database.sql` dump in CI.
7. **Pick one ID system for agent I/O — UUID.** It is the FHIR-stable identifier and the only one that survives patient merges cleanly.

---

## Notes on this audit

- Static review only. No production data, no live traces, no profiler output. Some performance claims (cold-start, query latency) are inferred from file size + observed query patterns and would benefit from a real `EXPLAIN`/APM pass.
- The existing `AUDIT.md` at the repo root was not read per user instruction — this report is independent.
- `Documentation/AgentForge/` was not read per user instruction.
