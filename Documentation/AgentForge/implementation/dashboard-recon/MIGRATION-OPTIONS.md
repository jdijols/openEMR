# Patient Dashboard — Migration Options

> **Phase 0 PD-04 output.** The 5-route comparison required by Tom Tarpey's reverse-first methodology — *"a load of different options for your design… informed choices with the good and the bad points to those, all the pros, the cons, what the ramifications and timeframes."*
>
> This is the upstream artifact for **Appendix B of the defense doc** (`PATIENT_DASHBOARD_MIGRATION.md`). The defense doc grade rests on this comparison being honest about *what we considered, what we rejected, and why.*

---

## Scoring framework

Per Tom's framework, score each route against four dimensions, then pick the route whose **weaknesses you can accept**:

- **Budget** — implementation cost (developer hours, learning curve, deps to adopt)
- **Timeline** — fits the deadline (Sunday 2026-05-10 noon CT, ~20 working hours)
- **Capability** — leverages skills we have, not skills we'd need to acquire
- **Fidelity** — supports feature parity for the brief's listed cards (Allergies, Problem List, Medications, Prescriptions, Care Team, +1 extra) plus the OAuth2/OpenID-Connect auth round-trip

Score each 1–5 (1 = poor fit, 5 = excellent fit). Total = arithmetic sum. Tiebreaker = the dimension we're most worried about under deadline pressure (Timeline).

## The 5 routes

### Route A — Next.js 15 App Router

**Stack:** Next.js 15 + React 19 + TypeScript 5 + Tailwind CSS 3 + Server Components / Server Actions

**What it'd buy us:** server-side OAuth2 token holding (the access token never enters the browser; mitigates XSS exfiltration cleanly). Built-in routing. Server Components reduce client-side bundle. SSR / streaming for first-paint perf.

**What it'd cost:**

| Dimension | Score | Notes |
|---|---|---|
| Budget | 3 | RSC mental model adds cognitive load: "this file runs on server, that file runs on client, this is a Server Action." Easy to footgun the client/server boundary under deadline. |
| Timeline | 2 | We've never shipped App Router. Concurrently learning + shipping is the definition of risk. |
| Capability | 2 | Adjacent to React (we have React skills via `agentforge/cui`), but App Router is a distinct sub-skill. |
| Fidelity | 5 | Excellent FHIR + OAuth fit. Token-server-side is genuinely better posture. |
| **Total** | **12 / 20** | |

**Why we passed:** the RSC overhead is real, the deadline is short, and the security gain (token-server-side) is overkill for a graded demo against synthetic patients. Captured the tradeoff in the defense doc.

---

### Route B — SvelteKit

**Stack:** SvelteKit 2 + Svelte 5 (runes) + TypeScript 5 + Tailwind CSS 3 + `@tanstack/svelte-query`

**What it'd buy us:** smaller runtime bundle (~4KB gzipped vs. ~50KB for React). Faster reactivity primitives. Single-file components with built-in scoped CSS. Vite under the hood (same dev experience as our chosen route).

**What it'd cost:**

| Dimension | Score | Notes |
|---|---|---|
| Budget | 2 | We don't have Svelte production experience. Component idioms (`$state`, `$derived`, `$effect`) are different enough from React that "translate while shipping" is a real cost. |
| Timeline | 1 | Highest learning curve of any candidate. Catching syntax errors in Svelte 5's runes mid-build is exactly the kind of slowdown the deadline can't absorb. |
| Capability | 1 | No prior shipping experience. |
| Fidelity | 4 | TanStack Query has a Svelte adapter. SMART-on-FHIR libs work. No structural blocker — purely team capability. |
| **Total** | **8 / 20** | |

**Why we passed:** smaller bundle is irrelevant for a clinician dashboard on stable connections. Learning Svelte mid-deadline is the wrong tradeoff to make.

---

### Route C — Remix / React Router v7

**Stack:** React Router v7 (formerly Remix) + React 18 + TypeScript 5 + Tailwind CSS 3 + nested data loaders

**What it'd buy us:** nested route-based data loading (loaders that resolve before render — no useEffect-fetch waterfall). Form-as-route-action posture. Strong progressive-enhancement story.

**What it'd cost:**

| Dimension | Score | Notes |
|---|---|---|
| Budget | 3 | Nested loaders + actions is a learnable but distinct mental model. We've used React Router v6 before — v7 is similar but the loader/action discipline is new. |
| Timeline | 2 | The merge of Remix into React Router happened post-v6 — community is fragmented; some docs are stale. |
| Capability | 3 | We know React Router (v6); v7 adds the loader/action layer. |
| Fidelity | 4 | Loaders are great for FHIR fetches if we needed coordinated multi-resource pre-fetch. We don't — the dashboard is one route with parallel queries. |
| **Total** | **12 / 20** | |

**Why we passed:** the nested-loader feature shines for multi-step flows (signup → setup → onboard); we have one route. The infra is overkill.

---

### Route D — Vanilla TypeScript + Lit Web Components

**Stack:** Lit 3 + TypeScript 5 + Vite + Tailwind CSS 3 (or scoped CSS via Lit's CSS-in-template) + raw `fetch` + manual cache layer

**What it'd buy us:** smallest bundle of any framework option (~5KB Lit runtime). Web Components are framework-agnostic and embeddable in legacy OpenEMR pages later. No framework lock-in.

**What it'd cost:**

| Dimension | Score | Notes |
|---|---|---|
| Budget | 2 | We'd reinvent: query caching, OAuth flow state machine, error/loading/empty primitive components, form validation. TanStack Query has no Lit adapter (small project). |
| Timeline | 1 | Reinvention under deadline = highest risk path. |
| Capability | 2 | We've used Lit experimentally but never shipped clinically. |
| Fidelity | 3 | Possible to reach feature parity, just slower. |
| **Total** | **8 / 20** | |

**Why we passed:** the brief asks for *"a modern framework"* — Lit qualifies, but the reinvention cost (cache, errors, OAuth state) consumes the time we needed for FHIR mapping. Embeddability into legacy OpenEMR pages is interesting for V2 but not graded in V1.

---

### Route E — React + Vite + TypeScript + TanStack Query + Zod + Tailwind  ← **selected**

**Stack:** React 18 + Vite 5 + TypeScript 5 + TanStack Query v5 + Zod v3 + Tailwind CSS v3 + React Router v6 + `@tailwindcss/forms`

**What it'd buy us:** stack we already shipped clinically (`agentforge/cui` is React+Vite, in production). All tooling is verbatim-copyable: `tsconfig.json`, ESLint, Prettier, Vitest, RTL. TanStack Query is the right shape for FHIR (every card is a `useQuery` against a per-resource endpoint with `patient={id}` as the cache key). Zod gives us *"parse, don't validate"* at the FHIR boundary. Tailwind is our CSS architecture and **the design-token bridge for Phase 7's CSS elevation pass on legacy PHP chrome**.

**What it'd cost:**

| Dimension | Score | Notes |
|---|---|---|
| Budget | 5 | All tooling is shipped. Adding 5 deps is a 5-minute task. |
| Timeline | 5 | The lowest-risk path; no unknowns in the build. |
| Capability | 5 | Identical to the W1 stack — full team confidence. |
| Fidelity | 4 | No SSR; access token in browser memory (D1). Marginally lower XSS posture than Route A's RSC, mitigated by D1–D7 invariants in the PRD. |
| **Total** | **19 / 20** | |

**Why we picked it:** see PRD §6 — this is the lowest-risk path to a working dashboard with a graded defense. The honest tradeoff is the access-token-in-memory posture (D1 invariant); Route A's server-side holding is the only structural improvement, and it's not worth the RSC cognitive load under deadline.

---

## Comparison summary

| Route | Stack | Budget | Timeline | Capability | Fidelity | **Total** | Verdict |
|---|---|---|---|---|---|---|---|
| **A** | Next.js 15 App Router | 3 | 2 | 2 | 5 | **12** | Rejected — RSC + deadline = risk |
| **B** | SvelteKit | 2 | 1 | 1 | 4 | **8** | Rejected — learning curve too high |
| **C** | Remix / RR v7 | 3 | 2 | 3 | 4 | **12** | Rejected — loader infra overkill for one route |
| **D** | Vanilla TS + Lit | 2 | 1 | 2 | 3 | **8** | Rejected — reinvention under deadline |
| **E** | **React + Vite + TS** | **5** | **5** | **5** | **4** | **19** | **Selected** |

## What we accepted as the cost of E

Per Tom's framework: *"pick the route whose weaknesses you can accept."* For Route E:

1. **No server-side token holding.** The OAuth2 access token lives in browser memory (per D1 invariant). Mitigated by *never* writing it to `localStorage` / `sessionStorage` / URL bearings; refresh-on-reload is acceptable.
2. **No SSR.** First paint shows skeletons for ~200–500ms while FHIR fetches resolve. Acceptable for an authenticated clinician on a stable network.
3. **Bundle ~50KB gzipped runtime.** Larger than Svelte/Lit; smaller than Next. We're not optimizing for cellular cold-start.
4. **Refresh-on-reload re-auth.** Token-in-memory means a hard reload sends the user back through OAuth. Acceptable; documented in the defense doc.

These aren't bugs — they're the deliberately-chosen tradeoffs that make the deadline work.

## Cross-references for the defense doc

Defense doc (`PATIENT_DASHBOARD_MIGRATION.md`) Appendix B uses this comparison verbatim. The narrative in the defense's main body (§5 — selected route + defense) condenses this to:

> *"We considered five routes — Next.js App Router, SvelteKit, Remix/React Router v7, vanilla TypeScript + Lit, and React + Vite + TypeScript. We selected React + Vite because (a) we already proved this stack ships clinically-shaped UI under deadline pressure (the W1 Clinical Co-Pilot rail uses the same stack), (b) every other candidate required us to learn the framework concurrently with shipping the app, and (c) the structural improvements offered by the alternatives — RSC's server-side token holding, Svelte's smaller bundle, Remix's nested loaders, Lit's framework-agnostic posture — were either irrelevant to a one-route dashboard or buying improvements that the deadline wouldn't reward."*

## Methodology citation

This artifact follows the framework Tom Tarpey presented in the 2026-05-06 W2-Migration meeting (slides: <https://vb6-legacy-slides.netlify.app>; reference repo: <https://github.com/decagondev/vb6-rework-reverse-forward>). Tom's discipline: re-derive the route choice **with the bug catalog and architectural analysis already in hand** — not as a pre-commitment. We did. The Phase 0 reverse-engineering pass (manifest.md + per-card MDs + parity notes) gave us the architectural understanding that *informed* this comparison rather than being reasoned about in isolation.
