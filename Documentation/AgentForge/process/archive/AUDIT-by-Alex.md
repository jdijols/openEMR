# OpenEMR Audit

> Read-only static analysis of `openemr/openemr` (commit at `research/openemr-recon/`, ~957MB, v8.0.0.3 line). Hard-gate deliverable for AgentForge Clinical Co-Pilot. Audit date: 2026-04-28. Builds on `research/openemr-recon-brief.md`. All findings cited file:line.

## Summary

The locked architecture (Python sidecar, FHIR-only data access, OAuth2/SMART token passthrough, no service account, GACL on every read) is **defensible but rests on three premises this audit confirms — and one it forces to be reframed.** Findings below are filtered for impact: HIPAA-blocking, architecture-shaping, exploitable in <30 min, or measurably hurting agent latency/groundedness.

**Confirmed (architecture stays):**

1. **GACL is application-layer, action-scoped — not row-scoped.** `AclMain::aclCheckCore()` (`src/Common/Acl/AclMain.php:166–238`) checks `(section, value, user)` like `('patients','med')` against the GACL graph; it never takes a `pid`. The CHANGELOG names eight IDOR / "Missing ACL" advisories shipped in the last two minor releases (`CHANGELOG.md:10–25, 65–71`), proof that "GACL is enforced where developers remember to call it." Direct DB access by a sidecar is therefore a HIPAA breach, exactly as `ARCHITECTURE.md` §1.2 assumes. Every clinical fact must travel through a controller that calls `aclCheckCore` or `RestConfig::request_authorization_check` (`src/RestControllers/Config/RestConfig.php:185–194`).
2. **Sample data is unusable for clinical evals.** `sql/example_patient_data.sql` ships **14 INSERTs into `patient_data`, zero encounters, zero notes**. Synthetic data generation is project work, not prep, and feeds eval design directly.
3. **FHIR coverage is broad enough for MVP read scope.** 35 R4/US-Core resources are routed (`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`), including AllergyIntolerance, Condition, MedicationRequest, Encounter, DocumentReference, Observation. Token passthrough works as designed.

**Reframes the architecture (must be addressed):**

4. **`form_soap` is not exposed via FHIR.** OpenEMR's `FhirClinicalNotesService` queries only `form_clinical_notes` (`src/Services/ClinicalNotesService.php:25` — `TABLE_NAME = "form_clinical_notes"`), and no FHIR service in `src/Services/FHIR/` references `form_soap`. The architecture's "FHIR DocumentReference for SOAP" claim is wrong. Two clean options: (a) generate synthetic notes only into `form_clinical_notes` and skip SOAP, or (b) build the extended PHP endpoint already named as a fallback in `ARCHITECTURE.md` §1.2. Recommendation: **(a) for MVP.** It eliminates a custom PHP diff, narrows the FHIR surface to one tested path, and the synthetic generator controls the shape. Document SOAP coverage as post-MVP.
5. **Patient-context binding is sidecar-only at the FHIR boundary.** With a `user/` (physician) scope token, `_rest_routes_fhir_r4_us_core_3_1_0.inc.php:73–84` falls into the `else` branch and calls `getAll($getParams)` with **no `$puuidBind`** — the token can fetch any patient's data. Only `patient/` scope tokens get bound (`HttpRestRequest::getPatientUUIDString()`, `src/Common/Http/HttpRestRequest.php:544–552`). The architecture's claim that "OpenEMR's PHP enforces GACL on every read" is true but does **not** include per-patient scoping for physician tokens. The session-scoped `target_patient_id == session.patient_id` check in the sidecar is therefore the **only** wall between a jailbroken LLM and another patient's chart. This is consistent with the architecture's `patient-context binding` rule (§1.3) but reframes it from "defense-in-depth" to "load-bearing primary defense." Worth a callout.

**Highest-impact specific risks:**

6. **`admin/pass` ships as documented production credentials** (`docker/production/docker-compose.yml:1, CLAUDE.md` quick-start). Demo deployments default to admin/pass unless `OE_USER`/`OE_PASS` are overridden. Block any demo on a public IP. The PRD's BAA-on-hosting rule already covers this, but the failure mode is one missed env var.
7. **Core session cookie is `HttpOnly=false`** (`src/Common/Session/SessionConfigurationBuilder.php:88`). Combined with the 2026-Q1 stored-XSS pattern (5 stored-XSS advisories in 8.0.0.2/3), session theft via XSS is a live exploit class. The agent iframe inherits this.
8. **Iframe seam has no `frame-ancestors` policy** on encounter views. `X-Frame-Options: DENY` is set only on `interface/login/login.php:29` and `portal/index.php:20`. The sidecar iframe URL embedding the OAuth token (architecture A6 risk) is the inverse direction and is the leak surface — token-in-URL plus referrer/log/history exposure remains the loudest open risk.
9. **Audit log is too coarse for agent provenance.** `audit_master` (`sql/database.sql:148–162`) tracks approval workflow only (1=Pending, 2=Approved, …); the broader `log` table (`sql/database.sql:7758–7776`) captures `event/category/user/patient_id/comments` but is event-typed, not field-typed. Neither is sufficient for "who asked the agent what about whom and what did it answer." The architecture's planned `ai_agent_audit` table is correct.
10. **Notes retrieval will be slow at scale.** `form_clinical_notes` has **no `pid` index** (`sql/database.sql:1972–1993`); `form_soap` has **no indexes at all beyond PK** (`sql/database.sql:2396–2409`). At demo scale (≤20 patients × handful of notes each) this is invisible; at pilot scale it dominates Q&A latency. Pre-bake masks it but agent-side retrieval re-queries are at risk.

The 5-section detail follows.

---

## 1. Security audit

### 1.1 Authorization

| # | Finding | File:line | Impact |
|---|---|---|---|
| S1 | **Action-scoped, not row-scoped GACL.** `aclCheckCore($section, $value, $user)` returns true/false for an ACO category (e.g. `patients/med`). No `pid`, `encounter`, or facility argument. Once the user has the action, they can read any row. | `src/Common/Acl/AclMain.php:166–238` | Architecture-confirming. Direct DB bypass would skip even this; FHIR-via-controller path is correct. |
| S2 | **Superuser implicit allow.** `aclCheckCore` short-circuits when `admin/super` is granted, regardless of the requested section (line 174). | `src/Common/Acl/AclMain.php:174` | Default `admin` user holds this. Any sidecar token issued from `admin` bypasses every check. The "agent's privileges = physician's privileges" rule (ARCHITECTURE §1.3) MUST forbid `admin` accounts from launching the agent. |
| S3 | **Empty ACO spec returns true.** `aclCheckAcoSpec($aco_spec, …)` returns `true` when `$aco_spec` is empty. Caller-mistake fail-open. | `src/Common/Acl/AclMain.php:336–339` | Sidecar must not re-use this helper — explicit `aclCheckCore` calls only. |
| S4 | **FHIR `user/` scope = unbound patient access.** With a physician (`user/`) scope token, route handlers fall into the `else` branch and pass no `$puuidBind` to the controller. The token can pull any patient's data via `?patient=<other-uuid>`. Only `patient/` scope tokens get bound. | `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:73–95` (and pattern repeats for ~30 resources); `src/Common/Http/HttpRestRequest.php:544–552` | **Reframes architecture.** The sidecar's `target_patient_id == session.patient_id` check is the *primary*, not secondary, defense against cross-patient leakage. Document this. |
| S5 | **Recent CVE pattern: missing/wrong ACL on app-layer endpoints.** 8.0.0.3 alone shipped fixes for: Missing Auth on Procedure Order delete, Missing Auth on Claim File download, IDOR in Patient Notes, IDOR in Portal Payment, IDOR in Fee Sheet, Missing ACL on Insurance API, Missing ACL on Import/Export. 8.0.0.2 fixed `zhAclCheck ignores explicit ACL denies`. | `CHANGELOG.md:10–25, 65–71` | Confirms "GACL is enforced where remembered." Pin OpenEMR ≥8.0.0.3 for any deployment. |

### 1.2 Authentication / credentials

| # | Finding | File:line | Impact |
|---|---|---|---|
| S6 | **Default `admin/pass` ships in production docker compose.** | `docker/production/docker-compose.yml:1–4`, top-level `CLAUDE.md` quick-start | One missed env-var override on demo deploy = full PHI exposure. Hard rule: rotate before any non-loopback bind. |
| S7 | Passwords in modern path use argon2id/argon2i with bcrypt fallback — fine. Legacy `users.password` column still holds **SHA-1** values for the example users. | `src/Common/Auth/AuthHash.php:76–106`; `sql/example_patient_users.sql:8–9` | Not new-code risk. Don't generate any synthetic users with the legacy path. |
| S8 | **Core session cookie `HttpOnly=false`.** | `src/Common/Session/SessionConfigurationBuilder.php:88` | Stored-XSS → session takeover. With 5 stored-XSS advisories in 8.0.0.2/3, this is not theoretical. The agent iframe inherits the same session domain unless served from a separate origin. |

### 1.3 Iframe / token-passthrough seam

| # | Finding | File:line | Impact |
|---|---|---|---|
| S9 | `X-Frame-Options: DENY` is set only on login/portal (`interface/login/login.php:29`, `portal/index.php:20`). Encounter views (where the AgentForge tab lives) have no frame-ancestors restriction. | grep `Header(.*Frame.*` across repo (3 hits) | Direction is right — OpenEMR pages CAN host an iframe. The risk is the inverse: the sidecar iframe URL contains the OAuth token (A6 risk in architecture). Tighten with `frame-ancestors` on the sidecar response, not on OpenEMR. |
| S10 | OAuth session uses `SameSite=None; Secure` (`src/Common/Session/SessionConfigurationBuilder.php:99–100`) — required for cross-origin iframe but means CSRF defenses must come from token validation, not cookie. CSRF utility (`src/Common/Csrf/CsrfUtils.php`) exists but is form-token, not OAuth-token. | `src/Common/Session/SessionConfigurationBuilder.php:94–102` | Sidecar's chat endpoints must validate the bearer token on every call; can't rely on cookie origin. |

### 1.4 PHI exposure / data flows

| # | Finding | File:line | Impact |
|---|---|---|---|
| S11 | **SSN, driver's license stored unencrypted** as `varchar(255)` in `patient_data`. Sample SQL has plaintext SSNs (`'456789123'`, etc.). | `sql/database.sql:8334–8355`; `sql/example_patient_data.sql:2` | Don't ship samples to a hosted demo without scrubbing. The agent must NOT pre-bake SSN/DL into the LLM context — exclude these columns at the FHIR/tool layer. |
| S12 | `api_log` table captures full `request_body` and `response` as `longtext`. | `sql/database.sql:91–105` | If enabled, every FHIR request the sidecar makes lands here as PHI in plaintext. Either disable for the agent's calls or scope retention. |

---

## 2. Performance audit

Target: <3s per Q&A turn.

| # | Finding | File:line | Impact on agent |
|---|---|---|---|
| P1 | **`form_clinical_notes` has no `pid` or `encounter` index.** Only PK on `id` and unique on `uuid`. | `sql/database.sql:1972–1993` | "All notes for patient X" = full table scan. At pilot scale (10K+ notes) this dominates Q&A. Add `KEY (pid, encounter)` before any pilot. |
| P2 | **`form_soap` has no indexes at all beyond PK on `id`.** No `pid`, no `encounter`, no `date`. | `sql/database.sql:2396–2409` | Even worse than P1. If we don't expose SOAP via FHIR, irrelevant for MVP. If we do (extended endpoint), this is a blocker. |
| P3 | `form_encounter` indexed on `(pid, encounter)` and `date` — fine. | `sql/database.sql:2058–2061` | Encounter lookup is fast. |
| P4 | `lists` indexed on `pid` and `type`; `prescriptions` on `patient_id`. | `sql/database.sql:7724–7742` (lists region), `sql/database.sql:8748–8751` | Problems and meds queries are fast at MVP scale. |
| P5 | **N+1 risk in pre-bake fan-out.** Each FHIR resource hits a separate controller with its own GACL check (`src/RestControllers/Config/RestConfig.php:180–194` per call), each round-tripping the SessionWrapper. 7 tools × 1 patient = 7 sequential auth checks unless parallelized. | Routes file plus `RestConfig::authorization_check` | At MVP, parallelize tool fan-out client-side (architecture already says this in §1.2). At pilot, evaluate `system/` scope token + sidecar-side patient binding to skip N GACL roundtrips — but losing per-call GACL is a HIPAA tradeoff. Don't change this for MVP. |
| P6 | Sessions go through PHPSessionWrapper; recent issue `PHPSessionWrapper constructor bypasses read_and_close session mode, causing lock contention` (#10931, fixed in 8.0.0.2). | `CHANGELOG.md:73` | Session lock contention surfaces as request stalls. Pin ≥8.0.0.2. |

**Bottom line:** at MVP demo scale (≤20 patients), the only performance risk that matters is P1 if and when notes count grows. Pre-bake masks it; live Q&A re-queries on stale cache will hit it.

---

## 3. Architecture audit

### 3.1 Where data lives — confirmed

The recon brief is correct on table layout. Adding two findings the brief missed:

| # | Finding | File:line |
|---|---|---|
| A1 | **`form_soap` is NOT in any FHIR service.** `FhirClinicalNotesService` (`src/Services/FHIR/DocumentReference/FhirClinicalNotesService.php:193–215`) queries only the `form_clinical_notes` path via `ClinicalNotesService` (`src/Services/ClinicalNotesService.php:25 — TABLE_NAME = "form_clinical_notes"`). No `form_soap` references in `src/Services/FHIR/**`. **The architecture's claim that DocumentReference covers SOAP is wrong.** |
| A2 | **`audit_master` is approval-workflow, not access-log.** Schema is `(pid, user_id, approval_status [1-5 enum], comments, created_time, ip_address, type [1-10 enum])`. The richer `log` table (`sql/database.sql:7758–7776`) captures `event, category, user, patient_id, comments, success, checksum, log_from` and is what populates the audit-log report UI. Both are inadequate for AI provenance. The planned `ai_agent_audit` table is the correct call. |

### 3.2 Integration points — sidecar choice validated

| # | Finding | File:line |
|---|---|---|
| A3 | **FHIR R4 / US-Core 3.1.0 routes — 35 resources**, all reading from the OpenEMR services layer (`src/Services/FHIR/`). Each route does an `if isPatientRequest()` check and routes to either bound (patient context) or unbound (physician context) controller calls. | `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php:72–end` |
| A4 | **Patient-launch context binding** is plumbed via `HttpRestRequest::getPatientUUIDString()` and only consulted inside route handlers when `$request->isPatientRequest() === true`. The sidecar should request `launch/patient` scope to get this, OR enforce binding in-process (the architecture chose the latter, which is correct given S4). | `src/Common/Http/HttpRestRequest.php:544–562`, `src/Common/Http/HttpRestRouteHandler.php:60–67` |
| A5 | **Tab-into-encounter** integration: encounter view templates live under `interface/forms/` and `templates/`. A single PHP edit to add an `AgentForge` tab is realistic (architecture §1.1). The harder bit will be passing the OAuth token without putting it in the URL — consider postMessage from parent to iframe at handshake instead. | `interface/forms/`, `templates/` (Twig) |

### 3.3 Upgrade path

OpenEMR ships major + dot releases roughly quarterly (CHANGELOG cadence). Sidecar isolation means OpenEMR upgrades don't break us provided we depend only on the FHIR R4 contract. Lock pinning to `≥8.0.0.3` for security baseline.

---

## 4. Data quality audit

### 4.1 Sample data — recon claim confirmed and quantified

| Table | Sample rows shipped | Quality |
|---|---|---|
| `patient_data` | **14** (`sql/example_patient_data.sql`, 14 `INSERT INTO`) | Realistic names/SSN/DOB/address. Plaintext SSNs. |
| `form_encounter` | **0** | None. |
| `form_clinical_notes` | **0** | None. |
| `form_soap` | **0** | None. |
| `prescriptions` | **0** | None. |
| `lists` (problems/allergies) | **0** | None. |
| `users` (providers, via `example_patient_users.sql`) | **2** (`davis`, `hamming`) — pre-hashed SHA-1 passwords | Legacy path. |

**Implication for evals:** every clinical narrative used for accuracy / groundedness / recall measurement is a synthetic fixture **we generate**. This is the loudest open risk in `ARCHITECTURE.md` §3.4 (A3) and the audit confirms the dependency: there's literally nothing to measure against without it.

### 4.2 Data shape we need to generate

To test the seven-tool MVP set:

| Tool | Tables touched | Min synthetic rows per patient |
|---|---|---|
| `get_patient_summary` | (aggregator) | n/a |
| `get_meds` | `prescriptions` | 3–6 active, 2–4 historic |
| `get_problems` | `lists` (`type='medical_problem'`, `'allergy'`) | 3–5 problems, 1–2 allergies |
| `get_recent_labs` | `procedure_result` / `form_observation` (heterogeneous, see recon) | 2–3 panels, last 90d |
| `search_notes` | `form_clinical_notes` (skip `form_soap` per A1) | 2–4 follow-up notes per visit, last 12 months |
| `verify_drug_interaction` | RxNorm (external) | n/a |
| `check_authorization` | GACL (PHP-side) | n/a |

Per follow-up day: 20 patients × ~12 records each = ~240 rows total. Trivial volume; the work is **realism**, not scale.

### 4.3 Inconsistencies to budget for

- `prescriptions.drug` is free text (`varchar(150)`); `rxnorm_drugcode` is optional (`sql/database.sql:8709–8711`). Real EMR data has misspelled drug names. The agent's drug-interaction tool must tolerate fuzzy match to RxNorm or refuse cleanly.
- `lists` mixes problems / allergies / surgeries via `type` enum-as-string. Don't filter on `title` — filter on `type`.
- `form_encounter.pc_catid` is configurable per institution. The "follow-up only" scope filter (`pc_catid = N`) requires a known mapping per OpenEMR install, not a fixed value.

---

## 5. Compliance & regulatory audit

### 5.1 Audit logging — gap confirmed

| Concern | Status |
|---|---|
| Per-read PHI access log | **Insufficient.** `audit_master` is approval-workflow (`sql/database.sql:148–162`); `log` table (`sql/database.sql:7758–7776`) is event/menu-driven, not field-level. Neither captures "user X read field Y of patient Z at time T." |
| Tamper detection | `log.checksum` exists; tamper report at `interface/reports/audit_log_tamper_report.php`. Workable. |
| SQL-statement audit | `auditSQLEvent` instrumented at the DBAL layer (`library/ADODB_mysqli_log.php:50`, `src/Common/Logging/EventAuditLogger.php:390`). Logs every SQL — high volume, low semantic value for AI provenance. |
| Agent-specific provenance | **Must be added.** Architecture's planned `ai_agent_audit(physician_id, tool, params, ts, patient_id, return_truncated, trace_id)` is necessary AND sufficient. 6-year retention per HIPAA aligns with `log` table convention. |

### 5.2 BAA implications for LLM

Per HIPAA, a CSP that processes PHI is a Business Associate. The Anthropic Zero-Data-Retention BAA covers the LLM call. The hosting boundary is what bites — **Railway and similar default tiers do not sign a BAA**, which is why the architecture restricts MVP to demo data only. Audit confirms this is correct, not over-cautious.

The agent-side risk: prompt-cache breakpoints (architecture §1.4) include patient context. Cached patient context in the LLM provider's cache is "transmission of PHI" under HIPAA; ZDR-BAA explicitly allows this. Verify cache-region settings (US, BAA-covered region) at deploy time.

### 5.3 HIPAA Security Rule alignment

- **Administrative** (164.308): role-based access via GACL — present, with caveats S1/S2/S5.
- **Physical** (164.310): out of scope for software audit; deferred to deploy plan.
- **Technical**:
  - 164.312(a) Access control: GACL + OAuth2 — adequate when correctly used.
  - 164.312(b) Audit controls: insufficient out of the box (above).
  - 164.312(c) Integrity: `log.checksum` is partial; no row-level integrity checks on `patient_data`.
  - 164.312(d) Person/entity auth: passwords (argon2id, S7) + OAuth — fine.
  - 164.312(e) Transmission security: TLS at the deploy layer; OAuth session sets `Secure` (S10). Non-OAuth core session `HttpOnly=false` (S8) is the gap.

### 5.4 21st Century Cures / FHIR mandate

OpenEMR is ONC-certified and exposes US-Core 3.1.0 over R4 (35 resources, A3). The architecture's "FHIR-only data access" choice aligns with the Cures Act information-blocking rule. No additional work for compliance.

### 5.5 Breach notification primitives

`api_log` (S12) and `log` capture access events with IP and user. Adequate for "who accessed what" reconstruction in a breach investigation. **Breach notification workflow itself is out of scope for software** (it's an operational obligation), but the data trail to support it is present.

---

## Appendix: files cited

- `src/Common/Acl/AclMain.php`
- `src/RestControllers/Config/RestConfig.php`
- `src/RestControllers/SMART/PatientContextSearchController.php`
- `src/Common/Http/HttpRestRequest.php`, `HttpRestRouteHandler.php`
- `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`
- `src/Services/ClinicalNotesService.php`
- `src/Services/FHIR/DocumentReference/FhirClinicalNotesService.php`
- `src/Common/Session/SessionConfigurationBuilder.php`
- `src/Common/Auth/AuthHash.php`
- `src/Common/Logging/EventAuditLogger.php`
- `sql/database.sql`, `sql/example_patient_data.sql`, `sql/example_patient_users.sql`
- `docker/production/docker-compose.yml`
- `CHANGELOG.md`, top-level `CLAUDE.md`
