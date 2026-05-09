---
title: Patient Dashboard Migration — PRD
brief: Documentation/AgentForge/references/AgentForge_Clinical-Co-Pilot_W2_Surprise-Challenge_Modernize-the-Patient-Dashboard.pdf
deadline: 2026-05-10 12:00 CT (Gauntlet AgentForge W2 final submission — same submission window as the W2 brief)
created: 2026-05-07
revised:
  - 2026-05-08 (post W2-Migration-Meeting; added Phase 0 reverse-engineering, Tier 0/1 system, Frankenstein/clinician-view invariants, OAuth2 client-reg gotcha, Labs to Tier 1)
  - 2026-05-09 ~00:30 CT (architecture pivot — Architecture 1 standalone-SPA → Architecture 2 embedded-module; see §14. This is now the live contract; §§6–7 describe the v1 plan, §14 supersedes them)
status: pivoted post-Phase-4; Phase 5 (deploy) replaced by integration into OpenEMR module + chart tab. See §14 for the new task list.
related:
  - W2_ARCHITECTURE.md (the W2 Clinical Co-Pilot architecture; this work is a separate frontend that consumes OpenEMR's REST/FHIR API)
  - PATIENT_DASHBOARD_MIGRATION.md (the defense doc — this PRD is the *plan*, that file will be the *justification* graded as part of the submission)
  - Documentation/AgentForge/submission.md (W2 brief scoreboard — this PRD's deliverables are listed there as a separate submission row)
  - Documentation/AgentForge/implementation/W2-Migration-Meeting-Transcript.md (instructor's reverse-first methodology source)
  - Documentation/AgentForge/implementation/dashboard-recon/ (Phase 0 output — created during build)
---

# Patient Dashboard Migration — PRD

> **Reading guide:**
> - **Part 1 (§§1–5)** is the requirements surface — why, scope, constraints, contract. Scan to know what we're building and what "done" means.
> - **Part 2 (§§6–7)** is the decisions — framework choice + architecture. Defends *what* we picked.
> - **Part 3 (§§8–12)** is the migration playbook — reverse-first methodology, phased task list, risks, defers, deadline. Defends *how* we'll build it.
> - **Part 4 (§13)** is cross-references.

---

# Part 1 — Requirements

## 1. Why this exists

The 2026-05-06 surprise-challenge brief ([PDF](../references/AgentForge_Clinical-Co-Pilot_W2_Surprise-Challenge_Modernize-the-Patient-Dashboard.pdf)) adds a parallel deliverable on top of the original W2 Clinical Co-Pilot brief: **port the OpenEMR Patient Dashboard to a modern framework, consuming the existing OpenEMR REST and FHIR APIs.** The brief is explicit that we are not touching the backend. The grade has three parts: a working app, feature parity for the listed cards, and a written defense (`PATIENT_DASHBOARD_MIGRATION.md`) of the framework choice and tradeoffs.

Two clarifications from the 2026-05-06 W2 migration Q&A (transcript: [W2-Migration-Meeting-Transcript.md](W2-Migration-Meeting-Transcript.md)) sharpen the brief:

1. **This is the *clinician's* view of a patient — not the patient portal.** The dashboard renders chart data for a logged-in clinician viewing a patient. Auth context is a clinician session; the SMART-on-FHIR `patient` claim selects which chart to render.
2. **Coexistence is required, not bypassable.** Direct quote: *"Bit of a Frankenstein… the V3 stuff still needs to be available… but this page itself should be completely migrated over."* The migrated page must be 100% the new framework with **zero PHP frontend included**, while the rest of OpenEMR (calendar, encounter forms, top navigation, etc.) keeps working in PHP. Users navigate from the new dashboard back into legacy surfaces.

This PRD is the *plan*. The defense doc (`PATIENT_DASHBOARD_MIGRATION.md`) will be written *after* the build, when the actual tradeoffs we hit are still fresh.

## 2. Scope and tier system

The brief lists **five required clinical cards + one extra of your choice**. We honor that as Tier 0 (the must-ship parity surface) and add a Tier 1 of additional read-only cards that share infrastructure with Tier 0 — adding them is cheap because the FHIR client, Zod schemas, query cache, and `<ClinicalCard>` shell are already in place from Tier 0.

| Tier | Surfaces | Rationale |
|---|---|---|
| **0 — must ship** | Patient Header, Allergies, Problem List, Medications, Prescriptions, Care Team, **Vitals** (the brief's "one extra") | Brief requirement. Cannot be cut. |
| **1 — stretch** | Demographics, Health Concerns, Immunizations, Appointments, Labs | All FHIR-backed; reuse Tier-0 infrastructure (FHIR client, Zod schemas, `<ClinicalCard>` shell). Adds depth at low marginal cost if Tier 0 is on track by Saturday lunch. |
| **Phase 7 — visual elevation** | Top navigation strip, patient header bar, encounter forms, calendar (existing PHP surfaces) | Scoped CSS overrides only — no React rewrite. Visual cohesion across the demo without rewriting. ≤2h hard cap. |

**Out of scope** (kept in legacy PHP — protects Tier 0+1):

- **Edit/save round-trips on any card.** The dashboard is read-only; clicking the pencil icon on a card opens the existing PHP edit screen in a new tab.
- **Cards without FHIR endpoints:** Disclosures, Amendments, Patient Reminders, Recall, Treatment Intervention Preferences, Care Experience Preferences, Patient Portal/API Access, Clinical Reminders, Messages, parts of Billing. Porting these would require adding REST endpoints to OpenEMR PHP, which violates the brief's *"you are not touching the backend."*
- **Top navigation bar re-implemented in React.** Cohesion comes from CSS elevation in Phase 7, not rewrite.
- **Encounter forms (visit summary, vitals entry, clinical notes) re-implemented in React.** The encounter form engine under `interface/forms/` is a multi-day port; CSS elevation in Phase 7 makes it visually cohesive without rewriting.

## 3. Anti-success criteria (what we will NOT do)

Mirroring the discipline from the W1 PRD:

- **No backend changes.** Zero edits to OpenEMR PHP, FHIR controllers, OAuth2 server, or DB schema. If a card is hard to render because of a backend gap, we live with the gap and document it in the defense doc.
- **No UX redesign for its own sake.** The brief says *"the UX decision is yours; own both."* We **deliberately chose** to honor the OpenEMR May 2025 modernization — single continuous scroll, self-contained cards, demographics at top — see the [CapMinds writeup](https://www.capminds.com/blog/7-ui-ux-enhancements-in-openemr-that-elevate-healthcare-delivery/) for the visual target. This is a deliberate UX decision, not a constraint we're working around. The defense doc names it as such.
- **No feature creep beyond the tier system.** Tier 0 + Tier 1 + Phase 7 is the contract. No edit views. No non-FHIR cards. No React rewrite of top nav or encounters.
- **No real-PHI deployment posture decisions in this dashboard.** The dashboard runs against the same demo OpenEMR instance the W2 build runs against. Compliance posture (BAA, retention, audit) is inherited from the host OpenEMR; we do not claim it.
- **No SSR or backend-for-frontend.** Plain SPA. Tradeoffs documented in the defense.
- **No state-management library** (Redux, Zustand, etc.). TanStack Query owns server cache; React state owns local UI. Adding a global store would be aspirational complexity.
- **No skipping the reverse-engineering phase.** Per the instructor's framework: *"read before you write."* Phase 0 is non-negotiable, not optional time.

## 4. Stop-the-line invariants

If any of these regresses during the build, stop and fix before continuing:

| # | Invariant | Why |
|---|---|---|
| D1 | OAuth2 access token is in memory only — never `localStorage`, never `sessionStorage`, never URL-bearing | XSS exfiltration mitigation; matches SMART-on-FHIR posture. Refresh-on-reload is acceptable. |
| D2 | No PHI in any client-side log, console.log, or thrown error message | Same posture as the W2 CUI |
| D3 | The active patient's UUID is a typed value passed through props — never read from `window.location` mid-component, never re-resolved per card | Active-chart binding discipline carries over from W1 |
| D4 | All FHIR responses pass through a Zod-parsed boundary before rendering | "Parse, don't validate" — same discipline as the W2 extraction schemas |
| D5 | The app builds with `tsc --noEmit` clean — `vite dev` (esbuild) is *not* the type gate | Per project memory: "npm run dev is tsx (transpile-only); type errors stay latent until prod tsc runs them" |
| D6 | The migrated dashboard page contains **zero PHP frontend** — no Twig partial, no `interface/*.php` include, no Smarty render. The rest of OpenEMR (calendar, encounter forms, top nav) remains PHP. | Frankenstein coexistence per Byron's clarification — the migrated page must stand alone in the new framework |
| D7 | The dashboard renders only for the **clinician's view of a patient chart**, not the patient portal | Per Byron's clarification of the brief; affects auth context (clinician session, not patient session) |

## 5. Acceptance criteria (what "shipped" means)

**Tier 0 — required for submission:**

- [ ] Visiting `/dashboard/` redirects to OpenEMR's OAuth2 login if not authenticated
- [ ] After login, the user sees `/patient/:id` for the SMART-on-FHIR launch patient (clinician context, not patient portal)
- [ ] Patient header renders **name, DOB, sex, MRN, active status** — exactly the brief's required fields
- [ ] All 5 required cards render with live FHIR data: Allergies, Problem List, Medications, Prescriptions, Care Team
- [ ] Vitals card renders the **single most-recent encounter** as key/value rows (BP / Height / Weight / Temperature / Pulse / Respiration / BMI / Oxygen Saturation), with a "Most recent vitals from: <date>" header. (Resolved 2026-05-08 by PD-00 visual capture — legacy doesn't show 10 readings; matches single-encounter parity. History view deferred to V2.)
- [ ] Empty states are explicit ("No active allergies on file") — never blank
- [ ] Error states are explicit and actionable (typed code + correlation id pattern from W1; we don't display raw fetch errors)
- [ ] Loading states show skeleton placeholders, not blank space
- [ ] Token expiry triggers a single refresh attempt; second 401 redirects to login
- [ ] **D6 holds**: page source contains no `<?php`, no Smarty/Twig render, no `interface/*.php` includes
- [ ] **D7 holds**: clinician auth context, not patient portal
- [ ] `tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] At least one Vitest scenario per FHIR card (mocked fetch → asserted render shape)
- [ ] [`PATIENT_DASHBOARD_MIGRATION.md`](../../../PATIENT_DASHBOARD_MIGRATION.md) at repo root with the framework defense (10 sections per PD-60)
- [ ] Deployed to the VPS at `/dashboard/` (or a subdomain) — reachable from cellular
- [ ] Submission scoreboard updated; demo video re-cut includes a 30s dashboard segment

**Tier 1 — adds depth if reached:**

- [ ] Demographics, Health Concerns, Immunizations, Appointments, Labs cards render with live FHIR data
- [ ] Each Tier-1 card has the same loading/error/empty discipline as Tier 0

**Phase 7 — visual cohesion (≤2h cap):**

- [ ] Top navigation strip uses Tailwind tokens via scoped CSS
- [ ] Patient header bar in legacy chart uses Tailwind tokens
- [ ] Encounter forms visually unified to the new dashboard's design language
- [ ] Calendar tab visually unified
- [ ] All visual changes are CSS-only, scoped, easy to revert

---

# Part 2 — Decisions

## 6. Framework choice: React + Vite + TypeScript + Tailwind

### Decision

**React 18 + Vite 5 + TypeScript 5 + TanStack Query v5 + Zod v3 + Tailwind CSS v3.** Rendered as an SPA. Hosted as a sibling container to `agentforge/cui` on the same VPS, served at `/dashboard/` via the Caddy / nginx in front of OpenEMR.

**Why Tailwind specifically:** the brief grades the dashboard on feature parity *and* the framework defense, but the demo video also functions as the visible artifact reviewers see first. Tailwind lets us hit a polished, modern visual standard without inventing a CSS architecture under deadline pressure — utility classes + `tailwind.config.js` for our small palette, no `.css` file proliferation, no BEM bikeshedding. Pairs well with React's component shape: each `<ClinicalCard>`, `<PatientHeader>`, etc. owns its own utility-class layout in JSX. The CUI's existing 51K-line `index.css` is a reminder of what hand-rolled CSS at scale looks like; Tailwind is the mitigation, not a regression. **Tailwind also serves Phase 7** — the same design tokens (colors, spacing, typography) drive the scoped CSS overrides on legacy PHP chrome, so the new dashboard and the elevated legacy surfaces speak the same visual language. Add `@tailwindcss/forms` for the auth round-trip's input fields, and skip the rest of the plugin ecosystem to keep the bundle tight.

### Why React + Vite (the defense narrative)

The grade rubric explicitly asks for a written justification of the framework decision. Our story:

> *"We chose React + Vite + TypeScript because we already proved this stack ships clinically-shaped UI under deadline pressure — the Clinical Co-Pilot rail (`agentforge/cui`) shipped in W1 on this same stack and is in production today. Re-using a stack we have type-safety, build, and test confidence in is the lower-risk path to a working dashboard with a graded defense behind it. Picking a framework we haven't shipped on (Next.js App Router, SvelteKit, Remix, SolidStart) for the sake of novelty would have cost us implementation time we needed for the FHIR mapping + OAuth2 flow, which are the actually-hard parts of this challenge."*

The honest tradeoffs we accept (and document in the defense):

1. **No server-side token holding.** Next.js App Router with RSC lets the OAuth2 access token stay server-side; an SPA puts it in browser memory. We mitigate via memory-only storage (D1 above) and accept refresh-on-reload as the cost. Server-side holding would be marginally better against XSS exfiltration but is overkill for a graded demo against synthetic patients.
2. **No SSR.** Cards mount and fetch on the client. First paint shows skeletons; data lands ~200–500ms later. Acceptable for a clinician-facing app where the user is already authenticated and on a stable network. Documented as "we picked client-side rendering because the time-to-interactive cost was outweighed by the cognitive load of the RSC server-vs-client split under our deadline."
3. **No App Router-style file-based routing.** We have one route — `/patient/:id`. A flat React component tree wins.
4. **Bundle size.** React + TanStack Query + Zod ships ~50KB gzipped runtime. Larger than Svelte/Solid but acceptable; we are not optimizing for first-contentful-paint on cellular.

### Why React, more concretely

- **Same TypeScript config as `agentforge/cui`.** We can copy `tsconfig.json` and the Vitest setup verbatim. No new tooling to learn.
- **Same testing posture.** Vitest + React Testing Library; we already have `useFileValidation.test.ts`, `useHandshake.test.ts`, etc. patterns to reuse.
- **Same lint/format.** ESLint + Prettier setup carries over.
- **No Next.js cognitive load.** App Router's "this file runs on the server, that file runs on the client, this file is a Server Action" overhead is real. SPA is one mental model.
- **TanStack Query is the right shape for FHIR.** Every clinical card is a `useQuery` against a FHIR endpoint with `patient={id}` as the key. Refetch on focus, stale-while-revalidate, retry-with-backoff are all built-in.

### Considered and rejected

| Framework | Why we passed |
|---|---|
| Next.js 15 (App Router) | Server-side token holding is nice but the RSC mental model + deadline = high risk. Rejected. |
| SvelteKit | Smaller bundle, faster runtime, but we'd be learning the framework concurrently with shipping the app. Rejected. |
| Remix | Similar to Next, smaller community now post–React Router merge. Rejected. |
| Vanilla TS / no framework | Possible but the FHIR card pattern + auth flow needs *some* framework. Reinventing useEffect / useState manually is not the kind of "modern framework" the brief is asking for. Rejected. |
| SolidStart / Qwik | Interesting but unproven in our hands. Rejected. |

> **Note:** the defense doc (`PATIENT_DASHBOARD_MIGRATION.md`) re-derives this choice with the Phase 0 reverse-engineering bug catalog in hand, per the instructor's methodology. The 5-route comparison goes into Appendix B of the defense.

## 7. Architecture

> ⚠️ **Superseded as of 2026-05-09.** This section describes the original Architecture 1 (standalone SPA at `/dashboard/` with its own OAuth2 flow). The implementation pivoted to Architecture 2 (embedded module inside OpenEMR's chart shell) — see [§14 Architecture revision](#14-architecture-revision). Section preserved for defense-doc narrative — "what we considered, what we changed, why."

### High-level shape

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Routes                                                │ │
│  │  /          → Login (redirects to OpenEMR /oauth2/...) │ │
│  │  /callback  → OAuth2 redirect handler                  │ │
│  │  /patient/:id → PatientDashboardPage                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  PatientDashboardPage                                  │ │
│  │  ├── PatientHeader      (name, DOB, sex, MRN, active)  │ │
│  │  │── TIER 0:                                           │ │
│  │  ├── AllergiesCard                                     │ │
│  │  ├── ProblemListCard                                   │ │
│  │  ├── MedicationsCard                                   │ │
│  │  ├── PrescriptionsCard                                 │ │
│  │  ├── CareTeamCard                                      │ │
│  │  ├── VitalsCard                                        │ │
│  │  │── TIER 1 (stretch):                                 │ │
│  │  ├── DemographicsCard                                  │ │
│  │  ├── HealthConcernsCard                                │ │
│  │  ├── ImmunizationsCard                                 │ │
│  │  ├── AppointmentsCard                                  │ │
│  │  └── LabsCard                                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  TanStack Query cache → Zod-parsed FHIR resources      │ │
│  │  Auth: AuthProvider + access-token-in-memory           │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────────────────┘
                   │  Authorization: Bearer <access_token>
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  OpenEMR (existing — NOT MODIFIED)                          │
│  /oauth2/authorize        OAuth2 + OpenID Connect           │
│  /oauth2/token            Token endpoint                    │
│  /apis/default/fhir/*     FHIR R4 endpoints                 │
└─────────────────────────────────────────────────────────────┘
```

### Repo location

`patient-dashboard/` at the repo root, sibling to `agentforge/`. **Not** under `agentforge/` because it consumes the OpenEMR FHIR API directly, not the AgentForge API. Mirroring the existing structure:

```
patient-dashboard/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── auth/
│   │   ├── AuthProvider.tsx       # holds access token in memory; refresh logic
│   │   ├── pkce.ts                # PKCE code-challenge / verifier helpers
│   │   ├── callback.tsx           # /callback route handler
│   │   └── login.tsx              # /login route — redirects to OpenEMR
│   ├── fhir/
│   │   ├── client.ts              # fetch wrapper + Bearer token injection
│   │   ├── schemas.ts             # Zod schemas for each FHIR resource we use
│   │   └── hooks.ts               # useAllergies, useProblems, useMedications, etc.
│   ├── patient/
│   │   ├── PatientDashboardPage.tsx
│   │   └── PatientHeader.tsx
│   ├── cards/
│   │   ├── ClinicalCard.tsx       # shared shell — title, loading, error, empty, content
│   │   ├── AllergiesCard.tsx      # Tier 0
│   │   ├── ProblemListCard.tsx    # Tier 0
│   │   ├── MedicationsCard.tsx    # Tier 0
│   │   ├── PrescriptionsCard.tsx  # Tier 0
│   │   ├── CareTeamCard.tsx       # Tier 0
│   │   ├── VitalsCard.tsx         # Tier 0
│   │   ├── DemographicsCard.tsx   # Tier 1
│   │   ├── HealthConcernsCard.tsx # Tier 1
│   │   ├── ImmunizationsCard.tsx  # Tier 1
│   │   ├── AppointmentsCard.tsx   # Tier 1
│   │   └── LabsCard.tsx           # Tier 1
│   ├── components/
│   │   ├── LoadingSkeleton.tsx
│   │   ├── ErrorState.tsx
│   │   └── EmptyState.tsx
│   └── styles/
│       └── globals.css
├── test/
│   └── ...                        # Vitest, mirroring src/
└── README.md
```

### OAuth2 flow (Authorization Code + PKCE)

1. User opens `/dashboard/` (or root) → React mounts `<Login />`
2. `<Login />` generates a PKCE code verifier (random 43-128 char string) and code challenge (SHA-256 of verifier, base64url-encoded). Stores verifier in **memory** for the redirect cycle (NOT `sessionStorage` — we accept the user has to re-auth on hard reload, see D1).
3. Redirects to `https://<openemr>/oauth2/authorize?response_type=code&client_id=<id>&redirect_uri=<spa-callback>&scope=openid%20fhirUser%20launch/patient&code_challenge=<challenge>&code_challenge_method=S256&state=<csrf>`
4. OpenEMR shows its login UI; user authenticates; OpenEMR redirects to `/dashboard/callback?code=<code>&state=<csrf>`
5. `<Callback />` exchanges code + verifier for tokens via POST to `https://<openemr>/oauth2/token`
6. Receives `{ access_token, id_token, refresh_token, token_type, expires_in }`. Stores `access_token` and `id_token` in `AuthProvider`'s React state (memory only). Discards the verifier.
7. `id_token` is parsed (no JWT signature verification client-side — the backend has already validated it; we trust the token transport since we're on the same origin family) for the `patient` claim (SMART-on-FHIR launch context) or the user's `sub`.
8. `<App />` reads the patient context, renders `<PatientDashboardPage patientId={id} />`.
9. Every FHIR fetch attaches `Authorization: Bearer <access_token>`. On 401, attempt refresh using `refresh_token` (one retry); on second 401, redirect to `/login`.

**Client registration heads-up (from instructor):** OpenEMR's client-registration UI sometimes silently fails on submit. Documented workaround in §10 R1 and PD-16 — inspect the registration form, fire the registration via `fetch()` from the browser console while authenticated as admin, capture the `client_id` from the response.

### FHIR endpoint mapping

OpenEMR's FHIR R4 base is `/apis/default/fhir`. Verified in [`src/RestControllers/FHIR`](../../../src/RestControllers/FHIR/) — all required resources are implemented.

| Tier | Card | FHIR endpoint | Notes |
|---|---|---|---|
| 0 | Patient header | `GET /Patient/:id` | `name[0]`, `birthDate`, `gender`, `identifier` (MRN where `system` matches OpenEMR's MRN system), `active` |
| 0 | Allergies | `GET /AllergyIntolerance?patient=:id` | Render `code.text`, `clinicalStatus.coding[0].code`, `criticality`, `reaction[].manifestation[].text` |
| 0 | Problem List | `GET /Condition?patient=:id&category=problem-list-item` | `code.text`, `clinicalStatus`, `onsetDateTime`, `recordedDate` |
| 0 | Medications | `GET /MedicationRequest?patient=:id&intent=order&status=active` | active only |
| 0 | Prescriptions | `GET /MedicationRequest?patient=:id&intent=order` | active + completed; sort `authoredOn` desc; max 10 |
| 0 | Care Team | `GET /CareTeam?patient=:id` | `participant[].member.display` + role; sparse data expected; handle empty state |
| 0 | Vitals | `GET /Observation?patient=:id&category=vital-signs&_sort=-date&_count=10` | latest 10 readings; render BP / HR / temp / weight / height as a small table |
| 1 | Demographics | reuse `Patient` resource from header | near-free; renders the fuller demographic field set (address, phone, email, language, race, ethnicity, etc.) without a second fetch |
| 1 | Health Concerns | `GET /Condition?patient=:id&category=health-concern` | same shape as Problem List, different category filter |
| 1 | Immunizations | `GET /Immunization?patient=:id&_sort=-date` | `vaccineCode.text`, `occurrenceDateTime`, `status` |
| 1 | Appointments | `GET /Appointment?patient=:id&_sort=-date&_count=10` | `start`, `status`, `serviceType.text`, `participant[].actor.display` |
| 1 | Labs | `GET /Observation?patient=:id&category=laboratory&_sort=-date&_count=20` | LOINC `code.text`, `valueQuantity`, `referenceRange`, flag if outside reference |

### State / cache shape

- One `QueryClient` (TanStack Query) per app. Default `staleTime: 30s`, `cacheTime: 5min`. FHIR resources don't change rapidly during a single chart view.
- Query keys: `['fhir', 'AllergyIntolerance', { patient: id }]` etc. Easy to invalidate per-resource on a future "refresh" affordance.
- No global Zustand/Redux. `<AuthProvider>` is the only React Context.

---

# Part 3 — Migration playbook

## 8. Migration methodology — reverse-first

Adapted from Tom Tarpey's *"Reverse-First Auditing"* framework (W2-Migration meeting, 2026-05-06; slides at <https://vb6-legacy-slides.netlify.app>; reference repo at <https://github.com/decagondev/vb6-rework-reverse-forward>). Tom's framework targets full-app legacy rewrites (VB6 → modern stack); we adapt it to **targeted modernization within OpenEMR's existing PHP stack**. The "reverse engineering" half translates directly. The "forward engineering" half is reframed: we're not picking a new stack, we're modernizing UI patterns within constraints we already accepted (React + Vite per §6).

### Core principle: read before you write

Per the instructor: *"if you don't understand it, how's the AI going to understand it?"* and *"the actual code is almost irrelevant once you can abstract it… you got your business logic, your data logic, and your UI/UX. Once you've got those three things, you've got the application."*

Phase 0 produces a behavioral contract for each card before any React code is written. The contract is the parity surface — we can't claim feature parity without it. The legacy code (`interface/patient_file/summary/demographics.php`, the Twig card templates under `templates/patient/card/`, the PHP card classes under `src/Patient/Cards/`, the service classes under `src/Services/`) is **read-only during Phase 0** — we treat the existing OpenEMR source as a frozen artifact and produce documentation against it.

### Reverse-engineering output structure

Phase 0 produces these artifacts under `Documentation/AgentForge/implementation/dashboard-recon/`, mirroring the structure used in the instructor's reference repo:

```
dashboard-recon/
├── manifest.md                  # demographics.php as the entry-point manifest:
│                                # what cards exist, where each is dispatched,
│                                # the ACL gates, the hide-card globals
├── cards/                       # one MD per card (12 total)
│   ├── PATIENT-HEADER.md
│   ├── ALLERGIES-CARD.md
│   ├── PROBLEM-LIST-CARD.md
│   ├── MEDICATIONS-CARD.md
│   ├── PRESCRIPTIONS-CARD.md
│   ├── CARE-TEAM-CARD.md
│   ├── VITALS-CARD.md
│   ├── DEMOGRAPHICS-CARD.md     # Tier 1
│   ├── HEALTH-CONCERNS-CARD.md  # Tier 1
│   ├── IMMUNIZATIONS-CARD.md    # Tier 1
│   ├── APPOINTMENTS-CARD.md     # Tier 1
│   └── LABS-CARD.md             # Tier 1
├── PARITY-NOTES.md              # quirks: what we will and won't carry over,
│                                # each with a one-sentence rationale
└── MIGRATION-OPTIONS.md         # 5-route comparison → feeds defense doc Appendix B
```

### Per-card MD template

Each `cards/<NAME>-CARD.md` captures:

1. **Source mapping** — file paths in the PHP codebase: dispatcher (`demographics.php` line range), Twig template (`templates/patient/card/<name>.html.twig`), PHP card class (`src/Patient/Cards/<Name>ViewCard.php`), backing service (`src/Services/<Name>Service.php`).
2. **Rendered fields** — exact field set the card displays in the legacy view.
3. **Permission checks** — which `AclMain::aclCheckIssue(...)` or `aclCheckCore(...)` calls gate the card.
4. **Hide-card global** — which value of `hide_dashboard_cards` (e.g., `card_allergies`) suppresses it.
5. **Edit/expand affordances** — what the pencil icon and `[]` expand chevron do; we link out to the legacy PHP for both.
6. **Empty state behavior** — what the legacy renders when there's no data.
7. **FHIR mapping** — the FHIR endpoint + the field-by-field mapping from FHIR shape to rendered text. **This is the parity contract.**
8. **Notable quirks** — edge cases, dead code, half-implemented behavior, things that surprise.

### `PARITY-NOTES.md` shape

Captures decisions of the form *"the legacy does X; we will / will not match it because Y."* Examples we already know we'll record:

- **Hide-card globals** (`hide_dashboard_cards`) — *out of V1*, in V2 if we shipped admin UI.
- **Card collapse/expand state persistence** — *out of V1*; cards are always rendered open.
- **Pencil-icon edit affordance** — *links out to legacy PHP edit screens, not in-app.*
- **ACL gating** — we trust OpenEMR's session-level ACL rather than re-checking per card; OAuth2 scopes provide the read gate.

### `MIGRATION-OPTIONS.md` shape

Re-derive the 5-route comparison **with the Phase 0 bug catalog and architecture analysis in hand** (per Tom's methodology — *"now we end up with a migration spec, we got different forms of routes, what stacks we could possibly use… informed choices with the good and the bad points to those, all the pros, the cons, what the ramifications and time frames"*). This becomes Appendix B of the defense doc. The 5 routes:

1. **Next.js 15 (App Router)** — RSC for server-side token holding
2. **SvelteKit** — smaller bundle, faster runtime
3. **Remix / React Router v7** — full-stack React with nested routing
4. **Vanilla TS + Lit / Web Components** — minimum framework footprint
5. **React + Vite + TypeScript** ← *our pick*

Score each against budget, timeline, team capability, parity fidelity. Document why we picked the route whose weaknesses we can accept.

### Why this discipline matters under deadline

Tom's framing: *"in a real-world AI-driven development state, this should be about an hour or two."* Phase 0 is **1.5 hours of Friday morning** with Claude Code as the spider/audit tool — not a multi-day overhead. The output makes the rest of the build mechanical: every Tier-0 card is *"render the fields in `cards/ALLERGIES-CARD.md` from the FHIR shape in `cards/ALLERGIES-CARD.md`."*

## 9. Phased task list

Tier rules: tier 0 = blocking (cannot be cut without violating §5 acceptance), tier 1 = polish/cuttable Saturday afternoon onward.

### Phase 0 — Reverse engineering (Friday 2026-05-08 morning, ~1.5 hours)

**Gate: Phase 1 does not start until Phase 0 outputs land in `dashboard-recon/`.**

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-00 | Manual recon — log into OpenEMR demo as clinician (Margaret Chen's chart), screenshot every card's loaded / empty / collapsed state. Note any user actions (pencil, expand chevron, click-through). 15 minutes. | 0 | Screenshots in `dashboard-recon/manifest.md` |
| PD-01 | Source map — read `interface/patient_file/summary/demographics.php` (2,088 LoC). Identify the cards, their dispatchers, ACL gates, Twig template paths, and `hide_dashboard_cards` global keys. Write `dashboard-recon/manifest.md` summarizing the entry point + the per-card dispatch map. | 0 | `manifest.md` lists every card with line refs |
| PD-02 | Per-card analysis — for each of the 12 cards we'll port (7 Tier 0 + 5 Tier 1), produce `dashboard-recon/cards/<NAME>-CARD.md` per the template in §8. Use Claude Code as the auditor with structured prompts ("Read `<file>:<line-range>` and produce a tree, not a critique"), not vague summaries. Tier-0 cards land before Phase 3 starts; Tier-1 cards land before any Tier-1 card task starts (can be deferred to Saturday morning). | 0 (Tier 0 cards), 1 (Tier 1 cards) | 7 Tier-0 MDs land before PD-30; 5 Tier-1 MDs land before PD-40 |
| PD-03 | `dashboard-recon/PARITY-NOTES.md` — list of quirks we will / won't carry over, each with a one-sentence rationale | 0 | File present; defense doc references it |
| PD-04 | `dashboard-recon/MIGRATION-OPTIONS.md` — 5-route comparison with Phase 0 findings in hand. This becomes Appendix B of the defense doc. | 0 | File present; ranks routes against budget / timeline / capability / fidelity |

### Phase 1 — Scaffold + auth (Friday morning, ~3 hours)

| ID | Task | Tier | Source ref | Done proof |
|---|---|---|---|---|
| PD-10 | `npm create vite@latest patient-dashboard -- --template react-ts` from repo root; copy `tsconfig.json` + ESLint + Vitest config patterns from `agentforge/cui/` | 0 | `agentforge/cui/tsconfig.json` | `cd patient-dashboard && npm run build` clean; `npx tsc --noEmit` clean |
| PD-11 | Add deps: `@tanstack/react-query`, `zod`, `react-router-dom`, `tailwindcss`, `postcss`, `autoprefixer`, `@tailwindcss/forms`. Run `npx tailwindcss init -p`. Configure `content: ['./index.html', './src/**/*.{ts,tsx}']`. Add `@tailwind` directives to `src/styles/globals.css`. | 0 | — | `package.json` updated; `tailwind.config.js` + `postcss.config.js` present; `<div className="text-blue-500">` smoke-test renders blue in dev |
| PD-12 | `<AuthProvider>` skeleton — React Context holding `accessToken`, `idToken`, `refreshToken` in `useState` (memory only, per D1). Helper hooks `useAccessToken()`, `useAuth()` | 0 | — | Vitest: AuthProvider renders children; `useAccessToken()` returns null until set |
| PD-13 | PKCE helpers in `auth/pkce.ts` — pure functions to generate verifier + challenge. Test the SHA-256 base64url encoding round-trip | 0 | — | Vitest: 3 scenarios green |
| PD-14 | `/login` route — generates PKCE pair, stores verifier in `AuthProvider`, redirects to OpenEMR's `/oauth2/authorize` with the right params | 0 | `oauth2/authorize.php` | Manual smoke against deployed OpenEMR; redirected to login UI |
| PD-15 | `/callback` route — reads `code` + `state` from query, validates state CSRF, POSTs to `/oauth2/token` with verifier, stores tokens in `AuthProvider`, navigates to `/patient/:id` (id from id_token claim or fallback redirect) | 0 | `oauth2/provider/` | Manual smoke: full login round-trip lands on `/patient/...` with a valid token in memory |
| PD-16 | OAuth2 client registration on the deployed OpenEMR — register `https://<vps>/dashboard/callback` as a redirect URI; obtain `client_id`. **If the admin UI silently fails on submit (per Tom's heads-up — see R1): inspect the registration form, copy the request shape, fire the registration via `fetch()` from the browser console while authenticated as admin. Capture `client_id` from the response.** Document the actual sequence used in `PATIENT_DASHBOARD_MIGRATION.md` Appendix A. | 0 | OpenEMR admin → Config / System → API Clients | `client_id` captured in `.env.example`; admin steps (or console workaround) screenshotted in journal |

### Phase 2 — FHIR client + shared card shell (Friday afternoon, ~2 hours)

| ID | Task | Tier | Source ref | Done proof |
|---|---|---|---|---|
| PD-20 | `fhir/client.ts` — typed `fhirGet<T>(path, params)` wrapper that injects `Authorization: Bearer <token>` and parses JSON. Handles 401 (redirect to login if 2nd consecutive). | 0 | — | Vitest: 401-then-success scenario; 401-then-401 redirects |
| PD-21 | `fhir/schemas.ts` — Zod schemas for `Patient`, `AllergyIntolerance`, `Condition`, `MedicationRequest`, `CareTeam`, `Observation`, plus the FHIR `Bundle` envelope shape. Schemas are intentionally narrow (only fields we render — not full R4 spec) | 0 | per-card MDs in `dashboard-recon/cards/` | Vitest: schema accepts canonical shape; rejects malformed |
| PD-22 | `fhir/hooks.ts` — `useFhirQuery<T>(resource, params, schema)` wrapper around `useQuery` with caching defaults | 0 | — | Vitest: hook fires fetch with auth header; returns parsed data |
| PD-23 | `<ClinicalCard>` shared shell — title, loading skeleton, empty state, error state, content slot. Tailwind utility classes inline; CSS variables for the few cross-card tokens. | 0 | — | Vitest (RTL): each state renders correctly |

### Phase 3 — Tier 0 cards + patient header (Friday evening + Saturday morning, ~5 hours)

| ID | Task | Tier | Source ref | Done proof |
|---|---|---|---|---|
| PD-30 | `<PatientHeader>` — name, DOB (formatted), sex, MRN (extracted from identifier with the OpenEMR MRN system), active status pill | 0 | `dashboard-recon/cards/PATIENT-HEADER.md`; legacy: `interface/patient_file/summary/dashboard_header.php` | Vitest (RTL): renders all 5 fields from a stub Patient resource |
| PD-31 | `<AllergiesCard>` — list rows with allergen, reaction, criticality. Empty state "No active allergies on file." | 0 | `cards/ALLERGIES-CARD.md`; legacy: `demographics.php:~1108` + `templates/patient/card/allergies.html.twig` | Vitest + manual smoke |
| PD-32 | `<ProblemListCard>` — list rows with condition text, onset date, status. Filter to clinicalStatus=active in render | 0 | `cards/PROBLEM-LIST-CARD.md`; legacy: `demographics.php:~1109` + `templates/patient/card/medical_problems.html.twig` | Vitest + manual smoke |
| PD-33 | `<MedicationsCard>` — active medications only (status=active). Render drug name + sig | 0 | `cards/MEDICATIONS-CARD.md`; legacy: `demographics.php:~1110` + `templates/patient/card/medication.html.twig` | Vitest + manual smoke |
| PD-34 | `<PrescriptionsCard>` — all MedicationRequests (active + completed), sorted by authoredOn desc, max 10 | 0 | `cards/PRESCRIPTIONS-CARD.md`; legacy: `demographics.php:~1111` + `templates/patient/card/rx.html.twig` (or `erx.html.twig` if eRx enabled) | Vitest + manual smoke |
| PD-35 | `<CareTeamCard>` — participant list with role + name. Empty state "No care team members assigned." | 0 | `cards/CARE-TEAM-CARD.md`; legacy: `src/Patient/Cards/CareTeamViewCard.php` | Vitest + manual smoke |
| PD-36 | `<VitalsCard>` — single most-recent encounter rendered as key/value rows (matches legacy parity). Fetch `Observation?category=vital-signs&_sort=-date&_count=50`, group client-side by `effectiveDateTime`, render the latest group. | 0 | `cards/VITALS-CARD.md` §8a; legacy: `interface/patient_file/summary/vitals_fragment.php` | Vitest + manual smoke |
| PD-37 | `<PatientDashboardPage>` — composes the header + 7 Tier-0 cards in a **single continuous-scroll layout** (matching the May 2025 modernization, not a 2-column grid). Mobile responsive. | 0 | `dashboard-recon/manifest.md` for layout reference | Manual smoke at desktop + mobile widths; layout matches legacy reading order |

### Phase 4 — Tier 1 cards (Saturday afternoon, ~3 hours, gated)

> **Gate:** Phase 4 starts only after PD-30..37 are green AND PD-50..53 (build, deploy, smoke) are passing. If we slip into Saturday afternoon still working on Tier 0, **Tier 1 cards are dropped, no exceptions.** The cut order in §12 enforces this.

| ID | Task | Tier | Source ref | Done proof |
|---|---|---|---|---|
| PD-40 | `<DemographicsCard>` — reuses `Patient` resource from header; renders the fuller demographic field set (address, phone, email, language, race, ethnicity) | 1 | `cards/DEMOGRAPHICS-CARD.md`; legacy: `demographics.php` (full demographics block) | Vitest + manual smoke |
| PD-41 | `<HealthConcernsCard>` — same shape as ProblemListCard with `category=health-concern` | 1 | `cards/HEALTH-CONCERNS-CARD.md`; legacy: `demographics.php` (Health Concerns block) | Vitest + manual smoke |
| PD-42 | `<ImmunizationsCard>` — list rows with vaccine, date, status | 1 | `cards/IMMUNIZATIONS-CARD.md`; legacy: `interface/patient_file/summary/immunizations.php` | Vitest + manual smoke |
| PD-43 | `<AppointmentsCard>` — list of upcoming + recent appointments | 1 | `cards/APPOINTMENTS-CARD.md`; legacy: `library/appointments.inc.php` + dashboard appointment block | Vitest + manual smoke |
| PD-44 | `<LabsCard>` — recent labs with LOINC text, value, reference range, abnormal flag. Render value-out-of-range visual cue (Tailwind warning color). | 1 | `cards/LABS-CARD.md`; legacy: `interface/patient_file/summary/labdata.php` + `labdata_fragment.php` | Vitest + manual smoke |
| PD-45 | Update `<PatientDashboardPage>` to compose Tier-1 cards in the continuous scroll | 1 | `dashboard-recon/manifest.md` | Manual smoke; Tier-1 cards don't crowd Tier-0 cards |

### Phase 5 — Polish + deploy (Saturday afternoon, ~3 hours)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-50 | Loading + error states across all cards verified in isolation by mocking the network at slow / failing | 1 | Vitest scenarios; manual smoke with throttled network |
| PD-51 | `npm run build` produces a `dist/` ready for static hosting | 0 | Build artifact present; bundle size < 250KB gzipped |
| PD-52 | Add `patient-dashboard` to the docker-compose stack as a sibling container running `nginx` to serve the `dist/`. Caddy routes `/dashboard/` to it | 0 | `docker compose up` from `docker/agentforge/`; reach `/dashboard/` returns the SPA index.html |
| PD-53 | Smoke against deployed OpenEMR: full login round-trip + every Tier-0 card renders for a cohort patient (Margaret Chen). If Tier 1 shipped, smoke those too. | 0 | Journal entry with screenshot of every card populated |
| PD-54 | Cellular smoke from a phone — Chrome on iOS / Android — full round-trip works on cellular | 0 | Phone screenshot in journal |
| PD-55 | **D6 audit** — view source on the deployed `/dashboard/` page; confirm zero PHP, zero Twig, zero Smarty render. Page is React + bundled JS only. | 0 | View-source screenshot in journal |
| PD-56 | **D7 audit** — confirm clinician auth context (logged in as a provider, not as a patient via portal). The `id_token`'s `sub` is a clinician user; the `patient` context comes from SMART launch. | 0 | id_token claims pasted into journal (with `sub` and `patient` highlighted) |

### Phase 6 — Defense doc (Saturday evening, ~1.5 hours)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-60 | Write `PATIENT_DASHBOARD_MIGRATION.md` at repo root. **Required sections:** (1) Why this migration — the brief in our words, (2) Reverse-engineering findings — synthesized from `dashboard-recon/`, (3) Parity catalog — what we kept, what we dropped, why (from `PARITY-NOTES.md`), (4) Migration routes evaluated — 5 alternatives + their tradeoffs (from `MIGRATION-OPTIONS.md`), (5) Selected route + defense — React + Vite + TypeScript + Tailwind, (6) What we gained moving away from PHP — TypeScript at the API boundary, component reuse, FHIR-first data layer, fast dev loop, (7) Tradeoffs that came with React+Vite — no SSR, token-in-memory, bundle size, refresh-on-reload, (8) UX decision rationale — why we honored the May 2025 modernization rather than overlay our own design, (9) Appendix A: OAuth2 client registration steps + console workaround, (10) Appendix B: 5-route comparison table. | 0 | File at repo root; cross-linked from README; all 10 sections present |
| PD-61 | README update — add a `## Patient Dashboard Migration` section linking the deployed URL, the defense doc, and a one-paragraph framing | 0 | README updated |

### Phase 7 — Visual elevation pass on demo surfaces (Saturday late evening, ≤2 hours, OPTIONAL)

> **Cap is hard.** This phase is bounded at 2 hours. If we hit the cap, we ship what's done and move on. **Anything not finished by the 2-hour mark is dropped, not deferred.** Phase 7 exists because the brief grades the demo video as visible evidence; pushing the visual bar on the surfaces graders watch is high-leverage IF the build is otherwise on track. If Saturday's self-injection rehearsal or any FB-A/B/C/D smoke surfaces a regression, Phase 7 is **the first thing cut.**

**Scoping principle:** additive Tailwind-token CSS only — no upstream OpenEMR PHP edits, no CUI rewrites, no global CSS resets. We're targeting elevation, not redesign. The W2 brief's already-shipped CUI keeps every existing test green; Tailwind tokens are layered alongside, not replacing.

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-70 | Visual pass on the **CUI rail** demo surfaces — patient-context header strip, IntakeProposalCard, lab ExtractionAcknowledgment, AgentStepStrip, EvalGate + PHI footer badges. Tailwind utility classes added inline; existing CSS classes preserved as fallbacks. **Must NOT regress any vitest scenario.** | 1 | CUI vitest still 83 passing; visual smoke screenshots before/after pasted into journal |
| PD-71 | Visual pass on the **OpenEMR top patient header bar** + the **top navigation strip** (Calendar / Finder / Flow / Recalls / Messages / Patient / Fees / Procedures / Reports / Misc / Popups) via a scoped CSS override file `interface/themes/agentforge-elevated.css` registered in `globals.php` only when the `agentforge` module is active. Tailwind preflight is NOT loaded into OpenEMR — we hand-write the overrides using Tailwind's design tokens (spacing scale, color palette, typography stack) for consistency with the new dashboard. Risk-bounded: changes are CSS-only, scoped, easy to revert. | 1 | Visual smoke before/after; W1 GACL flow still works; iframe still mounts |
| PD-72 | Visual pass on the **calendar tab** — same approach as PD-71. Bigger week-grid cells, clearer appointment chips, AgentForge cohort patients visually distinguished (subtle cohort-badge in the appointment chip). | 1 | Visual smoke before/after; calendar still loads; clicking an appointment still routes correctly |
| PD-73 | Visual pass on **encounter forms** (visit summary, vitals entry, clinical notes) — same scoped-CSS-overrides approach. Just typography + spacing + color polish, no DOM restructuring. **This is what makes the encounter screen feel like part of the new product in the demo, without a React rewrite.** | 1 | Visual smoke before/after; encounter forms still save correctly |

**Why this is Phase 7 and not interleaved earlier:** doing the polish pass after the dashboard's core is functional means we're polishing what graders actually see, not what we *thought* they'd see. Also — if the dashboard slips Saturday afternoon, Phase 7 is the natural shed-load. Putting it last keeps every earlier phase tier-0.

### Phase 8 — Submission integration (Sunday AM)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-80 | Add a row to `Documentation/AgentForge/submission.md` §1 deliverables for the dashboard, with deployed URL + GitLab path | 0 | Submission scoreboard updated |
| PD-81 | Demo video (FB-C-06) includes a 30-second segment showing the dashboard's OAuth2 login + Tier-0 cards rendering with FHIR data. If Tier 1 shipped, a 10-second extra cut showing the additional cards. | 0 | Video re-cut includes the segment |
| PD-82 | Final commit + push to GitLab `master` includes the `patient-dashboard/` directory + `Documentation/AgentForge/implementation/dashboard-recon/` + `PATIENT_DASHBOARD_MIGRATION.md` | 0 | `git log --stat` shows the commit |

## 10. Risks + mitigations

| # | Risk | Probability | Mitigation |
|---|---|---|---|
| R1 | OAuth2 client registration UI silently fails on submit (per Tom's heads-up: *"majority of the time I've noticed across the board it breaks somewhere along the line"*) | **High** | Skip the form. Inspect the registration request payload, fire it via `fetch()` from the browser console while authenticated as admin. Capture `client_id` from response. Document both the attempt and the working sequence in defense doc Appendix A. |
| R2 | OAuth2 docs are slightly deprecated (Tom: *"you'll have to poke around in the admin uh menu. Usually in config and system are your two main areas"*) | Medium | Treat docs as a starting point, not authoritative. Read the actual `oauth2/` PHP code for ground truth. |
| R3 | FHIR endpoint returns shapes that don't match Zod schemas (OpenEMR's R4 implementation is not 100% canonical) | Medium | Schemas are intentionally narrow (only fields we render). Iterate on the schema per card as we hit failures. **Loosen schema rather than throw away data**, but document each loosen in defense doc. |
| R4 | TanStack Query cache + token refresh interact in subtle ways (refetch fires while token is being refreshed → 401 cascade) | Medium | One refresh-in-flight guard in `AuthProvider`. Test explicitly. |
| R5 | Mobile responsive layout eats time we don't have | Low | CSS grid + media queries; copy patterns from `agentforge/cui` if possible. Worst case: dashboard is desktop-only on Sunday and we document that as known limitation. |
| R6 | Same-origin cookies / CSRF gotchas if dashboard is served at `/dashboard/` and OpenEMR at `/` | Medium | OAuth2 with PKCE is bearer-token flow, not cookie-bound. Should work. If not, host dashboard on a subdomain (`dashboard.<vps>`) to fully decouple. |
| R7 | Demo video length blows past 5 min once we add the 30s dashboard segment | High | Pre-cut the W2 brief portion to 4 min so the dashboard segment fits. Already a known risk per FB-C-06. |
| R8 | D6 violation — accidentally importing a PHP-rendered partial into the React page | Low | The dashboard is its own SPA at `/dashboard/`; there's no path for PHP includes to leak in. PD-55 audits view-source as a final check. |
| R9 | Phase 7 CSS overrides conflict with OpenEMR's existing theme | Medium | Scope every override under `body.agentforge-elevated` or similar; only loaded when the agentforge module is active. Easy revert: comment out the include in `globals.php`. |
| R10 | Tier 1 cards extend Friday evening into Saturday's Tier 0 work | High | Phase 4 is gated behind PD-30..37 green + cellular smoke. If Tier 0 isn't done by Saturday lunch, Tier 1 is dropped. The gate is enforced — no "just one more card" creep. |
| R11 | Phase 0 reverse-engineering takes longer than 1.5h budget | Medium | Hard cap at 2h. If we're not done by then, the Tier-0 card MDs we have are enough — Tier-1 card MDs can be written Saturday morning before Phase 4. |

## 11. What this PRD intentionally defers

To V2 of the dashboard (post-Sunday):

- Edit/save round-trips on any card (V1 is read-only — the brief grades parity for *display*, and clicking the pencil opens legacy PHP)
- Encounter history navigation (CSS elevation only via PD-73)
- Document viewer (PDFs, images)
- Cross-patient nav (patient picker)
- Hide-card admin globals (`hide_dashboard_cards`) — V1 always renders all cards in scope
- Card collapse/expand state persistence
- Real-PHI compliance posture
- Audit log of dashboard access
- i18n / a11y beyond ARIA basics
- Non-FHIR cards: Disclosures, Amendments, Patient Reminders, Recall, Treatment Intervention Preferences, Care Experience Preferences, Patient Portal/API Access, Clinical Reminders, Messages, full Billing — would require backend endpoint additions, violating the brief
- React rewrite of top navigation, calendar, encounter forms — CSS elevation in Phase 7 covers visual cohesion

## 12. Deadline reality check

**Today (Thursday 2026-05-07 evening):** VPS redeploy of W2 brief work + tonight's midnight submission. This PRD is the handoff to Friday morning.

**Friday 2026-05-08 morning:** Phase 0 (PD-00..04, ~1.5h) → Phase 1 (PD-10..16, ~3h). Auth round-trip working by Friday lunch is the "we're on track" signal.

**Friday afternoon + evening:** Phase 2 (PD-20..23) + start Phase 3 (PD-30..34).

**Saturday 2026-05-09 morning:** Finish Phase 3 (PD-35..37). Self-injection rehearsal in parallel (W2 brief track — non-negotiable, 1.5 hours).

**Saturday afternoon:** Phase 5 polish + deploy (PD-50..56) → Phase 4 Tier-1 cards if gated-pass (PD-40..45).

**Saturday evening:** Phase 6 (defense doc, PD-60..61) → Phase 7 (visual elevation pass, hard 2-hour cap, PD-70..73).

**Sunday 2026-05-10 AM:** Phase 8 submission integration (PD-80..82). Final submission at 12:00 PM CT.

### Cut order (top = first to drop)

1. **PD-73** (encounter form visual elevation — Phase 7)
2. **PD-72** (calendar visual elevation — Phase 7)
3. **PD-71** (top nav + patient header CSS overrides — Phase 7)
4. **PD-70** (CUI rail visual elevation — Phase 7)
5. **PD-44** (Labs card — Tier 1)
6. **PD-43** (Appointments card — Tier 1)
7. **PD-42** (Immunizations card — Tier 1)
8. **PD-41** (Health Concerns card — Tier 1)
9. **PD-40** (Demographics card — Tier 1)
10. **PD-50** (loading/error polish — leave default states)
11. **PD-54** (cellular smoke — desktop only)

**Never cut:** Phase 0 reverse-engineering (PD-00..04), auth round-trip (PD-12..16), the 5 required cards (PD-31..35), Vitals (PD-36), the patient header (PD-30), the defense doc (PD-60), the submission scoreboard row (PD-80), D6 + D7 audits (PD-55..56). Tailwind itself (PD-11) is also un-cuttable — without it, we'd default-fall-back to inline styles that would burn more time than the Tailwind setup costs.

---

# Part 4

## 13. Cross-references

- **Brief (definitive scope):** [Documentation/AgentForge/references/AgentForge_Clinical-Co-Pilot_W2_Surprise-Challenge_Modernize-the-Patient-Dashboard.pdf](../references/AgentForge_Clinical-Co-Pilot_W2_Surprise-Challenge_Modernize-the-Patient-Dashboard.pdf)
- **Methodology source (reverse-first auditing):** [W2-Migration-Meeting-Transcript.md](W2-Migration-Meeting-Transcript.md), instructor's slides at <https://vb6-legacy-slides.netlify.app>, reference repo at <https://github.com/decagondev/vb6-rework-reverse-forward>
- **UX inspiration (May 2025 modernization, single continuous scroll + self-contained cards):** <https://www.capminds.com/blog/7-ui-ux-enhancements-in-openemr-that-elevate-healthcare-delivery/>
- **W2 Clinical Co-Pilot brief:** [Documentation/AgentForge/references/Week-2_AgentForge-Clinical-Co-Pilot.pdf](../references/Week-2_AgentForge-Clinical-Co-Pilot.pdf)
- **W2 Architecture (the AgentForge agent — separate track from this dashboard):** [W2_ARCHITECTURE.md](../../../W2_ARCHITECTURE.md)
- **Submission scoreboard:** [Documentation/AgentForge/submission.md](../submission.md)
- **OpenEMR FHIR docs:** [FHIR_README.md](../../../FHIR_README.md)
- **OpenEMR OAuth2 server:** [oauth2/authorize.php](../../../oauth2/authorize.php)
- **OpenEMR Patient Dashboard entry point (the legacy code we're porting):** [interface/patient_file/summary/demographics.php](../../../interface/patient_file/summary/demographics.php)
- **Existing CUI stack (the React+Vite reference we copy from):** [agentforge/cui/](../../../agentforge/cui/)
- **Phase 0 output (created during build):** `Documentation/AgentForge/implementation/dashboard-recon/`

---

# Part 5 — Architecture revision (2026-05-09 ~00:30 CT)

## 14. Architecture revision — embedded module

### Why we pivoted

After Phase 4 shipped (11 cards rendering live FHIR data), end-to-end smoke against Sofia Reyes / Margaret Chen / Phil Belford / Raymond Cooper revealed a UX problem the standalone-SPA architecture (§7) created and could not fix without a redesign:

The standalone flow forced the user through **5 screens to reach the dashboard**: login → patient picker → consent → callback → dashboard. The legacy OpenEMR experience is **3 screens**: login → calendar → click a patient → chart with dashboard tab. The added screens come from SMART-on-FHIR's standalone-launch pattern (`launch/patient` scope), which is the textbook auth model for embedded third-party apps with no preexisting patient context — but it's the wrong model for a primary clinical UI replacing OpenEMR's own dashboard tab.

The standalone architecture also **dropped the W1 CUI rail and the OpenEMR shell** (calendar, top nav, encounter forms) from the demo path — visiting `/dashboard/` navigated *away* from OpenEMR's chart view. For a "modernize the patient dashboard" challenge, the demo needs to show the dashboard *inside* the rest of the EMR, not in a separate window.

The brief allows either model — *"Authentication — Login via OAuth2/OpenID Connect"* describes the auth mechanism the EMR uses (which OpenEMR provides via SMART), not a requirement that our React app implements its own OAuth client flow.

### v2 architecture (live)

```
┌─────────────────────────────────────────────────────────────┐
│  Browser — OpenEMR shell (PHP)                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Top nav (Calendar / Finder / Flow / Recalls / Misc)   │ │
│  │  Patient identity strip (Sofia Reyes (0031) ...)       │ │
│  │  Tab bar (Calendar | Message Center | Dashboard | ...) │ │
│  │                                                        │ │
│  │  ┌──────────────────────────────────────┐  ┌────────┐ │ │
│  │  │  Dashboard tab content               │  │ CUI    │ │ │
│  │  │  ┌────────────────────────────────┐  │  │ rail   │ │ │
│  │  │  │  Patient Dashboard (React)     │  │  │ (W1)   │ │ │
│  │  │  │  Mounts at chart-tab path      │  │  │ React  │ │ │
│  │  │  │  Reads patient from chart URL  │  │  │ panel  │ │ │
│  │  │  │  Same-origin fetch to FHIR     │  │  │        │ │ │
│  │  │  └────────────────────────────────┘  │  └────────┘ │ │
│  │  └──────────────────────────────────────┘              │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────────────────────┘
                   │  Same-origin requests share OpenEMR's
                   │  authenticated session.
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  OpenEMR (existing PHP — NOT MODIFIED)                      │
│  /interface/main/tabs/main.php   (chart shell)              │
│  /interface/patient_file/summary/demographics.php           │
│  /apis/default/fhir/*  (FHIR R4, session-bound or token)    │
│  /oauth2/*  (still used for SMART EHR launch if needed)     │
└─────────────────────────────────────────────────────────────┘
```

### Key changes from §7

| Concern | v1 (§7 standalone) | v2 (this section, embedded) |
|---|---|---|
| Where the React app lives | Separate URL `/dashboard/` behind Caddy | Inside the OpenEMR module: `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/` (same pattern as W1 CUI) |
| Auth model | App drives its own OAuth flow | Inherits OpenEMR session; FHIR uses SMART EHR launch with patient context from the chart URL — no patient picker, no consent on subsequent visits |
| Patient context | SMART standalone launch → user picks at OpenEMR's picker | Comes from chart URL (`?set_pid=N`) — already known when user lands on a chart tab |
| OpenEMR shell visibility | Replaced (user navigates away from `/`) | Preserved (user stays in `/interface/main/tabs/main.php`) |
| W1 CUI rail | Gone in demo path | Visible alongside the dashboard, automatically |
| Other tabs (Calendar, Visit History, Encounters) | Dropped from demo | Still accessible by clicking other tabs |
| Routing in React app | Multiple routes (`/`, `/login`, `/callback`, `/patient/:id`) | Single mount point — no router needed |
| Build target | Vite base `/dashboard/` → static files served by sibling nginx container | Vite base = module's public path → static files served by OpenEMR's existing Apache |
| Caddy route | New `handle_path /dashboard/*` block in Caddyfile | None — same hostname, OpenEMR Apache serves both PHP and the React static files |
| Deploy | Sibling Docker container | Files land in the agentforge module's `public/dashboard/` — included in any module deploy |

### What carries forward unchanged

- All 11 card components (`AllergiesCard`, `ProblemListCard`, …, `LabsCard`, `DemographicsCard`)
- All Zod schemas (`FhirPatientSchema`, `FhirAllergyIntoleranceSchema`, …)
- All 113 vitest tests across 18 files
- The reverse-engineering output in `dashboard-recon/`
- The PARITY-NOTES.md and per-card MDs
- The `<ClinicalCard>` shared shell + UCUM unit formatter

### What changes in code

| Change | File | Effort |
|---|---|---|
| Vite `base` swap | `patient-dashboard/vite.config.ts` | 5 min |
| Drop standalone routes | `patient-dashboard/src/App.tsx`, `src/main.tsx` | 15 min |
| Drop `auth/login.tsx` and `auth/callback.tsx`; keep `AuthProvider` for token holding (still used during SMART EHR launch) | — | 10 min |
| Patient context from URL `?set_pid=N` | `src/patient/PatientDashboardPage.tsx` | 10 min |
| FHIR client: Bearer token via SMART EHR launch when needed; otherwise same | `src/fhir/client.ts`, `src/fhir/hooks.ts` | 30 min |
| New PHP loader: `interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php` — verifies session, reads `set_pid`, renders React mount + injects `window.__PATIENT_ID__` | new file | 30 min |
| Hook into OpenEMR's chart tab system to load our React app for the Dashboard tab (event listener in the existing module dispatcher) | `interface/modules/custom_modules/oe-module-agentforge/openemr.bootstrap.php` (or wherever existing hooks live) | 45 min |
| Apply CUI design tokens (see §15) — repaint cards in CUI palette + Lato + 8 px radius | per-component | 60 min |
| Phase 7 visual elevation — login screen + top nav + calendar + encounter forms via scoped CSS using same tokens | `interface/themes/agentforge-elevated.css` | ≤2h cap |

### New phased task list (supersedes Phase 5+ of §9)

- **PD-90** Vite `base` swap → `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/` — Tier 0
- **PD-91** Strip `/login`, `/callback`, `/` routes; mount `<PatientDashboardPage />` at root — Tier 0
- **PD-92** Read `set_pid` from `window.location.search` (and fallback to `window.__PATIENT_ID__`) — Tier 0
- **PD-93** PHP loader (`dashboard.php` in module) renders React mount + session check + patient context injection — Tier 0
- **PD-94** Wire FHIR client to acquire access token via SMART EHR launch (silent — no user interaction since user is already in OpenEMR session) — Tier 0
- **PD-95** Hook the React mount into the chart's Dashboard tab via a SectionEvent listener (or override the demographics.php tab dispatcher in the module) — Tier 0
- **PD-96** Apply CUI design tokens to cards + header (see §15) — Tier 0
- **PD-97** Phase 7 visual elevation — login screen, top nav, calendar tab, encounter forms — same tokens — ≤2h cap, Tier 1
- **PD-98** Smoke: login → calendar → click patient → chart loads with React dashboard tab + CUI rail visible — Tier 0
- **PD-99** D6 audit (page sources contain no PHP-rendered card markup inside the dashboard panel) + D7 audit — Tier 0
- **PD-100** Defense doc updated with the architecture-revision narrative (this §14 transposed) — Tier 0

### What this means for the demo

The flow Jason originally pictured:
1. User logs into OpenEMR (one normal login, OpenEMR's own page — visually elevated by Phase 7 PD-97)
2. Calendar shows the day's patients
3. Click a patient → chart loads
4. Dashboard tab content **is the React dashboard** (not legacy PHP cards)
5. CUI rail visible alongside (W1 still works)
6. Click other tabs (Visit History, Encounters) → unchanged PHP, visually elevated by Phase 7
7. Phase 7 elevates everything visible: top nav, patient header strip, calendar, encounter forms, login screen

That's the EMR-modernization story we're telling: surgical migration of one panel of a working application to a modern stack, with the surrounding chrome elevated to match — *not* a separate app pretending to be the EMR.

---

## 15. Design tokens — derived from CUI, applied to dashboard + Phase 7

The CUI's `agentforge/cui/src/index.css` already establishes a token system that mirrors OpenEMR's Bootstrap 4.6 design language. The patient dashboard adopts the same tokens so the two React surfaces (CUI rail + dashboard) read as one product, and Phase 7 uses these tokens for the scoped CSS overrides on legacy PHP chrome so the entire experience speaks one language.

### Type

- **Font stack:** `"Lato", "Helvetica Neue", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"` — Lato matches OpenEMR's Bootstrap 4.6 `$font-family-sans-serif`, so the React parts and the PHP parts use the same primary face.
- **Type scale:** dashboard sits in a wider container than the CUI rail, so the type scale runs slightly larger:
  - Card title: `text-[15px] font-semibold tracking-tight text-[--af-text]` (was `text-sm` zinc)
  - Body row: `text-sm text-[--af-text]`
  - Meta line / subtitle: `text-xs text-[--af-text-muted]`
  - Patient header name: `text-xl font-semibold tracking-tight text-[--af-text]`
  - Patient header meta: `text-sm text-[--af-text-muted]`

### Color (CUI tokens, mapped to OpenEMR Bootstrap 4.6)

| Token | Value | Used by |
|---|---|---|
| `--af-primary` | `#007bff` | Accent, links, primary buttons |
| `--af-primary-50` | `#e7f1ff` | Subtle accent backgrounds |
| `--af-success` / `-50` | `#28a745` / `#e6f4ea` | Active pill, normal lab values |
| `--af-warning` / `-50` | `#ffc107` / `#fff8e1` | Moderate severity |
| `--af-danger` / `-50` | `#dc3545` / `#fdecea` | Severe/abnormal pills, errors |
| `--af-gray-100..900` | Bootstrap 4.6 grays | Borders, surfaces, text hierarchy |
| `--af-surface` / `--af-surface-alt` | `#fff` / gray-100 | Card body / page background |
| `--af-border` / `--af-border-strong` | gray-300 / gray-400 | Card borders, table rules |
| `--af-text` / `--af-text-muted` / `--af-text-subtle` | gray-900 / gray-600 / gray-700 | Body / meta / labels |

**Replace the current Tailwind palette references** (`zinc-*`, `rose-*`, `emerald-*`, `amber-*`) with the matching `--af-*` tokens via Tailwind's `theme.extend.colors` config. We keep Tailwind utility classes for layout/spacing; only the palette swaps.

### Spacing & shape

- **Card radius:** `--af-radius: 8px` (Tailwind `rounded-lg`) — matches CUI. Currently we use `rounded-2xl` (16 px); reduce to `rounded-lg` for consistency.
- **Control radius:** `6px` — CUI's button/input radius.
- **Spacing scale:** Tailwind 4-pt scale, but breathing room *inside* the dashboard's wider container is generous: card vertical padding `py-4`, horizontal `px-5`, gap between cards `space-y-4` (matches CUI rail's "tight type but generous spacing" principle, scaled for the wider canvas).

### Focus & accessibility (WCAG-AA target, exceeding where cheap)

- **Focus ring:** `outline-2 outline-offset-2 outline-[--af-primary]` on every interactive element — visible at 200%+ zoom and across light/dark contexts.
- **Hit targets:** ≥40 px for tappable elements (cards' edit affordance, status pills if interactive). Mobile-first.
- **Color contrast:** every body-text foreground/background pair is ≥4.5:1 (AA). Status pills' text-on-tint-50 backgrounds are ≥4.5:1 — verified by the CUI's existing palette which already targets this.
- **Empty / error / loading states** carry semantic copy (already done — see PARITY-NOTES.md §6 + ClinicalCard tests).
- **Skeleton loading**: `aria-hidden` (already done in `<ClinicalCard>`).
- **Headings**: every card uses `<h2>`; the patient header is `<h1>` (single per page). Skip-links and section landmarks added in PD-96.

### Phase 7 application

The Phase 7 elevation pass writes a single CSS file — `interface/themes/agentforge-elevated.css` — registered conditionally when the `agentforge` module is active. It applies the *same* `--af-*` tokens above to selectors targeting:

- The OpenEMR login screen (`interface/login/login.php` chrome)
- The top nav strip (Calendar / Finder / Flow / Recalls / Messages / Patient / …)
- The patient identity bar (`dashboard_header.php` render)
- The calendar tab (`interface/main/calendar/`)
- Encounter forms (`interface/forms/`)

No DOM restructuring. No global CSS resets. Tailwind preflight is NOT loaded into OpenEMR's chrome — we hand-write the overrides using the same color/spacing/typography vocabulary the React surfaces use.

The result: a unified clean-minimal aesthetic across React and PHP, anchored on OpenEMR's own Bootstrap 4.6 palette so it reads as a cohesive product, not a stitched-together one. WCAG-AA throughout, exceeding where cheap (focus rings, hit targets, contrast).
