---
title: Patient Dashboard Migration — PRD
brief: Documentation/AgentForge/references/AgentForge — Clinical Co-Pilot W2 — Surprise Challenge_ Modernize the Patient Dashboard.pdf
deadline: 2026-05-10 12:00 CT (Gauntlet AgentForge W2 final submission — same submission window as the W2 brief)
created: 2026-05-07
status: planning — execution starts Friday 2026-05-08 morning (after tonight's VPS redeploy of W2 brief work)
related:
  - W2_ARCHITECTURE.md (the W2 Clinical Co-Pilot architecture; this work is a separate frontend that consumes OpenEMR's REST/FHIR API)
  - PATIENT_DASHBOARD_MIGRATION.md (the defense doc — this PRD is the *plan*, that file will be the *justification* graded as part of the submission)
  - Documentation/AgentForge/submission.md (W2 brief scoreboard — this PRD's deliverables are listed there as a separate submission row)
---

# Patient Dashboard Migration — PRD

## 1. Why this exists

The 2026-05-06 surprise-challenge brief ([PDF](../references/AgentForge%20—%20Clinical%20Co-Pilot%20W2%20—%20Surprise%20Challenge_%20Modernize%20the%20Patient%20Dashboard.pdf)) adds a parallel deliverable on top of the original W2 Clinical Co-Pilot brief: **port the OpenEMR Patient Dashboard to a modern framework, consuming the existing OpenEMR REST and FHIR APIs.** The brief is explicit that we are not redesigning UX and not touching the backend — only moving the presentation layer. The grade has two parts: a working app, and a written defense (`PATIENT_DASHBOARD_MIGRATION.md`) of the framework choice and tradeoffs.

This PRD is the *plan*. The defense doc (`PATIENT_DASHBOARD_MIGRATION.md`) will be written *after* the build, when the actual tradeoffs we hit are still fresh.

## 2. Anti-success criteria (what we will NOT do)

Mirroring the discipline from the W1 PRD:

- **No backend changes.** Zero edits to OpenEMR PHP, FHIR controllers, OAuth2 server, or DB schema. If a card is hard to render because of a backend gap, we live with the gap and document it in the defense.
- **No UX redesign.** The existing OpenEMR May 2025 demographics design is the visual target. Layout / typography / ordering matches; we do not "improve" it.
- **No feature creep.** 5 required clinical cards + 1 chosen extra section + identity bar + auth. Nothing else. Care plans, growth charts, document viewer, billing, lab trends — all out of scope unless trivially backed by the FHIR card we already shipped.
- **No real-PHI deployment posture decisions in this dashboard.** The dashboard runs against the same demo OpenEMR instance the W2 build runs against. Compliance posture (BAA, retention, audit) is inherited from the host OpenEMR; we do not claim it.
- **No SSR or backend-for-frontend.** Plain SPA. Tradeoffs documented in the defense.
- **No state-management library** (Redux, Zustand, etc.). TanStack Query owns server cache; React state owns local UI. Adding a global store would be aspirational complexity.

## 3. Stop-the-line invariants

If any of these regresses during the build, stop and fix before continuing:

| # | Invariant | Why |
|---|---|---|
| D1 | OAuth2 access token is in memory only — never `localStorage`, never `sessionStorage`, never URL-bearing | XSS exfiltration mitigation; matches the SMART-on-FHIR posture. Refresh-on-reload is acceptable. |
| D2 | No PHI in any client-side log, console.log, or thrown error message | Same posture as the W2 CUI |
| D3 | The active patient's UUID is a typed value passed through props — never read from `window.location` mid-component, never re-resolved per card | Active-chart binding discipline carries over from W1 |
| D4 | All FHIR responses pass through a Zod-parsed boundary before rendering | "Parse, don't validate" — same discipline as the W2 extraction schemas |
| D5 | The app builds with `tsc --noEmit` clean — `vite dev` (esbuild) is *not* the type gate | Per project memory: "npm run dev is tsx (transpile-only); type errors stay latent until prod tsc runs them" |

## 4. Framework choice: React + Vite + TypeScript + Tailwind CSS

### Decision

**React 18 + Vite 5 + TypeScript 5 + TanStack Query v5 + Zod v3 + Tailwind CSS v3.** Rendered as an SPA. Hosted as a sibling container to `agentforge/cui` on the same VPS, served at `/dashboard/` via the Caddy / nginx in front of OpenEMR.

**Why Tailwind specifically:** the brief grades the dashboard on feature parity *and* the framework defense, but the demo video also functions as the visible artifact reviewers see first. Tailwind lets us hit a polished, modern visual standard without inventing a CSS architecture under deadline pressure — utility classes + `tailwind.config.js` for our small palette, no `.css` file proliferation, no BEM bikeshedding. Pairs well with React's component shape: each `<ClinicalCard>`, `<PatientHeader>`, etc. owns its own utility-class layout in JSX. The CUI's existing 51K-line `index.css` is a reminder of what hand-rolled CSS at scale looks like; Tailwind is the mitigation, not a regression. Add `@tailwindcss/forms` for the auth round-trip's input fields, and skip the rest of the plugin ecosystem to keep the bundle tight.

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
- **Same testing posture.** Vitest + React Testing Library; we already have a `useFileValidation.test.ts`, `useHandshake.test.ts`, etc. patterns to reuse.
- **Same lint/format.** ESLint + Prettier setup carries over.
- **No Next.js cognitive load.** App Router's "this file runs on the server, that file runs on the client, this file is a Server Action" overhead is real. SPA is one mental model.
- **TanStack Query is the right shape for FHIR.** Every clinical card is a `useQuery` against a FHIR endpoint with `patient={id}` as the key. Refetch on focus, stale-while-revalidate, retry-with-backoff are all built-in.
- **Tailwind for the visual layer.** Utility-class CSS keeps the design language consistent across cards without reaching for a component library (MUI, Chakra, etc.). Each `<ClinicalCard>` is a JSX shape with utility classes inline; no `.css` file per component. `tailwind.config.js` holds the ~6 colors, spacing scale, typography stack we'll use — that file IS the design system. Phase 7 (visual elevation) re-uses the same Tailwind tokens via scoped CSS overrides for the CUI rail and select OpenEMR chrome surfaces, so the dashboard, the rail, and the elevated host chrome all read as one product.

### Considered and rejected

| Framework | Why we passed |
|---|---|
| Next.js 15 (App Router) | Server-side token holding is nice but the RSC mental model + deadline = high risk. Rejected. |
| SvelteKit | Smaller bundle, faster runtime, but we'd be learning the framework concurrently with shipping the app. Rejected. |
| Remix | Similar to Next, smaller community now post–React Router merge. Rejected. |
| Vanilla TS / no framework | Possible but the FHIR card pattern + auth flow needs *some* framework. Reinventing useEffect / useState manually is not the kind of "modern framework" the brief is asking for. Rejected. |
| SolidStart / Qwik | Interesting but unproven in our hands. Rejected. |

## 5. Architecture

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
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  PatientDashboardPage                                  │ │
│  │  ├── PatientHeader      (name, DOB, sex, MRN, active)  │ │
│  │  ├── AllergiesCard      (FHIR AllergyIntolerance)      │ │
│  │  ├── ProblemListCard    (FHIR Condition)                │ │
│  │  ├── MedicationsCard    (FHIR MedicationRequest)        │ │
│  │  ├── PrescriptionsCard  (FHIR MedicationRequest filter) │ │
│  │  ├── CareTeamCard       (FHIR CareTeam)                 │ │
│  │  └── VitalsCard         (FHIR Observation, vital-signs) │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
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
│    /Patient/:id                                              │
│    /AllergyIntolerance?patient=:id                          │
│    /Condition?patient=:id                                    │
│    /MedicationRequest?patient=:id                            │
│    /CareTeam?patient=:id                                     │
│    /Observation?patient=:id&category=vital-signs             │
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
│   │   ├── PatientHeader.tsx
│   │   ├── PatientHeader.test.tsx
│   │   └── ...
│   ├── cards/
│   │   ├── ClinicalCard.tsx       # shared shell — title, loading, error, empty, content
│   │   ├── AllergiesCard.tsx
│   │   ├── ProblemListCard.tsx
│   │   ├── MedicationsCard.tsx
│   │   ├── PrescriptionsCard.tsx
│   │   ├── CareTeamCard.tsx
│   │   └── VitalsCard.tsx
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

**Client registration**: a one-time admin action against OpenEMR's OAuth2 server. We register a confidential client with the redirect URI of our deployed dashboard. Done via the OpenEMR admin UI (`https://<openemr>/portal/...` or `oauth2/registration.php` per repo).

### FHIR endpoint mapping

OpenEMR's FHIR R4 base is `/apis/default/fhir`. Verified in [`src/RestControllers/FHIR`](../../../src/RestControllers/FHIR/) — all required resources are implemented.

| Card | FHIR endpoint | Notes |
|---|---|---|
| Patient header | `GET /Patient/:id` | `name[0]`, `birthDate`, `gender`, `identifier` (MRN where `system` matches OpenEMR's MRN system), `active` |
| Allergies | `GET /AllergyIntolerance?patient=:id` | Render `code.text`, `clinicalStatus.coding[0].code`, `criticality`, `reaction[].manifestation[].text` |
| Problem List | `GET /Condition?patient=:id&category=problem-list-item` | `code.text`, `clinicalStatus`, `onsetDateTime`, `recordedDate` |
| Medications | `GET /MedicationRequest?patient=:id&intent=order&status=active` | `medicationCodeableConcept.text`, `dosageInstruction[0].text`, `dispenseRequest.numberOfRepeatsAllowed` |
| Prescriptions | `GET /MedicationRequest?patient=:id&intent=order` | Includes inactive — distinct from "active medications" above |
| Care Team | `GET /CareTeam?patient=:id` | `participant[].member.display` + role; expect sparse data, handle empty state |
| Vitals (extra) | `GET /Observation?patient=:id&category=vital-signs&_sort=-date&_count=10` | Latest 10 readings; render BP, HR, temp, weight, height as a small table |

### Why Vitals as the extra section

Vitals are the smallest field-mapping surface (5–6 numeric fields per reading), demo well visually (a clinician sees a row of recent BP readings), and `Observation?category=vital-signs` is a single endpoint. Encounter history would require navigating into encounter detail (more UI), labs would require LOINC code interpretation, immunizations are sparse on demo data. Vitals win on time-to-ship.

### State / cache shape

- One `QueryClient` (TanStack Query) per app. Default `staleTime: 30s`, `cacheTime: 5min`. FHIR resources don't change rapidly during a single chart view.
- Query keys: `['fhir', 'AllergyIntolerance', { patient: id }]` etc. Easy to invalidate per-resource on a future "refresh" affordance.
- No global Zustand/Redux. `<AuthProvider>` is the only React Context.

## 6. Acceptance criteria (what "shipped" means)

- [ ] Visiting `/dashboard/` redirects to OpenEMR's OAuth2 login if not authenticated
- [ ] After login, the user sees `/patient/:id` for the SMART-on-FHIR launch patient
- [ ] Patient header renders **name, DOB, sex, MRN, active status** — exactly the brief's required fields
- [ ] All 5 required cards render with live FHIR data: Allergies, Problem List, Medications, Prescriptions, Care Team
- [ ] Vitals card (the extra section) renders the latest 10 readings
- [ ] Empty states are explicit ("No active allergies on file" — never blank)
- [ ] Error states are explicit and actionable (typed code + correlation id pattern from W1; we don't display raw fetch errors)
- [ ] Loading states show skeleton placeholders, not blank space
- [ ] Token expiry triggers a single refresh attempt; second 401 redirects to login
- [ ] `tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] At least one Vitest scenario per FHIR card (mocked fetch → asserted render shape)
- [ ] [`PATIENT_DASHBOARD_MIGRATION.md`](../../../PATIENT_DASHBOARD_MIGRATION.md) at repo root with the framework defense
- [ ] Deployed to the VPS at `/dashboard/` (or a subdomain) — reachable from cellular

## 7. Embedded task list

Numbered for cross-reference; no separate `TASKS.md` section. Tier rules mirror the W2 brief: tier 1 = polish (cuttable Sat night), tier 0 = blocking (cannot be cut without violating §6 acceptance).

### Phase 1 — Scaffold + auth (Friday morning, ~3 hours)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-01 | `npm create vite@latest patient-dashboard -- --template react-ts` from repo root; copy `tsconfig.json` + ESLint + Vitest config patterns from `agentforge/cui/` | 0 | `cd patient-dashboard && npm run build` clean; `npx tsc --noEmit` clean |
| PD-02 | Add deps: `@tanstack/react-query`, `zod`, `react-router-dom`, `tailwindcss`, `postcss`, `autoprefixer`, `@tailwindcss/forms`. Run `npx tailwindcss init -p` to generate `tailwind.config.js` + `postcss.config.js`. Configure `content: ['./index.html', './src/**/*.{ts,tsx}']`. Add `@tailwind` directives to `src/styles/globals.css`. | 0 | `package.json` updated; `tailwind.config.js` + `postcss.config.js` present; `<div className="text-blue-500">` smoke-test renders blue in dev |
| PD-03 | `<AuthProvider>` skeleton — React Context holding `accessToken`, `idToken`, `refreshToken` in `useState` (memory only, per D1). Helper hooks `useAccessToken()`, `useAuth()` | 0 | Vitest: AuthProvider renders children; `useAccessToken()` returns null until set |
| PD-04 | PKCE helpers in `auth/pkce.ts` — pure functions to generate verifier + challenge. Test the SHA-256 base64url encoding round-trip | 0 | Vitest: 3 scenarios green |
| PD-05 | `/login` route — generates PKCE pair, stores verifier in `AuthProvider`, redirects to OpenEMR's `/oauth2/authorize` with the right params | 0 | Manual smoke against deployed OpenEMR; redirected to login UI |
| PD-06 | `/callback` route — reads `code` + `state` from query, validates state CSRF, POSTs to `/oauth2/token` with verifier, stores tokens in `AuthProvider`, navigates to `/patient/:id` (id from id_token claim or fallback redirect) | 0 | Manual smoke: full login round-trip lands on `/patient/...` with a valid token in memory |
| PD-07 | OAuth2 client registration on the deployed OpenEMR — register `https://<vps>/dashboard/callback` as a redirect URI; obtain `client_id`. **Document the registration steps in `PATIENT_DASHBOARD_MIGRATION.md` Appendix A.** | 0 | `client_id` captured in `.env.example`; admin UI screenshot in journal |

### Phase 2 — FHIR client + shared card shell (Friday afternoon, ~2 hours)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-10 | `fhir/client.ts` — typed `fhirGet<T>(path, params)` wrapper that injects `Authorization: Bearer <token>` and parses JSON. Handles 401 (redirect to login if 2nd consecutive). | 0 | Vitest: 401-then-success scenario; 401-then-401 redirects |
| PD-11 | `fhir/schemas.ts` — Zod schemas for `Patient`, `AllergyIntolerance`, `Condition`, `MedicationRequest`, `CareTeam`, `Observation`, plus the FHIR `Bundle` envelope shape. Schemas are intentionally narrow (only fields we render — not full R4 spec) | 0 | Vitest: schema accepts canonical shape; rejects malformed |
| PD-12 | `fhir/hooks.ts` — `useFhirQuery<T>(resource, params, schema)` wrapper around `useQuery` with caching defaults (D5 staleTime: 30s) | 0 | Vitest: hook fires fetch with auth header; returns parsed data |
| PD-13 | `<ClinicalCard>` shared shell — title, loading skeleton, empty state, error state, content slot. CSS class hooks for the cards to extend | 0 | Vitest (RTL): each state renders correctly |

### Phase 3 — Cards + patient header (Friday evening + Saturday morning, ~5 hours)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-20 | `<PatientHeader>` — name, DOB (formatted), sex, MRN (extracted from identifier with the OpenEMR MRN system), active status pill | 0 | Vitest (RTL): renders all 5 fields from a stub Patient resource |
| PD-21 | `<AllergiesCard>` — list rows with allergen, reaction, criticality. Empty state "No active allergies on file." | 0 | Vitest + manual smoke |
| PD-22 | `<ProblemListCard>` — list rows with condition text, onset date, status. Filter to clinicalStatus=active in render | 0 | Vitest + manual smoke |
| PD-23 | `<MedicationsCard>` — active medications only (status=active). Render drug name + sig | 0 | Vitest + manual smoke |
| PD-24 | `<PrescriptionsCard>` — all MedicationRequests (active + completed), sorted by authoredOn desc, max 10 | 0 | Vitest + manual smoke |
| PD-25 | `<CareTeamCard>` — participant list with role + name. Empty state "No care team members assigned." | 0 | Vitest + manual smoke |
| PD-26 | `<VitalsCard>` — table of latest 10 vital-signs Observations. Columns: date, BP, HR, temp, weight | 1 | Vitest + manual smoke |
| PD-27 | `<PatientDashboardPage>` — composes the header + 6 cards in a 2-column grid. Mobile responsive (stack). | 0 | Manual smoke at desktop + mobile widths |

### Phase 4 — Polish + deploy (Saturday afternoon, ~3 hours)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-30 | Loading + error states across all cards verified in isolation by mocking the network at slow / failing | 1 | Vitest scenarios; manual smoke with throttled network |
| PD-31 | `npm run build` produces a `dist/` ready for static hosting | 0 | Build artifact present; bundle size < 250KB gzipped |
| PD-32 | Add `patient-dashboard` to the docker-compose stack as a sibling container running `nginx` to serve the `dist/`. Caddy routes `/dashboard/` to it | 0 | `docker compose up` from `docker/agentforge/`; reach `/dashboard/` returns the SPA index.html |
| PD-33 | Smoke against deployed OpenEMR: full login round-trip + every card renders for a cohort patient (Margaret Chen) | 0 | Journal entry with screenshot of every card populated |
| PD-34 | Cellular smoke from a phone — Chrome on iOS / Android — full round-trip works on cellular | 0 | Phone screenshot in journal |

### Phase 5 — Defense doc (Saturday evening, ~1.5 hours)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-40 | `PATIENT_DASHBOARD_MIGRATION.md` at repo root — covers: framework choice rationale (this PRD §4 condensed), tradeoffs we accepted (D1–D5), what we gained moving away from PHP (TypeScript at the API boundary, component reuse, FHIR-first data layer, fast dev loop), tradeoffs that came with React+Vite (no SSR, token in memory, bundle size, refresh-on-reload). Appendix A: OAuth2 client registration steps for grader reproducibility. | 0 | File at repo root; cross-linked from README |
| PD-41 | README update — add a `## Patient Dashboard Migration` section linking the deployed URL, the defense doc, and a one-paragraph framing | 0 | README updated |

### Phase 6 — Submission integration (Sunday AM)

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-50 | Add a row to `Documentation/AgentForge/submission.md` §1 deliverables for the dashboard, with deployed URL + GitLab path | 0 | Submission scoreboard updated |
| PD-51 | Demo video (FB-C-06) includes a 30-second segment showing the dashboard's OAuth2 login + cards rendering with FHIR data | 0 | Video re-cut includes the segment |
| PD-52 | Final commit + push to GitLab `master` includes the `patient-dashboard/` directory | 0 | `git log --stat` shows the commit |

### Phase 7 — Visual elevation pass on demo surfaces (Saturday late evening, ≤2 hours, OPTIONAL)

> **Cap is hard.** This phase is bounded at 2 hours. If we hit the cap, we ship what's done and move on. **Anything not finished by the 2-hour mark is dropped, not deferred.** Phase 7 exists because the brief grades the demo video as visible evidence; pushing the visual bar on the surfaces graders watch is high-leverage IF the build is otherwise on track. If Saturday's self-injection rehearsal or any FB-A/B/C/D smoke surfaces a regression, Phase 7 is **the first thing cut.**

**Scoping principle:** additive Tailwind classes only — no upstream OpenEMR PHP edits, no CUI rewrites, no global CSS resets. We're targeting elevation, not redesign. The W2 brief's already-shipped CUI keeps every existing test green; Tailwind is layered alongside, not replacing.

| ID | Task | Tier | Done proof |
|---|---|---|---|
| PD-70 | Visual pass on the **CUI rail** demo surfaces — the patient-context header strip (top of rail), the IntakeProposalCard, the lab ExtractionAcknowledgment, the AgentStepStrip, the EvalGate + PHI footer badges. Tailwind utility classes added inline; existing CSS classes preserved as fallbacks. Spacing, typography hierarchy, color palette aligned with the new dashboard's design language for visual continuity. **Must NOT regress any vitest scenario.** | 1 | CUI vitest still 83 passing; visual smoke screenshots before/after pasted into journal |
| PD-71 | Visual pass on the **OpenEMR top patient header bar** (name / DOB / gender pill at the top of the chart) via a scoped CSS override file `interface/themes/agentforge-elevated.css` registered in `globals.php` only when the `agentforge` module is active. Tailwind preflight is NOT loaded into OpenEMR — we hand-write the overrides using Tailwind's design tokens (spacing scale, color palette) for consistency. Risk-bounded: changes are CSS-only, scoped to the patient header DOM, easy to revert via removing the include line. | 1 | Visual smoke before/after; W1 GACL flow still works; iframe still mounts |
| PD-72 | Visual pass on the **calendar tab** — same approach as PD-71, scoped CSS overrides only. Bigger week-grid cells, clearer appointment chips, AgentForge cohort patients visually distinguished (subtle cohort-badge in the appointment chip). | 1 | Visual smoke before/after; calendar still loads; clicking an appointment still routes correctly |
| PD-73 | If any time remaining: visual pass on **patient chart sidebar / encounter forms** — same scoped-CSS-overrides approach. Just typography + spacing + color polish, no DOM restructuring. | 1 | Visual smoke before/after |

**Why this is Phase 7 and not interleaved earlier:** doing the polish pass after the dashboard's core is functional means we're polishing what graders actually see, not what we *thought* they'd see. Also — if the dashboard slips Saturday afternoon, Phase 7 is the natural shed-load. Putting it last keeps every earlier phase tier-0.

## 8. Risks + mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| OAuth2 client registration on the deployed OpenEMR has gotchas (callback URL exact match, allowed scopes) | Medium | Register early in PD-07 (Friday morning, not Saturday). Test the round-trip immediately. |
| FHIR endpoint returns shapes that don't match Zod schemas (OpenEMR's R4 implementation is not 100% canonical) | Medium | Schemas are intentionally narrow (only fields we render). Iterate on the schema per card as we hit failures. **Loosen schema rather than throw away data**, but document each loosen in defense doc. |
| TanStack Query cache + token refresh interact in subtle ways (refetch fires while token is being refreshed → 401 cascade) | Medium | One refresh-in-flight guard in `AuthProvider`. Test explicitly. |
| Mobile responsive layout eats time we don't have | Low | CSS grid + media queries; copy patterns from `agentforge/cui` if possible. Worst case: dashboard is desktop-only on Sunday and we document that as known limitation. |
| Same-origin cookies / CSRF gotchas if dashboard is served at `/dashboard/` and OpenEMR at `/` | Medium | OAuth2 with PKCE is bearer-token flow, not cookie-bound. Should work. If not, host dashboard on a subdomain (`dashboard.<vps>`) to fully decouple. |
| Demo video length blows past 5 min once we add the 30s dashboard segment | High | Pre-cut the W2 brief portion to 4 min so the dashboard segment fits. Already a known risk per FB-C-06. |

## 9. What this PRD intentionally defers

To V2 of the dashboard (post-Sunday):
- Encounter history navigation
- Labs trends with charts
- Document viewer (PDFs, images)
- Cross-patient nav (patient picker)
- Edit affordances on any card (the brief explicitly says "feature parity" — read-only is feature parity for the dashboard's *display* role)
- Real-PHI compliance posture
- Audit log of dashboard access
- i18n / a11y beyond ARIA basics

---

## 10. Deadline reality check

**Today (Thursday 2026-05-07 evening):** VPS redeploy of W2 brief work + tonight's midnight submission. This PRD is the handoff to Friday morning.

**Friday 2026-05-08 morning:** Phase 1 (PD-01..07). Auth round-trip working by Friday lunch is the "we're on track" signal.

**Friday afternoon + evening:** Phase 2 + start Phase 3.

**Saturday 2026-05-09:** Finish Phase 3 + Phase 4. Self-injection rehearsal in parallel (W2 brief track — non-negotiable, 1.5 hours).

**Saturday evening:** Phase 5 (defense doc) → Phase 7 (visual elevation pass, hard 2-hour cap).

**Sunday 2026-05-10 AM:** Phase 6. Final submission at 12:00 PM CT.

**If we slip, the cut order (top = first to drop):**
1. **PD-73** (chart sidebar polish — Phase 7 stretch)
2. **PD-72** (calendar visual pass)
3. **PD-71** (OpenEMR top patient header overrides)
4. **PD-70** (CUI rail visual pass)
5. **PD-26** (vitals card — replace with immunizations, a single FHIR call with sparser data)
6. **PD-30** (loading/error polish — leave default states)
7. **PD-34** (cellular smoke — desktop only)

**Never cut:** auth round-trip (PD-03..07), the 5 required cards (PD-21..25), the patient header (PD-20), the defense doc (PD-40), the submission scoreboard row (PD-50). Tailwind itself (PD-02) is also un-cuttable — without it, we'd default-fall-back to inline styles that would burn more time than the Tailwind setup costs.

---

## 11. Cross-references

- Brief: [Documentation/AgentForge/references/AgentForge — Clinical Co-Pilot W2 — Surprise Challenge_ Modernize the Patient Dashboard.pdf](../references/AgentForge%20—%20Clinical%20Co-Pilot%20W2%20—%20Surprise%20Challenge_%20Modernize%20the%20Patient%20Dashboard.pdf)
- W2 Clinical Co-Pilot brief: [Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf](../references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
- W2 Architecture (the AgentForge agent — separate track from this dashboard): [W2_ARCHITECTURE.md](../../../W2_ARCHITECTURE.md)
- Submission scoreboard: [Documentation/AgentForge/submission.md](../submission.md)
- OpenEMR FHIR docs: [FHIR_README.md](../../../FHIR_README.md)
- OpenEMR OAuth2 server: [oauth2/authorize.php](../../../oauth2/authorize.php)
- Existing CUI stack (the React+Vite reference we copy from): [agentforge/cui/](../../../agentforge/cui/)
