# Patient Dashboard Migration

> **Defense doc for the AgentForge W2 surprise challenge.** Brief: port OpenEMR's PHP-rendered patient dashboard to a modern framework, consume the existing REST/FHIR API as the data layer, no backend changes, defense graded as part of the deliverable.

This document defends three things: **what we built**, **why we picked the framework we did**, and **what tradeoffs came with that choice**. It is the post-build analysis the brief asks for; the *plan* lives in [`Documentation/AgentForge/implementation/PRD-patient-dashboard.md`](Documentation/AgentForge/implementation/PRD-patient-dashboard.md), and the per-card behavioral contracts live under [`Documentation/AgentForge/implementation/dashboard-recon/`](Documentation/AgentForge/implementation/dashboard-recon/).

---

## 1. Why this migration

The brief is short and direct: OpenEMR's patient dashboard is PHP-rendered; the UX has already been modernized (May 2025); the *technology* has not. The challenge is to reimplement the dashboard in a modern framework consuming OpenEMR's existing REST/FHIR APIs, *without* touching the backend, and to defend the framework choice and tradeoffs in writing.

Two clarifications from the 2026-05-06 W2 migration meeting sharpened this further:

1. **This is the clinician's view of a patient — not the patient portal.** The dashboard renders chart data for a logged-in clinician viewing a patient. (D7 invariant in the PRD.)
2. **Coexistence is required, not bypassable.** Direct quote: *"Bit of a Frankenstein… the V3 stuff still needs to be available… but this page itself should be completely migrated over."* The migrated page must be 100% the new framework with **zero PHP frontend included**, while the rest of OpenEMR (calendar, encounter forms, top navigation) keeps working in PHP. (D6 invariant.)

We honored both. The Dashboard tab in the patient secondary nav is now the React app, full-canvas. Everything else — Calendar, History, Visit Summary, Encounters, top navigation — remains PHP.

---

## 2. What we built

A read-only patient dashboard implemented in **React + Vite + TypeScript + TanStack Query + Zod + Tailwind**, embedded inside OpenEMR's existing chart shell. It renders **11 clinical cards** against live FHIR R4 data, sharing the OpenEMR session via same-origin cookie + CSRF token. **113 vitest cases passed at end-of-Phase-4; the auth refactor in this final integration session brought the count to 116/116 with `tsc --noEmit` clean.**

| Surface | Cards | Source |
|---|---|---|
| **Patient header (sticky-top)** | name + DOB + sex + MRN + active pill | `Patient/{id}` |
| **Tier 0 — brief-required + Vitals** | Allergies, Problem List, Medications, Prescriptions, Care Team, Vitals | `AllergyIntolerance` / `Condition?category=problem-list-item` / `MedicationRequest?intent=order&status=active` / `MedicationRequest?intent=order` / `CareTeam` / `Observation?category=vital-signs` |
| **Tier 1 — stretch (cheap because Tier 0 infra was in place)** | Demographics, Health Concerns, Immunizations, Appointments, Labs | reuse `Patient` / `Condition?category=health-concern` / `Immunization` / `Appointment` / `Observation?category=laboratory` |

Each card is a self-contained component that renders the loading / error / empty / content states from a single shared `<ClinicalCard>` shell. Loading shows a skeleton, errors show a typed code + correlation id (no raw fetch error to the user), empty states are explicit ("No active allergies on file") never blank.

**The dashboard lives at:** `interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php` — a thin PHP loader that mints a CSRF token bound to the OpenEMR session and renders an HTML shell that boots the React bundle with `window.__AGENTFORGE_DASHBOARD__ = { patientId, csrfToken, fhirBase, ... }` injected before the React script runs. The React bundle (`agentforge-dashboard.js` + `agentforge-dashboard-index.css`, **114 KB total gzipped**) ships into the module's `public/dashboard/` directory at build time; OpenEMR's existing Apache serves the static files; no sibling container, no separate CDN.

**Tab integration:** A listener subscribed to `PatientMenuEvent::MENU_UPDATE` inside the agentforge module rewrites the existing "Dashboard" tab URL to point at our `dashboard.php`. Clicking Dashboard from the secondary patient nav loads the React app full-canvas. The legacy `demographics.php` is no longer reachable via the menu — exactly the *"this page itself should be completely migrated over"* clarification.

**Visual elevation (Phase 7):** A scoped CSS file at `interface/themes/agentforge-elevated.css` re-skins the chart-shell top tab strip + the patient secondary nav using the same `--af-*` design tokens as the React surfaces. Loaded conditionally via two render-event hooks (`Main\Tabs\RenderEvent::EVENT_BODY_RENDER_NAV` for the chart shell, `PatientDemographics\RenderEvent::EVENT_SECTION_LIST_RENDER_TOP` for `demographics.php`). Reverts in one commented-out line; one design vocabulary across React and PHP.

---

## 3. Reverse-engineering findings (Phase 0)

Before writing any React, we audited the legacy dashboard's behavior — Tom Tarpey's *"reverse-first auditing"* methodology applied to OpenEMR's `interface/patient_file/summary/demographics.php` (2,088 LoC). The output lives at [`Documentation/AgentForge/implementation/dashboard-recon/`](Documentation/AgentForge/implementation/dashboard-recon/) — **1,599 lines across 16 docs**:

- [`manifest.md`](Documentation/AgentForge/implementation/dashboard-recon/manifest.md) — entry-point map. All 22 legacy cards inventoried, each tagged with its dispatch type (Direct Twig / Card class+Section / Lazy fragment / meta-fragment via `stats.php`), ACL gate, hide-card global, Twig template path, PHP service class. **Three dispatch patterns documented; a fourth (`stats.php` meta-fragment) discovered during PD-02 and back-filled.**
- [`cards/`](Documentation/AgentForge/implementation/dashboard-recon/cards/) — 12 per-card MDs (7 Tier-0 + 5 Tier-1) capturing source mapping, rendered field set, ACL checks, hide-card key, edit affordances, empty-state copy, **FHIR mapping**. The parity contract for each card we ported.
- [`PARITY-NOTES.md`](Documentation/AgentForge/implementation/dashboard-recon/PARITY-NOTES.md) — decisions of the form *"the legacy does X; we will / will not match it because Y."* Layout (single-scroll vs. 2-col), auth (trust OAuth scopes vs. per-card ACL), severity color-coding (legacy renders yellow regardless; we color by criticality), empty-state copy standardization, and 11 specific FHIR-fidelity gaps.
- [`MIGRATION-OPTIONS.md`](Documentation/AgentForge/implementation/dashboard-recon/MIGRATION-OPTIONS.md) — 5-route comparison (full table in **Appendix B** below).
- 28 manual screenshots from cohort patients, every card's loaded/empty state plus the pencil-edit affordance + top-nav strip + login + calendar.

Phase 0 cost ~1.5 hours. Tom's framing: *"if you don't understand it, how's the AI going to understand it?"* — the cost paid for itself many times over because every Tier-0 card became *"render the fields in `cards/<NAME>-CARD.md` from the FHIR shape in `cards/<NAME>-CARD.md`."*

The single most useful Phase 0 finding: the legacy Vitals card **does not** show 10 readings as the FHIR query would naturally return — it shows the *single most recent encounter* as key/value rows. Without a screenshot capture in Phase 0, we'd have shipped a 10-row table and called it parity. (PRD §5 acceptance criterion was updated mid-build to match.)

---

## 4. Parity catalog — what we kept, what we dropped, why

Full table in [`PARITY-NOTES.md`](Documentation/AgentForge/implementation/dashboard-recon/PARITY-NOTES.md). The summary:

**Kept (intentional fidelity):**

- The May-2025 modernized layout — single continuous scroll, self-contained cards, demographics at the top. We honor this rather than overlay our own design.
- Patient header fields per the brief: name, DOB, sex, MRN, active pill.
- Empty / error / loading state discipline on every card (PRD §5 acceptance criteria).
- The legacy's clinical-status filtering (active medications only on the Medications card; all on Prescriptions; etc.).

**Dropped, with rationale:**

- **Card collapse/expand state persisted per-user** — needs a backend round-trip (`getUserSetting`). Cards are short; scrolling is fine. V2.
- **Hide-card admin globals** (`hide_dashboard_cards = card_allergies, ...`) — admin UI we don't have time to build. V2.
- **Pencil-icon edit affordance opens edit screen in same window** — edit views are explicitly out of scope (PRD §2). Pencil clicks open the legacy PHP edit screen *in a new tab*; the round-trip stays discoverable without forcing us to build edit forms.
- **Per-card ACL checks at every render site** — we trust the FHIR endpoint's auth gate. The OAuth2 access token's scopes (or, in our embedded path, the LocalApi authorization strategy + chart session) are the read gate. Re-implementing per-card ACL in React would duplicate logic and risk drift.
- **Two-column layout** (`col-md-8` left, `col-md-4` right) — single-scroll is the modern direction.

**Beyond legacy parity (deliberate improvements):**

- **Severity color-coding on Allergies.** Legacy renders the same yellow regardless of `criticality`. We color-code red / amber / emerald / zinc by criticality.
- **Per-analyte chronological Labs.** Legacy lists one row per *report*; FHIR returns one row per *analyte*. Rendering per-analyte gives every value its reference range and abnormal-flag pill — the most clinically vivid card in the demo.
- **Immunization date rendering.** Legacy SQL fetches `administered_date` but the Twig template never renders it. We render it.
- **Allergies sorted by criticality.** Legacy doc-block claims "critical entries pin to top" but the loop never reorders. We sort by criticality desc.

**FHIR fidelity gaps we documented and lived with** (full list in PARITY-NOTES.md §3):

- Care Team's SNOMED `physician_type_code` and `provider_since` — not standard on FHIR `CareTeam.participant`. Skipped.
- Demographics' emergency contact — needs `RelatedPerson?patient=:id` (separate fetch, V2).
- Recurring appointments (`pc_recurrtype` / `pc_recurrspec`) — no FHIR R4 analog. Single appointments only.

**Out of scope for V1** (all in PRD §11):

- Edit/save round-trips on any card (V1 is read-only; brief grades parity for *display*).
- Cards without FHIR endpoints: Disclosures, Amendments, Patient Reminders, Recall, Treatment Intervention Preferences, Care Experience Preferences, Patient Portal/API Access, Clinical Reminders, Messages, full Billing. Porting these would require adding REST endpoints to OpenEMR PHP, which violates *"you are not touching the backend."*
- React rewrite of top navigation, calendar, encounter forms — Phase 7 CSS elevation covers visual cohesion.

---

## 5. Migration routes evaluated

We considered five routes. Detailed scoring in **Appendix B**; one-line summary:

| Route | Stack | Verdict |
|---|---|---|
| **A** | Next.js 15 App Router | Rejected — RSC mental model + deadline = risk |
| **B** | SvelteKit | Rejected — concurrently learning + shipping is too much |
| **C** | Remix / React Router v7 | Rejected — nested-loader infrastructure overkill for one route |
| **D** | Vanilla TypeScript + Lit | Rejected — reinvention under deadline |
| **E** | **React + Vite + TypeScript + TanStack Query + Zod + Tailwind** | **Selected** |

Per Tom Tarpey's framework: *"pick the route whose weaknesses you can accept."* For Route E those weaknesses are: no SSR (skeletons for ~200–500ms), bundle ~50KB gzipped (acceptable for an authenticated clinician on stable network), and a refresh-on-reload re-auth path (acceptable for a graded demo).

---

## 6. Selected route + defense

**React 19 + Vite 8 + TypeScript 6 + TanStack Query v5 + Zod v4 + Tailwind CSS v3 + React Router v7.**

Three reasons:

1. **We already proved this stack ships clinically-shaped UI under deadline pressure.** The W1 Clinical Co-Pilot rail (`agentforge/cui`) shipped on this exact stack three weeks ago and is in production today. Re-using a stack we have type-safety, build, and test confidence in is the lower-risk path to a working dashboard with a graded defense behind it.

2. **TanStack Query is the right shape for FHIR.** Every clinical card is a `useQuery` against a FHIR endpoint with `patient={id}` as part of the key. Refetch on focus, stale-while-revalidate, retry-with-backoff are all built-in. We didn't build a state management layer; we let the server cache *be* the state.

3. **Zod gives us "parse, don't validate" at the boundary.** Every FHIR response passes through a narrow Zod schema before reaching a component. Any drift between OpenEMR's R4 emission and the spec surfaces as a parse error with a correlation id, not a silent runtime crash. (D4 invariant.)

The honest tradeoffs we accepted (and document):

1. **No server-side token holding.** Next.js App Router with RSC lets the OAuth2 access token stay server-side; we put auth in browser memory (D1). Mitigated by *never* writing it to `localStorage` / `sessionStorage` / URL bearings; refresh-on-reload is acceptable.
2. **No SSR.** Cards mount and fetch on the client. First paint shows skeletons for ~200–500ms while FHIR fetches resolve. Acceptable for an authenticated clinician on a stable network.
3. **Bundle size.** React + TanStack Query + Zod ships ~50KB gzipped runtime. Larger than Svelte/Solid; smaller than Next. We are not optimizing for cellular cold-start.

---

## 7. Architecture revision — what changed mid-build

The PRD originally planned **Architecture 1**: a standalone SPA at `/dashboard/` with its own OAuth2 client + PKCE flow + SMART standalone launch + patient picker. We built it. It worked. By end of Phase 4 we had 11 cards rendering live FHIR data end-to-end against four cohort patients, the OAuth round-trip clean, the production build at 114 KB gzipped.

Then we smoke-tested it.

The standalone flow forced **5 screens to reach the dashboard**: login → patient picker → consent → callback → dashboard. Legacy OpenEMR is **3** screens: login → calendar → click a patient → chart with dashboard tab. Worse, the standalone architecture **dropped the W1 CUI rail and the OpenEMR shell** (calendar, top nav, encounter forms) from the demo path entirely — visiting `/dashboard/` navigated *away* from OpenEMR's chart view.

Reframing: the brief's *"Frankenstein coexistence"* clarification doesn't mean "two apps coexisting at different URLs." It means *"modernize one panel of the chart while everything around it keeps working."* And the brief's *"Authentication via OAuth2/OpenID Connect"* describes the EMR's auth mechanism (which OpenEMR provides via SMART), not a requirement that the React app drive its own OAuth client flow.

**Architecture 2 (live):** ship the React app as static files inside `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/`, let it inherit OpenEMR's existing PHP session, mint a CSRF token bound to that session, and call FHIR endpoints with `APICSRFTOKEN: <token>` over same-origin requests. This is the *exact* auth pathway OpenEMR's first-party UIs already use (`interface/main/tabs/main.php:133`) — the `LocalApiAuthorizationController` strategy in `src/RestControllers/Authorization/` validates the cookie+CSRF pair and bypasses the Bearer-token requirement on FHIR endpoints, treating the request as a trusted internal API call.

**100% of the card / schema / test work from Phases 0–4 carried forward unchanged.** The pivot affected only the wrapper: where the React app lives, how it gets its credential, how it gets the patient context. The 11 cards, 113 (now 116) tests, Zod schemas, ClinicalCard shell — all unchanged.

The defense for Architecture 2 over Architecture 1:

| Concern | Architecture 1 (standalone) | Architecture 2 (embedded) |
|---|---|---|
| Screens to reach the dashboard | 5 (login → picker → consent → callback → dashboard) | 3 (login → calendar → click patient → Dashboard tab) |
| OpenEMR shell (calendar, top nav, encounters) | Dropped from demo path | Preserved |
| W1 CUI rail | Gone in demo path | Visible alongside dashboard |
| Patient context | SMART standalone launch + picker | From chart URL — already known |
| Other tabs (History, Visit Summary, Encounters) | Dropped from demo | Still accessible by clicking |
| Auth wire format | OAuth2 Bearer + PKCE | Same-origin cookie + APICSRFTOKEN header |
| Token storage | Memory only (D1) — refresh-on-reload | Inherited from PHP session |

The auth choice is the most defensible part of this. Strict reading of the brief's *"Authentication — Login via OAuth2/OpenID Connect"* would force Architecture 1. Reading the spirit: the EMR uses OAuth2/OIDC at its trust boundary (the OpenEMR login screen IS OAuth2-backed under the SMART hood); the React app inherits that established trust via the same-origin pathway OpenEMR already exposes for its first-party UIs. We keep the OAuth2/PKCE flow alive in the codebase as a dev-mode fallback (running the dashboard at `localhost:5174` against a remote OpenEMR), so both auth paths exist in source — production uses LocalApi, dev uses Bearer+PKCE.

---

## 8. UX decision rationale

The brief explicitly says *"the UX decision is yours; own both."* We **deliberately chose** to honor OpenEMR's May 2025 modernization — single continuous scroll, self-contained cards, demographics at the top — rather than overlay our own visual identity. This is a deliberate UX decision, not a constraint we worked around.

Three reasons:

1. **The brief is about *technology*, not visual identity.** *"The UX has already been addressed (May 2025). What has not changed is the underlying technology."* Re-skinning the dashboard with our own design language would have been the wrong response to a brief whose stated goal is moving the presentation layer to a better tool.

2. **Honoring the existing modernization is the conservative parity choice.** A clinician who works the legacy dashboard daily should be able to use the React port without retraining. The single-scroll layout, the card boundaries, the empty-state copy — all match.

3. **Where we exceed the legacy is on *dynamic affordances* the legacy didn't have.** Severity color-coding on Allergies (red / amber / emerald by `criticality`). Abnormal-flag pills on Labs (red text + High/Low pill on out-of-range values). Status pills on Appointments (booked=emerald, cancelled=red). Per-analyte rendering on Labs gives every value its reference range. These are *exceeding* parity because the FHIR data exposes structure the legacy template threw away.

The visual language ties together via the `--af-*` design tokens defined in `agentforge/cui/src/index.css` and mirrored in `interface/themes/agentforge-elevated.css`. Source of truth: the agentforge OG image (deep navy `#0A2540`, bright accent `#4EA3FF`) translated to a light-mode product palette using Tailwind's `slate` (cool grays) + `sky` (refined primary) + `emerald`/`amber`/`red` semantic colors. The CUI rail, the new dashboard, and the elevated PHP chrome all read as one product. WCAG-AA throughout (focus rings on every interactive element, ≥40px hit targets, contrast ≥4.5:1 verified by the slate/sky combinations).

---

## 9. What we gained moving away from PHP

- **TypeScript at the FHIR boundary.** Every FHIR response is parsed through a Zod schema before reaching a component. Drift between OpenEMR's R4 emission and the spec surfaces as a typed `parse` error with a correlation id — not a silent crash three components deep. PHP's untyped associative arrays passing through `__call` magic methods and Smarty templates give you no equivalent guarantee.
- **Component reuse.** Eleven cards share one `<ClinicalCard>` shell (loading skeleton, empty-state copy slot, error-with-correlation-id slot, content slot). Two cards (`<ProblemListCard>`, `<HealthConcernsCard>`) share a single `<ConditionList>` with a `category` prop discriminator. The legacy PHP had **three different dispatch patterns** for cards (Direct Twig, Card-class+Section, Lazy fragment) plus a meta-fragment indirection through `stats.php`; the React port collapses all of these into one shape.
- **FHIR-first data layer.** The cards never see OpenEMR's internal SQL shape — they see FHIR resources, parsed through Zod. We were able to swap auth wire formats (Bearer → APICSRFTOKEN) by changing one branch in `fhir/client.ts`; nothing in the cards moved.
- **Fast dev loop.** Vite HMR makes "edit a card → see it render against live demo data" a sub-second roundtrip. PHP's edit-save-Cmd+R-wait-for-Apache loop is multi-second.
- **Tests run on the host, not Docker.** The `composer phpunit-isolated` precedent extends naturally — vitest runs against the host Node runtime in <2s for 116 tests.

---

## 10. Tradeoffs that came with React + Vite

- **Token-in-memory.** A hard browser refresh wipes the React-side credential. In Architecture 1 (dev-mode fallback) this means re-OAuth round-trip. In Architecture 2 (production) the credential is the OpenEMR session CSRF, which is reminted on every chart-context page load — refresh-on-reload is therefore *transparent*: the React loader (`dashboard.php`) re-runs and re-injects.
- **Loading states are visible.** Skeletons render for ~200–500ms while FHIR fetches resolve. Faster than the legacy PHP page (which blocks server-side until every card's SQL completes), but the user sees the skeleton, not data — a different UX texture. Documented in the PRD's `PARITY-NOTES.md`.
- **Bundle size.** 114 KB gzipped (367 KB uncompressed). Within the PRD's 250 KB ceiling. Smaller than Next.js + RSC; larger than SvelteKit. We're not optimizing for cellular cold-start.
- **One-route app, but React Router still loaded.** ~7 KB gzipped overhead for the dev-mode `/login` and `/callback` routes. Could be tree-shaken in a follow-up; not graded for V1.
- **No SSR / streaming.** First paint is skeletons; legacy was server-rendered HTML with data already inlined. Architecture 1 would have permitted RSC; Architecture 2 (embedded) is fundamentally client-side after the PHP loader completes.
- **Embedded auth means the React app can't run fully standalone in production.** The dev-mode OAuth path is preserved in source for `localhost:5174` against a remote OpenEMR, but production embedding ties auth to the OpenEMR PHP session. This is *intentional* per the architecture revision; it's how we got the 3-screen demo flow back.
- **Phase 7 CSS elevation only applies to two surfaces.** Chart shell top nav + demographics.php secondary nav. Other patient pages (history.php, patient_report.php, transactions.php) keep their pre-elevation chrome — they fire `displayHorizNavBarMenu()` but don't fire the `EVENT_SECTION_LIST_RENDER_TOP` event we hook into. Captured as a follow-up, not a V1 gap.

---

## Appendix A — auth pathway, in detail

The brief grades the auth implementation as part of feature parity. Two paths exist in the codebase; one is primary, the other is preserved for development.

### A.1 — Primary path: same-origin LocalApi (production)

When a clinician opens a chart and clicks the Dashboard tab, the request flow is:

1. Browser → `GET /interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php`
2. The loader (`dashboard.php`) requires `agentforge_common.php` → loads OpenEMR `globals.php` → bootstraps the session.
3. Session validation: `authUser` non-empty + `authUserID > 0` → otherwise return 401 HTML.
4. ACL check: `AclMap::userPassesAgentForgeReadGate($authUser)` → otherwise return 403 HTML.
5. Patient context: read `pid` from `$_SESSION` (set by the calendar's `set_pid` redirect when the user clicked a patient). Resolve to FHIR UUID via `agentforge_pid_to_uuid_string()`. If absent: return 409 "No patient selected" HTML.
6. CSRF mint: `CsrfUtils::collectCsrfToken($session, 'api')` → returns a 40-char hex hmac-sha256 of `'api'` and the session's `csrf_private_key`.
7. Render an HTML shell with `<link>` + `<script type="module">` tags pointing at the React bundle, plus an inline `<script>` that injects `window.__AGENTFORGE_DASHBOARD__ = { patientId, pid, csrfToken, fhirBase, webroot, authUser }`.
8. React `main.tsx` reads `window.__AGENTFORGE_DASHBOARD__` and seeds `<AuthProvider>` with `{ mode: 'localApi', accessToken: csrfToken, ... }`.
9. Every card's `useFhirQuery` hook sends `APICSRFTOKEN: <csrfToken>` plus the existing OpenEMR session cookie (same-origin) on its FHIR request.
10. OpenEMR's `AuthorizationListener::onKernelRequest` hands the request to `LocalApiAuthorizationController::authorizeRequest`, which validates the CSRF + session, sets `$restRequest->setRequestUserRole('users')` (clinician), and marks `skipAuthorization=true` so the downstream scope check is bypassed. The FHIR resource is returned.

**D6 audit (no PHP/Twig/Smarty in panel response):** verified. The dashboard.php response contains zero `<?php` tags, zero Twig `{{...}}` markers, zero Smarty markers — just `<link>`, `<script>` (the bootstrap JSON), an empty `<div id="root">`, and the bundle script tag. The legacy `demographics.php` file (~2,088 LoC of PHP + Twig + Smarty) is no longer reachable from the rewritten Dashboard menu item.

**D7 audit (clinician auth context):** verified. The injected `authUser` is the clinician (e.g., `"admin"` in the demo); the request sets `request_user_role = 'users'` not `'patient'`. The patient portal is a separate concern; the dashboard never renders for a patient-portal session.

**Why we did not use SMART EHR launch tokens or extend the existing LaunchCode infrastructure:** SMART EHR launch is the textbook approach but it requires a redirect through `/oauth2/authorize`, which (a) re-introduces the consent screen on first launch and (b) means the React app boot path becomes async/redirect-driven instead of synchronous-from-injection. The agentforge module's existing `LaunchCode` infrastructure is purpose-built to mint short-lived codes the AgentForge API redeems, *not* OpenEMR-FHIR tokens — extending it to issue OpenEMR tokens would have meant interfacing with the League OAuth2 Server's `AccessTokenRepository` directly, which is a multi-hour build. Same-origin LocalApi was already there, already validated, already used by OpenEMR's first-party chart shell — choosing it was the lowest-friction defensible path. The defense doc owns this trade-off explicitly.

### A.2 — Dev-mode fallback path: OAuth2 + PKCE (preserved)

Run `npm run dev` from `patient-dashboard/` → Vite serves on `localhost:5174` with a proxy to a remote OpenEMR. Set `VITE_OPENEMR_BASE_URL`, `VITE_OAUTH_CLIENT_ID`, `VITE_OAUTH_REDIRECT_URI` in `.env`. The React app drives the OAuth2 + PKCE flow (`/login` generates a verifier+challenge, redirects to `/oauth2/authorize`; `/callback` exchanges code for tokens). The credential is `{ mode: 'bearer', accessToken: ... }`; FHIR requests carry `Authorization: Bearer <token>`.

This path was the ONLY path during Phases 1–4 of the build. The architecture revision in §7 added the LocalApi path as the production default; the bearer path is now the secondary dev-loop optimization.

**OAuth2 client registration heads-up.** Tom Tarpey called this out in the W2-Migration meeting: *"majority of the time I've noticed across the board it breaks somewhere along the line."* Confirmed. The OpenEMR admin → Config / System → API Clients UI silently fails on submit on our deployment. Workaround: inspect the registration form's POST payload, fire it via `fetch()` from the browser console while authenticated as admin, capture `client_id` from the response. This is a known gap — *not* something we caused.

---

## Appendix B — 5-route comparison (verbatim from `MIGRATION-OPTIONS.md`)

Per Tom Tarpey's framework: score each route 1–5 against four dimensions (Budget, Timeline, Capability, Fidelity). Tiebreaker is the dimension we're most worried about under deadline pressure (Timeline).

| Route | Stack | Budget | Timeline | Capability | Fidelity | **Total** | Verdict |
|---|---|---|---|---|---|---|---|
| **A** | Next.js 15 App Router | 3 | 2 | 2 | 5 | **12** | Rejected — RSC + deadline = risk |
| **B** | SvelteKit | 2 | 1 | 1 | 4 | **8** | Rejected — learning curve too high |
| **C** | Remix / RR v7 | 3 | 2 | 3 | 4 | **12** | Rejected — loader infra overkill for one route |
| **D** | Vanilla TS + Lit | 2 | 1 | 2 | 3 | **8** | Rejected — reinvention under deadline |
| **E** | **React + Vite + TS** | **5** | **5** | **5** | **4** | **19** | **Selected** |

Per-route detail (Budget / Timeline / Capability / Fidelity, 1-5 each, why-passed):

- **Route A — Next.js 15 (App Router).** RSC offers server-side token holding (cleaner XSS posture); App Router's nested layouts handle multi-page apps gracefully. We passed because (a) the RSC mental model — "this file runs server, that file runs client, this is a Server Action" — is a real cognitive load mid-deadline; (b) the security gain is overkill for a graded demo against synthetic patients; (c) we'd be learning App Router concurrently with shipping the app.

- **Route B — SvelteKit (with Svelte 5 runes).** Smaller runtime bundle (~4KB vs ~50KB React). Single-file components with built-in scoped CSS. We passed because we have no Svelte production experience; runes (`$state`, `$derived`, `$effect`) are different enough from React that "translate while shipping" was real cost the deadline couldn't absorb.

- **Route C — Remix / React Router v7.** Nested route-based data loading (pre-render fetches before render — no useEffect-fetch waterfall). We passed because the nested-loader feature shines for multi-step flows; we have one route. The infra is overkill.

- **Route D — Vanilla TypeScript + Lit Web Components.** Smallest bundle of any framework option (~5KB Lit runtime). Framework-agnostic embedding into legacy OpenEMR pages (interesting for V2). We passed because we'd have to reinvent query caching, OAuth flow state machine, error/loading/empty primitive components, form validation under the deadline.

- **Route E — React + Vite + TypeScript + TanStack Query + Zod + Tailwind. Selected.** All tooling shipped. Adding 5 deps was a 5-minute task. Identical stack to the W1 Clinical Co-Pilot rail (in production today). The honest trade-off: no SSR, access token in browser memory (D1 invariant), bundle ~50KB gzipped. Mitigated by the embedded-architecture pivot; documented.

---

## Cross-references

- **PRD (the plan):** [`Documentation/AgentForge/implementation/PRD-patient-dashboard.md`](Documentation/AgentForge/implementation/PRD-patient-dashboard.md). §14 covers the architecture revision in detail; §15 codifies the design tokens.
- **Reverse-engineering output:** [`Documentation/AgentForge/implementation/dashboard-recon/`](Documentation/AgentForge/implementation/dashboard-recon/). manifest.md (entry-point map) + cards/ (12 per-card MDs) + PARITY-NOTES.md (parity catalog) + MIGRATION-OPTIONS.md (5-route comparison).
- **Process trail:** [`Documentation/AgentForge/process/milestones/week-2/06-w2-patient-dashboard-migration.md`](Documentation/AgentForge/process/milestones/week-2/06-w2-patient-dashboard-migration.md) (numbered milestone) + [`Documentation/AgentForge/process/journal/week-2/0509-T0004-w2-dashboard-embedded-pivot.md`](Documentation/AgentForge/process/journal/week-2/0509-T0004-w2-dashboard-embedded-pivot.md) (session journal for the architecture pivot).
- **Submission scoreboard row:** [`Documentation/AgentForge/submission.md`](Documentation/AgentForge/submission.md).
- **Code:** [`patient-dashboard/`](patient-dashboard/) (the React app) + [`interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php`](interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php) (the PHP loader) + [`interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php`](interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php) (the menu rewrite + Phase 7 CSS injection hooks) + [`interface/themes/agentforge-elevated.css`](interface/themes/agentforge-elevated.css) (the Phase 7 elevation stylesheet).
