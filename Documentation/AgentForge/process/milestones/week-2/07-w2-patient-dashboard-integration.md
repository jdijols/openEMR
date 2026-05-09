# 07 — W2 Patient Dashboard integration, polish, submission prep

> Milestone covering the work after [milestone 06](06-w2-patient-dashboard-migration.md) — the architecture pivot to embedded module + Phase 4's 11 cards rendering live FHIR — through to a submission-ready state for the Sunday-noon W2 surprise-challenge deadline. This is the **final** dashboard milestone before submission; the next session picks up at the deploy + demo-video + submission-form handoff list at the bottom.

## Purpose

Where 06 ended:
- Architecture revision documented in [PRD §14](../../../implementation/PRD-patient-dashboard.md), v1 standalone-SPA preserved as defense narrative.
- Foundations landed: Vite `base` swap, AuthProvider `initialAuth` prop, design tokens unified.
- 113 vitest passing, tsc clean, 114 KB gzipped.
- PD-93..100 deferred to "Saturday morning" (this session).

What this milestone covers:
- Auth model resolved (PD-94): same-origin LocalApi over SMART/LaunchCode-extension.
- Every chart-shell entry point rerouted to the React dashboard: calendar → patient, finder, messages, refresh button, top-level Dashboard tab, secondary patient nav, Documents back-link.
- CUI rail integration: `parent.left_nav.setPatient` JS emission, Knockout subscription with race-guard + smooth-swap (no white flash on patient activate/swap/deactivate).
- Two OpenEMR-core 500s fixed in-module without core edits: FHIR `requiredEndpointScope` uninit + `apache2handler` empty `PHP_BINARY`.
- Visual upgrade: lucide iconography, redesigned Patient Header (avatar + sticky-blur), 12 px ClinicalCard with hover-lift, 9-tab `<PatientSubNav>`, Phase 7 elevated theme injected into legacy iframes, layout match to legacy structure, uniform 20 px spacing rhythm.
- Defense doc shipped at repo root (`PATIENT_DASHBOARD_MIGRATION.md` — 10 sections + 2 appendices).
- Submission scoreboard W2-surprise row added to [submission.md §2b](../../../submission.md).

## Architecture decisions

The journal at [0509-T1747](../../journal/week-2/0509-T1747-w2-dashboard-integration.md) carries the full Decisions log. The five most-load-bearing choices, summarized for the trail:

### 1. Auth: same-origin LocalApi (cookie + APICSRFTOKEN), not SMART EHR launch

Found that [`LocalApiAuthorizationController`](../../../../../src/RestControllers/Authorization/LocalApiAuthorizationController.php) already accepts cookie + `APICSRFTOKEN` header on `/apis/default/fhir/*`, bypassing both Bearer auth and downstream scope checks. Same pathway OpenEMR's first-party UIs use ([`interface/main/tabs/main.php:133`](../../../../../interface/main/tabs/main.php)). Rejected SMART EHR launch (reintroduces consent screen) and LaunchCode-extension (multi-hour build through League OAuth2 Server internals). Defense narrative: *"the EMR uses OAuth2/OIDC at its trust boundary; the React app inherits that established trust via the same-origin pathway OpenEMR already exposes for first-party UIs."* The OAuth + PKCE flow is preserved as a dev-mode fallback in source.

### 2. Five chart-shell route seams (not one)

Patient-load entry points fan out across OpenEMR core JS:
- `tabs_view_model.js:285 loadCurrentPatient()` (refresh button + rail)
- `frame_proxies.js:11-19 RTop.location` setter (calendar / finder / messages / dated_reminders / dynamic_finder)
- Chart-shell main menu `menu_id="dem1"` (top-level Dashboard tab)
- Patient secondary nav `menu_id="dashboard"` (inside `displayHorizNavBarMenu()`)
- Hardcoded `<a href="...demographics.php">` in legacy templates (Documents page, etc.)

A single override doesn't catch all. Solution: layer five seams via [`Bootstrap.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php) — two Symfony event subscribers (`MenuEvent`, `PatientMenuEvent`) plus three JS overrides injected into the chart shell at `RenderEvent::EVENT_BODY_RENDER_POST`. `dashboard.php` honors `?set_pid=N` so it's a drop-in for the legacy URL pattern; mirrors `demographics.php`'s `parent.left_nav.setPatient(...)` JS emission so the chart-shell Knockout observable updates and the CUI rail picks up patient changes.

### 3. MemoryRouter in embedded mode (the actual rendering blocker)

The Vite production build sets `base = /interface/modules/custom_modules/oe-module-agentforge/public/dashboard/`. React Router's `BrowserRouter` reads `import.meta.env.BASE_URL` and uses `/interface/.../dashboard` as `basename`. The iframe URL is `/interface/.../dashboard.php` — `.php`, not under `/dashboard/`. Pathname doesn't fall inside basename → routes don't match → `<NotFound>` renders → blank-looking canvas. `MemoryRouter` for embedded mode (with `initialEntries={['/patient/${injected.patientId}']}`) sidesteps URL routing entirely; `BrowserRouter` stays for standalone-dev. **This was the actual reason the dashboard appeared invisible for several sessions of debugging — the menu rewrites were correct all along.**

### 4. CUI rail integration: subscribe + race-guard + smooth-swap

Three layered fixes for the CUI rail to track patient context cleanly:

| Concern | Fix |
|---|---|
| Patient SET on calendar click | `dashboard.php` emits `parent.left_nav.setPatient(...)` mirroring [demographics.php:938](../../../../../interface/patient_file/summary/demographics.php). Updates Knockout observable; CUI rail's existing 1500ms poll picks up the change → re-mints launch code. |
| Patient CLEAR (deactivate) | Add a Knockout `subscribe()` callback in [`rail_container.html.twig`](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) that fires *immediately* on observable transition (vs waiting up to 1.5 s for the next poll tick). |
| AJAX race | `clearPatient()` fires the `unset_pid` AJAX async; if we reload panel.php immediately, it reads the OLD `$_SESSION['pid']` and re-bootstraps with the just-deactivated patient. Defer reload by 350 ms. |
| White flash on swap | Old logic blanked iframe to `about:blank` then loaded panel.php → visible white page intermediate. Replace with `reloadPanelFresh()`: cache-busted same-origin nav (`panel.php?_=Date.now()`). Browser keeps the previous document rendered until the new doc parses → smooth content swap. |

### 5. Module-side fixes for two OpenEMR-core 500s

Both surfaced in browser console; both root-caused; both fixable from our module without core edits.

**Issue 1 — FHIR `requiredEndpointScope` uninit (HTTP 500 on every LocalApi FHIR request):**
[`AuthorizationListener::onRestApiSecurityCheck`](../../../../../src/RestControllers/Subscriber/AuthorizationListener.php) early-returns for LocalApi requests without calling `updateRequestWithConstraints()`. Downstream `FhirGenericRestController::canAccessResource()` reads the uninitialized typed property → crash. Fix: register a `RestApiSecurityCheckEvent` listener at priority 40 (after core's 50) that back-fills `system/*.read` for LocalApi requests. Wildcard scope is correct for trusted same-origin LocalApi where the scope filter would be a no-op anyway.

**Issue 2 — `background_service/$run` HTTP 500 on chart load:**
Under Apache `apache2handler` SAPI, `PHP_BINARY` is empty. `SymfonyBackgroundServiceSpawner` passes `""` as `args[0]` to `proc_open` → "First element must contain a non-empty program name." Fix: set OpenEMR's own escape-hatch env `OPENEMR__NO_BACKGROUND_TASKS=true` in [docker-compose](../../../../../docker/development-easy/docker-compose.yml). Production deployments use cron anyway; the chart-shell-trigger is a dev convenience.

## Visual upgrade trajectory

The PRD §15 plan called for a token-only repaint of the existing Phase 4 components. The user redirected toward a substantially deeper visual ambition mid-session (*"physicians should be wowed"*). The compounding interventions:

| Surface | Change |
|---|---|
| Patient Header | Avatar circle (initials + sky gradient), 22 px name, inline meta pills with lucide icons (`UserRound`, `Cake`, `IdCard`), Active pill (rounded-md, emerald, with status dot) + Clear × button (rounded-md, neutral → danger on hover, calls `top.clearPatient()`), sticky + backdrop-blur. |
| ClinicalCard shell | 12 px corners (`rounded-xl`), hover-lift (shadow expansion + border darken), icon chip in header with semantic accent (`default` / `sky` / `emerald` / `amber` / `rose` / `violet`), shimmer loading skeleton (`animate-shimmer` keyframe added to `tailwind.config.js`), iconographic empty / error states (Inbox / AlertCircle from lucide). |
| Per-card identity | Allergies rose+`AlertTriangle`, Problem List + Health Concerns amber+`Activity`/`Target`, Medications + Prescriptions sky+`Pill`/`ScrollText`, Care Team + Vitals emerald+`Users`/`HeartPulse`, Labs + Immunizations violet+`FlaskConical`/`Syringe`, Appointments sky+`CalendarDays`, Demographics neutral+`IdCard`. |
| `<PatientSubNav>` | New 9-tab horizontal nav (Dashboard / History / Assessments ▾ / Report / Documents / Transactions / Issues / Ledger / External Data); halfway-refined visual style — text links + primary-blue underline on active, no pills, no icons (matches legacy structure for seamless click-to-navigate). Assessments rendered as dropdown (single child: SDOH Assessment). |
| Phase 7 elevation on legacy chrome | Single CSS file `interface/themes/agentforge-elevated.css` with `--af-*` tokens. Loaded conditionally via two PHP event hooks AND injected into legacy iframes (`history.php`, `transactions.php`, etc.) by an iframe-load watcher in `Bootstrap.php` that adds the `<link>` tag + an `af-active` class on the matching menu item — so the active-tab highlight works on every patient subpage. |
| Layout | Match to legacy structure with our 11-card subset: 3-col top row (Allergies / Problem List / Medications) → full-width middle (Prescriptions, then Care Team) → 2-col bottom paired by row (Demographics+Appointments / Labs+Health Concerns / Vitals+Immunizations). Collapses to single-column below `md` (~768 px). |
| Spacing rhythm | `px-5` (20 px) on outer containers matches inter-card `gap-5` (20 px) — single value at every viewport, no breakpoint variants. `max-w-5xl` removed so the dashboard fills the iframe edge-to-edge regardless of CUI rail state. |
| Shape unification | All status pills (`StatusPill`, `SeverityPill` in Allergies, `StatusPill` in Appointments, the dual pills in CareTeamCard) shifted from `rounded-full` → `rounded-md` (6 px). Avatar + decorative dots stay circular. Aligns with OpenEMR's squarer chrome. |
| CUI footer pills | `.agentforge-cui__footer { display: none !important; }` appended to [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css) — physician sees no PHI / Eval grading pills. Components, endpoints, tests preserved (W2-main-brief grading evidence stays in source for one-rule revert). |

Bundle: 384 KB / **115 KB gzipped** — under the PRD's 250 KB ceiling. CUI bundle: 250 KB gzipped (unchanged).

## Files (key entry points for the new chat)

The new chat tomorrow should start by reading these in order:

1. **This file** — Saturday's full integration milestone.
2. [Journal 0509-T1747](../../journal/week-2/0509-T1747-w2-dashboard-integration.md) — full Decisions log + commands + handoff list.
3. [`PATIENT_DASHBOARD_MIGRATION.md`](../../../../../PATIENT_DASHBOARD_MIGRATION.md) — defense doc as shipped (10 sections + auth-pathway appendix + 5-route comparison appendix).
4. [`Bootstrap.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php) — every Symfony event listener + JS injector that wires the React dashboard into OpenEMR's chart shell.
5. [`dashboard.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php) — the PHP loader (CSRF mint + bootstrap injection + `parent.left_nav.setPatient` mirror of demographics.php:938).
6. [`rail_container.html.twig`](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) — Knockout subscription + race-guard + cache-busted reload (lines ~680-760).
7. [`agentforge-elevated.css`](../../../../../interface/themes/agentforge-elevated.css) — Phase 7 elevation rules; `.af-active` class is set by the iframe-load watcher in Bootstrap.php.
8. [`patient-dashboard/src/main.tsx`](../../../../../patient-dashboard/src/main.tsx) — MemoryRouter / BrowserRouter mode-pick.
9. [`patient-dashboard/src/patient/PatientDashboardPage.tsx`](../../../../../patient-dashboard/src/patient/PatientDashboardPage.tsx) — layout structure.
10. [`submission.md` §2b](../../../submission.md) — W2 surprise-challenge scoreboard with operator-side gating items.

## Decisions

Lifted from the [session journal](../../journal/week-2/0509-T1747-w2-dashboard-integration.md) — see there for full prompts/rationale.

- **Auth: LocalApi over SMART/LaunchCode** (PD-94 resolved). Same-origin cookie + APICSRFTOKEN. Defense story: trust inheritance from existing OpenEMR session.
- **Five route seams beat one.** loadCurrentPatient + RTop.location + MenuEvent + PatientMenuEvent + back-link DOM rewriter. dashboard.php drop-in for `?set_pid=N`.
- **MemoryRouter in embedded mode.** Vite base path makes BrowserRouter basename invalid; routes don't match; React renders `<NotFound>` not the dashboard. The actual rendering blocker.
- **CUI rail: Knockout subscription + 350ms race-guard + cache-busted nav.** Replaces about:blank intermediate flash; resets cleanly on patient deactivate.
- **Module-side fix for OpenEMR-core scope-init bug.** No core edits. priority-40 RestApiSecurityCheckEvent listener back-fills `system/*.read` for LocalApi.
- **`OPENEMR__NO_BACKGROUND_TASKS=true` env** suppresses the chart-shell background-service trigger that crashes under Apache mod_php's empty PHP_BINARY.
- **Visual ambition expanded beyond PRD §15.** lucide-react, redesigned PatientHeader/ClinicalCard, 9-tab PatientSubNav, layout match to legacy, uniform 20 px rhythm, status pills moved to `rounded-md`. Defense doc captures the design vocabulary.
- **Hide CUI footer badges via CSS, preserve all code.** W2-main-brief grading evidence stays in source for one-rule revert.
- **Keep the duplicate Patient Header.** User explicitly opted to keep both the chart-shell `dashboard_header.php` strip AND our React inner PatientHeader. Frankenstein-by-design.

## Next milestone

`08-w2-submission-and-deploy.md` after Sunday morning's deploy + demo-video re-cut + submission-form handoff. Will cover: VPS push, agentforge-enable.php rerun, local→VPS DB import, cellular smoke from a phone, demo recut (30 s of embedded dashboard), submission-form fields populated, submission timestamp captured in journal. Plus any post-deploy hardening that surfaces.
