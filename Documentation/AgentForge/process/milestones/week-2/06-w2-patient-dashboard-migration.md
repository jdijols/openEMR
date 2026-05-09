# 06 — W2 Patient Dashboard migration

> Milestone covering the W2 surprise-challenge sub-project from the brief drop (2026-05-06) through the Architecture 2 pivot (2026-05-09). This is a **separate deliverable** from the W2 Clinical Co-Pilot brief covered by milestones 02–05; the dashboard work runs in parallel and shares the same Sunday-noon submission deadline. Saturday's integration work + defense doc + submission are the next milestone.

## Purpose

The 2026-05-06 surprise-challenge brief ([PDF](../../../references/AgentForge_Clinical-Co-Pilot_W2_Surprise-Challenge_Modernize-the-Patient-Dashboard.pdf)) requires porting OpenEMR's patient-chart dashboard to a modern framework consuming the existing REST/FHIR API as the data layer. Two graded artifacts: the working app + a written defense in `PATIENT_DASHBOARD_MIGRATION.md`. The brief explicitly forbids backend changes.

This milestone documents:

1. The reverse-first methodology applied before any code was written (1.5h that paid for itself many times over).
2. The Tier 0 / Tier 1 / Phase 7 scope discipline that protected the deadline against feature creep.
3. The 11 cards built across Phases 1–4 (auth → FHIR client → Tier 0 cards → Tier 1 stretch).
4. The mid-build architecture pivot (standalone SPA → embedded module) and what triggered it.
5. The design-language unification that brings the new dashboard, the W1 CUI rail, and (Saturday) the elevated PHP chrome into one visual vocabulary.

## Phase 0 — reverse-first auditing (2026-05-08 morning)

Following the framework Tom Tarpey demoed in the [W2-Migration-Meeting](../../journal/week-2/0509-T0004-w2-dashboard-embedded-pivot.md) (slides at <https://vb6-legacy-slides.netlify.app>; reference repo at <https://github.com/decagondev/vb6-rework-reverse-forward>), Phase 0 produced a complete behavioral contract for the legacy dashboard *before* writing a line of React. The output lives at [`Documentation/AgentForge/implementation/dashboard-recon/`](../../../implementation/dashboard-recon/) — **1,599 lines across 16 docs**:

- [`manifest.md`](../../../implementation/dashboard-recon/manifest.md) — the demographics.php entry-point map. All 22 legacy cards inventoried, with dispatch type (Direct Twig / Card class+Section / Lazy fragment / meta-fragment via stats.php), ACL gate, hide-card global, Twig template path, PHP service class. Three dispatch patterns documented; a fourth (`stats.php` meta-fragment) discovered during PD-02 and back-filled.
- [`cards/`](../../../implementation/dashboard-recon/cards/) — 12 per-card MDs (7 Tier-0 + 5 Tier-1) capturing source mapping, rendered field set, ACL checks, hide-card key, edit affordances, empty-state copy, FHIR mapping, notable quirks. The parity contract for each card we'd port.
- [`PARITY-NOTES.md`](../../../implementation/dashboard-recon/PARITY-NOTES.md) — decisions of the form *"the legacy does X; we will / will not match it because Y."* Layout (single-scroll vs. 2-col), auth (trust OAuth scopes vs. per-card ACL), card-hiding (deferred V2), severity color-coding (legacy renders yellow regardless; we color by criticality), empty-state copy standardization, and 11 specific FHIR-fidelity gaps.
- [`MIGRATION-OPTIONS.md`](../../../implementation/dashboard-recon/MIGRATION-OPTIONS.md) — 5-route comparison (Next.js App Router / SvelteKit / Remix / vanilla TS+Lit / React+Vite) scored against budget, timeline, capability, fidelity. Selected route: React+Vite — same stack as the W1 CUI; lowest-risk path.
- [`screenshots/`](../../assets/W2-Migrate-to-React-Screenshots/) — 28 captures from manual recon (Sofia Reyes — pid 0031), every card's loaded/empty state plus pencil-edit affordance + top-nav strip + login + calendar. Cross-referenced from manifest.md and per-card MDs.

The output makes the rest of the build mechanical. Every Tier-0 card maps to *"render the fields in `cards/<NAME>-CARD.md` from the FHIR shape in `cards/<NAME>-CARD.md`."*

## Phases 1–4 — auth + FHIR + 11 cards (2026-05-08 morning → 2026-05-08 evening)

Built in [`patient-dashboard/`](../../../../../patient-dashboard/) — a separate React + Vite + TypeScript project mirroring the W1 CUI's scaffolding. Stack: React 19 + Vite 8 + TS 6 + TanStack Query 5 + Zod 4 + Tailwind 3.4 + Vitest 4 (versions taken from the scaffold, not pinned aspirationally). **Strict typing throughout** — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly` per project convention.

| Phase | What landed | Rough cost |
|---|---|---|
| 1 — Scaffold + auth | Vite project; OAuth2 + PKCE flow with sessionStorage rehydration of the verifier across full-page navigations; PHP-side OAuth2 client registration via console-fetch (the admin UI silently 500'd — fell back to RFC 7591 dynamic registration per Tom's heads-up) | ~3h |
| 2 — FHIR client + card shell | Typed `fhirGet<T>` wrapper with Bearer auth, typed error variants (`unauthorized` / `http` / `parse` / `network`), correlation IDs; narrow Zod schemas for Patient, AllergyIntolerance, Condition, MedicationRequest, CareTeam, Observation, Immunization, Appointment + `FhirBundleSchema<T>` envelope helper; `useFhirQuery` hook (auth-token-gated, no-retry on 401, retries other errors once); `<ClinicalCard>` shared shell (loading skeleton / empty / error+correlationId / content states); QueryCache `onError` global 401 → `/login` redirect | ~2h |
| 3 — Tier 0 cards | `<PatientHeader>` (name + DOB + sex + MRN + active pill, sticky-top), `<AllergiesCard>` (severity color-coded by criticality — red/amber/emerald/zinc rather than legacy's yellow-everywhere), `<ProblemListCard>`, `<MedicationsCard>`, `<PrescriptionsCard>` (sorted by authoredOn desc, max 10), `<CareTeamCard>` (table layout with team-name banner + status pill), `<VitalsCard>` (single most-recent encounter as key/value rows after PD-00 visual capture revealed legacy renders one encounter, not 10 readings) | ~5h |
| 4 — Tier 1 stretch + UCUM polish | `<DemographicsCard>` (reuses Patient query; no extra fetch via TanStack Query cache key sharing), `<HealthConcernsCard>` (Condition with category=health-concern; shares `<ConditionList>` with Problem List), `<ImmunizationsCard>`, `<AppointmentsCard>` (status pills booked=emerald, cancelled=red, default=zinc), `<LabsCard>` (LOINC name + value+unit + reference range + abnormal H/L pill in red — most clinically vivid card in the demo); UCUM unit display helper (`lb_av` → "lb", `degF` → "°F", `kg/m2` → "kg/m²") applied to Vitals + Labs | ~3h |

Outcome by end of Phase 4: **11 cards rendering live FHIR data** end-to-end against four cohort patients (Sofia Reyes, Margaret Chen, Phil Belford, Raymond Cooper). **113 vitest cases passing across 18 test files.** `tsc --noEmit` clean. Production bundle ~114 KB gzipped. The clinically-vivid signal — Raymond Cooper's Hgb A1c trending 7.6 → 7 → 7.4 → 6.9% (all flagged High in red) and GFR 52 → 49 → 51 mL/min/1.73m² (all Low) — confirms the FHIR pipeline is working with real data.

## Phase 5 (initial) — production build + Docker prep (2026-05-08 evening)

First pass at deploy: production `npm run build` (114 KB gzipped, well under the PRD's 250 KB ceiling), nginx + Caddy sibling-container setup, Caddyfile path-based routing for `/dashboard/*`, scoped CSS overrides plan for Phase 7. **D6 audit passed** — `dist/index.html` contains zero PHP, zero Twig, zero Smarty (verified via cat). **D7 audit passed** — id_token claims confirm clinician auth context (`sub` = clinician user UUID; `fhirUser` = OpenEMR `Person` resource; `iss` = OpenEMR's OAuth2 issuer; 1-hour token lifetime).

This phase landed but was **superseded by the architecture pivot below**. The Caddy route + sibling-container setup is no longer the deploy model; the React app instead ships into the agentforge module's `public/dashboard/` directory. The D6 + D7 audits remain valid for both architectures.

## Architecture 2 pivot — embedded module (2026-05-09 ~midnight)

The full pivot rationale and decision history lives in [PRD §14](../../../implementation/PRD-patient-dashboard.md) and the [session journal](../../journal/week-2/0509-T0004-w2-dashboard-embedded-pivot.md). The summary:

**Trigger:** end-to-end smoke against four cohort patients revealed the standalone-SPA architecture forced **5 screens** to reach the dashboard (login → patient picker → consent → callback → dashboard) vs. legacy's **3** (login → calendar → chart). Standalone also dropped the W1 CUI rail and the OpenEMR shell from the demo path entirely.

**Reframing:** the original PRD §6/§7 read the brief's *"Frankenstein coexistence"* clarification as "two apps coexisting at different URLs." The user's actual mental model was *"modernize one panel of the chart while everything around it keeps working."* The brief allows either model — *"Authentication via OAuth2/OpenID Connect"* describes the EMR's auth mechanism, not a requirement that the React app drive its own OAuth client flow.

**Pivot:** ship the React app as static files inside `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/` (same pattern as the W1 CUI). PHP loader (`dashboard.php`, mirroring [`panel.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php)) validates the OpenEMR session, mints a SMART access token, and renders an HTML shell that injects `window.__AGENTFORGE_DASHBOARD__ = { patientId, accessToken, expiresIn }` *before* the React bundle boots. The React app boots in `authenticated` state immediately — no patient picker, no consent screen on subsequent visits, no SMART standalone-launch friction.

**Code-side foundations landed tonight (2026-05-09 ~midnight):**

- [`patient-dashboard/vite.config.ts`](../../../../../patient-dashboard/vite.config.ts) — production `base` swap to the module path; deterministic asset filenames (`agentforge-dashboard.js`, etc.); `outDir` points directly at the module's public dir so `npm run build` lands files where the loader serves them.
- [`patient-dashboard/src/auth/AuthProvider.tsx`](../../../../../patient-dashboard/src/auth/AuthProvider.tsx) — new `initialAuth` prop. When present, AuthProvider boots in `authenticated` state.
- [`patient-dashboard/src/main.tsx`](../../../../../patient-dashboard/src/main.tsx) — reads `window.__AGENTFORGE_DASHBOARD__`, seeds `initialAuth`. Standalone OAuth flow preserved as dev-mode fallback.
- [`patient-dashboard/src/App.tsx`](../../../../../patient-dashboard/src/App.tsx) — new `<HomeRoute>` redirects to `/patient/<id>` immediately when authenticated with patient context; otherwise to `/login` (dev mode).

**100% of the card/schema/test work from Phases 0–4 carries forward unchanged.** The pivot affects only the wrapper: where the React app lives, how it gets its token, how it gets the patient context.

**Saturday's remaining integration work:**

| ID | Task | Estimate |
|---|---|---|
| PD-93 | `dashboard.php` PHP loader in the agentforge module — pattern-mirror `panel.php`, validate session, read `set_pid`, mint/fetch SMART access token, render HTML with `window.__AGENTFORGE_DASHBOARD__` injection | 1h |
| PD-94 | Token issuance — investigate two candidates: (a) SMART EHR launch redirect with launch context encoded in a launch token; (b) extend the existing `LaunchCode` infrastructure in the agentforge module to mint OpenEMR-FHIR tokens | 1h |
| PD-95 | Tab integration via `openemr.bootstrap.php` — register an event listener that adds a sibling "Modernized Dashboard" tab when the agentforge module is enabled (cleaner A/B than overriding the legacy tab) | 30 min |
| PD-97 | Phase 7 visual elevation — single CSS file `interface/themes/agentforge-elevated.css` with `--af-*` variable references targeting login screen, top nav, patient header strip, calendar tab, encounter forms | ≤2h cap |
| PD-98 | End-to-end smoke against local Docker: log in, calendar, click patient, chart loads with React dashboard tab + CUI rail visible alongside | 30 min |
| Defense doc | `PATIENT_DASHBOARD_MIGRATION.md` at repo root — 10 prescribed sections per PRD §9 PD-60. Architecture-revision narrative is already in PRD §14; transpose | 1.5h |
| Submission | Scoreboard row in `submission.md`, demo recut to include 30s of the embedded dashboard | 1h |

Total: **~6.5h of focused work** against a Sunday-noon deadline. Comfortable buffer once self-injection rehearsal (W2 brief track) is also done Saturday.

## Design-language unification (2026-05-09 ~midnight)

[PRD §15](../../../implementation/PRD-patient-dashboard.md) codifies the design tokens. Source of truth: the OG image at [`branding/og-image.png`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/branding/og-image.png) (deep navy plate `#0A2540`, bright accent `#4EA3FF`, gradient bg `#031628→#061B2F`). Translated to a **light-mode product** palette using Tailwind's `slate` (cool grays) + `sky` (refined primary) + `emerald` / `amber` / `red` semantic colors. Same family, different surface — light-mode product, dark-mode brand.

The CUI's `--af-*` token *names* are unchanged from W1; only *values* swap. CUI rail auto-inherits the upgrade with **zero per-component changes** ([agentforge/cui/src/index.css](../../../../../agentforge/cui/src/index.css) edit only). [patient-dashboard/tailwind.config.js](../../../../../patient-dashboard/tailwind.config.js) gains an `af-*` color namespace mirroring the CUI tokens. Wholesale sed sweep across 14 dashboard components: `zinc-* → af-*`, `rose-* → af-danger-*`, `emerald-* → af-success-*`, `amber-* → af-warning-*`, `rounded-2xl → rounded-af-card` (8 px). 113/113 tests still passing post-repaint.

Phase 7 (Saturday) applies the same `--af-*` tokens to legacy PHP chrome via a single scoped CSS override file, completing the unification: **one design vocabulary across React (CUI rail + new dashboard) and PHP (login screen + top nav + calendar tab + encounter forms)**. WCAG-AA throughout, exceeding where cheap (focus rings on every interactive element, ≥40 px hit targets, contrast ≥ 4.5:1 verified by the slate/sky combinations).

## Decisions

Lifted from the [session journal](../../journal/week-2/0509-T0004-w2-dashboard-embedded-pivot.md) — see there for full prompts/rationale.

- **Hold scope to Tier 0 + Tier 1 + Phase 7.** Pushed back on the user's expansion request to all 22 legacy cards + edit views + top-nav rewrite + encounters (would have been 100–170h of work; available ~20h). Many out-of-scope cards have no FHIR endpoints, so porting violates "no backend changes." Phase 7 visual elevation is the better cohesion lever for the surrounding chrome.
- **Tier 1 includes Labs.** FHIR-backed (`Observation?category=laboratory`), reuses Tier-0 infrastructure, adds high clinical signal (abnormal-flag rendering on lab values is one of the most visible "real EMR" demonstrations).
- **Vitals matches legacy parity (single most-recent encounter), not 10 readings.** Resolved by PD-00 visual capture — legacy renders one encounter as key/value rows; PRD §5 acceptance criterion updated.
- **Architecture 2 (embedded module) supersedes Architecture 1 (standalone SPA).** Rationale + full reframing in PRD §14. v1 preserved for defense-doc narrative.
- **Design tokens — slate/sky-derived from OG image, not OpenEMR Bootstrap 4.6.** Light-mode product, dark-mode brand, same family. CUI rail auto-inherits the upgrade.
- **Defer integration work (PHP loader, tab hook, Phase 7) to Saturday morning.** Tonight is pure code; Saturday is OpenEMR-PHP-coupled work that benefits from a fresh head.

## Files (key entry points for the next phase)

The next session should start by reading these files in order:

1. [PRD §14](../../../implementation/PRD-patient-dashboard.md) — the live architecture contract (Architecture 2 / embedded module), supersedes §§6–7.
2. [PRD §15](../../../implementation/PRD-patient-dashboard.md) — design tokens (slate/sky), referenced by Phase 7.
3. [Session journal 0509-T0004](../../journal/week-2/0509-T0004-w2-dashboard-embedded-pivot.md) — what changed and why during the pivot, including the full decisions log.
4. [`dashboard-recon/manifest.md`](../../../implementation/dashboard-recon/manifest.md) — the legacy dashboard's dispatch map; useful as the integration contract for PD-95 (where to hook our React app into OpenEMR's tab system).
5. [`dashboard-recon/cards/`](../../../implementation/dashboard-recon/cards/) — per-card behavioral contracts; defense doc draws from these for "feature parity with the original."
6. [`interface/modules/custom_modules/oe-module-agentforge/public/panel.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php) — the W1 CUI loader. PD-93's `dashboard.php` mirrors its pattern (session validation, launch-code minting, HTML shell with bundle script tag + JSON-encoded module-base in `window.__*__`).

## Next milestone

`07-w2-patient-dashboard-integration-and-submission.md` (after Saturday's PD-93..98 + defense doc + submission integration). Will cover: the PHP loader implementation, the SMART EHR launch token mechanism chosen, the tab integration approach, the Phase 7 elevation pass, the defense doc as shipped, and the final submission scoreboard row.
