---
date: 2026-05-09
topic: W2 Patient Dashboard — chart-shell integration, polish, submission prep
related_milestone: process/milestones/week-2/07-w2-patient-dashboard-integration.md
---

# W2 Patient Dashboard — chart-shell integration, polish, submission prep — session journal

## Goal

Pick up from milestone [06](../../milestones/week-2/06-w2-patient-dashboard-migration.md) (architecture pivot → embedded module, Phase 4 complete with 11 cards rendering live FHIR against four cohort patients) and ship the integration: PHP loader, every chart-shell entry point routed to the React app, CUI co-pilot continuity, defense doc, OpenEMR core 500s fixed in-module, and the visual lift the user redirected toward repeatedly across the session — *"physicians should be wowed by the look and feel."*

## Context

06 ended with the embedded-module foundations landed (Vite base swap, AuthProvider `initialAuth`, design tokens) and PD-93..100 deferred to Saturday. This session executed all of those AND took the visual ambition substantially further than the original PRD §15 token-only repaint — adding lucide iconography, a redesigned PatientHeader (avatar + sticky-blur), a patient sub-nav, a layout match to legacy structure, and a uniform spacing rhythm. Two OpenEMR-core 500s also surfaced and were resolved without core edits. Submission scoreboard + defense doc shipped.

## Key decisions

### Decision: Auth model — same-origin LocalApi over SMART/LaunchCode-extension (PD-94)

- **Prompt:** *(PRD §14 PD-94 — "investigate two candidates: (a) SMART EHR launch redirect with launch context encoded in a launch token; (b) extend the existing LaunchCode infrastructure")*
- **Recommendation:** Reject both. Found `LocalApiAuthorizationController` ([src/RestControllers/Authorization/LocalApiAuthorizationController.php:27](../../../../../src/RestControllers/Authorization/LocalApiAuthorizationController.php)) accepts cookie auth + `APICSRFTOKEN` header on FHIR endpoints, bypassing both Bearer auth and scope checks. Same pathway OpenEMR's first-party UIs already use ([interface/main/tabs/main.php:133](../../../../../interface/main/tabs/main.php)). One round-trip; no consent screen; no token minting; clean defense story.
- **Outcome:** [public/dashboard.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php) mints CSRF via `CsrfUtils::collectCsrfToken($session, 'api')`; React's `fhir/client.ts` branches by `mode: 'bearer' | 'localApi'` and sends `APICSRFTOKEN` in production / `Authorization: Bearer` in dev-mode fallback.

### Decision: Three chart-shell route seams + dashboard.php as set_pid drop-in

- **Prompt:** *"when a patient name is selected from the calendar that it actually loads the correct dashboard and severs the connection to the old one"*
- **Recommendation:** Patient-load entry points fan out: `tabs_view_model.js:285 loadCurrentPatient()`, `frame_proxies.js:11-19 RTop.location` setter, the chart-shell main menu (`menu_id="dem1"` in [`standard.json:108`](../../../../../interface/main/tabs/menu/menus/standard.json)), and the patient secondary nav (`menu_id="dashboard"`). Plus calendar/finder/messages all do `top.RTop.location = '...demographics.php?set_pid=N'` directly — a single function override won't catch all. Solution: layer multiple seams via `Bootstrap.php` JS injection + Symfony event listeners; make `dashboard.php?set_pid=N` a drop-in for the legacy URL pattern (calls `PatientSessionUtil::setPid` if `set_pid` query is present).
- **Outcome:** Five hooks in [`Bootstrap.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php): `MenuEvent::MENU_UPDATE` (chart-shell tab), `PatientMenuEvent::MENU_UPDATE` (secondary nav), `loadCurrentPatient` override, `RTop.location` setter override, `<a href*="demographics.php">` rewriter for legacy back-buttons (Documents page, etc.). Every entry point now lands on the React dashboard.

### Decision: MemoryRouter in embedded mode (the actual rendering blocker)

- **Prompt:** *"after browsing the patient chart more, I now see that when I select the dashboard from within the main content area, it actually changes the title to 'Modernized Patient Dashboard,' and that content area is now empty"*
- **Recommendation:** The Vite production build sets `base = /interface/.../dashboard/` (with trailing slash); React Router's `BrowserRouter` reads `import.meta.env.BASE_URL` and uses `/interface/.../dashboard` as `basename`. The iframe URL is `/interface/.../dashboard.php` — `.php`, not under `/dashboard/`. Pathname doesn't fall inside basename → routes don't match → `NotFound` renders → blank-looking canvas. Fix: `MemoryRouter` for embedded mode (we know the patient ID from injection — no URL routing needed), keep `BrowserRouter` for standalone-dev mode.
- **Outcome:** [`main.tsx`](../../../../../patient-dashboard/src/main.tsx) renders `<MemoryRouter initialEntries={['/patient/${injected.patientId}']}>` when `__AGENTFORGE_DASHBOARD__` is present, otherwise `<BrowserRouter basename={ROUTER_BASENAME}>`. The actual fix that made the React app appear; everything else was decoration on top of that.

### Decision: CUI rail integration — Knockout subscription with race-guard + smooth-swap

- **Prompt:** *"every time I load a new patient, it flashes the entire CUI panel and then presents the new one … Whereas before, it would just maintain the empty state"*
- **Recommendation:** Three layered fixes. **(a)** `dashboard.php` emits `parent.left_nav.setPatient(...)` JS mirroring [`demographics.php:938`](../../../../../interface/patient_file/summary/demographics.php) so the chart-shell Knockout observable updates → CUI rail picks up the new patient. **(b)** Add a Knockout subscription in [`rail_container.html.twig`](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) on `app_view_model.application_data.patient` that fires *immediately* on patient-clear (vs. the existing 1500ms poll). **(c)** Race-guard: defer the panel reload by 350ms because `clearPatient()` fires the `unset_pid` AJAX async — without the wait, panel.php reloads with stale `$_SESSION['pid']` and the CUI re-bootstraps with the just-deactivated patient. **(d)** Replace `blankPanelIframe()` (which forced an `about:blank` intermediate → visible white flash) with `reloadPanelFresh()` (cache-busted same-origin nav → browser keeps old document rendered until new doc parses → smooth content swap).
- **Outcome:** CUI rail updates instantly on patient activate / swap / deactivate with no white flash and no stale state. Polling kept as the safety net for non-Knockout state changes (encounter id, DOM-driven pid input).

### Decision: Module-side fix for two OpenEMR core 500s without core edits

- **Prompt:** *"now it shows that the clinical co-pilot agent API is not firing"* + console log showing `/apis/default/fhir/Observation 500` and `/apis/default/api/background_service/$run 500`
- **Recommendation:** Two distinct root causes, both in core, both fixable from our module. **Issue 1 (FHIR 500):** [`AuthorizationListener::onRestApiSecurityCheck`](../../../../../src/RestControllers/Subscriber/AuthorizationListener.php) early-returns for LocalApi requests *without* calling `updateRequestWithConstraints()`, so `$request->requiredEndpointScope` stays uninitialized. `FhirGenericRestController::canAccessResource()` then crashes accessing the typed property. Fix: register a `RestApiSecurityCheckEvent` listener at priority 40 (after core's 50) that back-fills `system/*.read` for LocalApi requests. **Issue 2 (background_service 500):** under Apache mod_php (`apache2handler` SAPI), `PHP_BINARY` is empty; `SymfonyBackgroundServiceSpawner` passes `""` as `args[0]` → `proc_open` throws *"First element must contain a non-empty program name."* Fix: set OpenEMR's own escape-hatch env `OPENEMR__NO_BACKGROUND_TASKS=true` in docker-compose; production deployments use cron anyway.
- **Outcome:** [`Bootstrap::backfillLocalApiScope`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php) added at priority 40 — all FHIR endpoints (Patient / Observation / AllergyIntolerance / Condition / MedicationRequest / CareTeam / Immunization / Appointment) now return 200. Vitals card populates, no chart-shell console errors.

### Decision: Visual upgrade trajectory beyond PRD §15

- **Prompt:** *"the UX is pretty much the same … not a pretty-looking app … I would like to modernize the look and feel of this so when my graders open the application, they are wowed by its look and feel"*
- **Recommendation:** Compounding visual interventions over the session: install lucide-react; redesign `<PatientHeader>` (avatar circle with initials + sky gradient, sticky-blur, refined meta pills, vertically-aligned Active pill + Clear button); redesign `<ClinicalCard>` shell (12 px corners, hover-lift, icon chip in header with semantic accent colors, shimmer loading skeleton, refined empty / error states); 9-tab `<PatientSubNav>` with active state mirrored on legacy pages via Phase 7 CSS injected through an iframe-load watcher in `Bootstrap.php`; layout match to legacy structure (3-col top / full-width middle / 2-col bottom paired by row); shape unification (status pills moved from `rounded-full` to `rounded-md` for OpenEMR's squarer rhythm); spacing rhythm (`px-5` = `gap-5` = 20 px everywhere); `max-w` removed so the dashboard fills the iframe edge-to-edge.
- **Outcome:** 117/117 vitest, tsc clean, 115 KB gzipped (still under PRD's 250 KB ceiling). Defense doc captures the design vocabulary.

### Decision: Hide CUI footer badges via CSS, preserve all code

- **Prompt:** *"This row below the composer for evaluations and PHI, we don't need it at all. It's not necessary for the physician experience."*
- **Recommendation:** Pushed back briefly — `EvalGateBadge` + `PhiRedactionBadge` are W2-main-brief grading evidence (FB-A-05/06 in [`submission.md` §3.1](../../../submission.md)) and W2 graders may watch the same demo. Compromise: CSS-hide instead of code-removal — physician sees nothing, components / `/health/eval-status` + `/health/phi-redaction` endpoints / tests / DOM all preserved. One-rule revert.
- **Outcome:** [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css) appended `.agentforge-cui__footer { display: none !important; }`. CUI bundle rebuilt (250 KB gzipped — unchanged from baseline).

## Trade-offs and alternatives

- **SMART EHR launch token mint** — proper textbook approach but reintroduces the consent screen on first launch, and would have required wiring through League OAuth2 Server's `AccessTokenRepository` internals (multi-hour build). LocalApi was already trusted same-origin pathway.
- **Postmessage protocol for CUI patient-change** — would eliminate the React re-mount tick on patient swap (better than even the current smooth-swap). Rejected for now: documented W1 had four race-condition failure modes with this; ~2-3h to address. Deferred, not gated.
- **Edit OpenEMR core to fix the auth-scope bug** — cleaner architectural fix (3-line change to `LocalApiAuthorizationController` or `AuthorizationListener`) but violates the brief's *"you are not touching the backend."* Module-side listener is the correct constraint-respecting choice.
- **Drop the inner Patient Header to resolve the duplicate-header issue** — user explicitly said *"we're going to leave the duplicate patient header"* — keep both. The chart-shell `dashboard_header.php` strip stays above; our React `<PatientHeader>` stays below. Frankenstein-by-design.

## Tools, dependencies, commands

```bash
# Patient dashboard React project (in patient-dashboard/)
cd patient-dashboard
npm install lucide-react        # icon library — adds ~3 KB per icon used (tree-shakeable)
npm run dev                     # localhost:5174 — standalone-dev mode (OAuth + PKCE)
npm run build                   # outputs to interface/modules/custom_modules/oe-module-agentforge/public/dashboard/

# CUI panel (changes need a rebuild before they're visible inside OpenEMR)
cd agentforge/cui
npm run build                   # outputs to .../public/cui/

# Canonical OpenEMR Docker command — MUST include the agentforge override
# so AGENTFORGE_API_PUBLIC_URL is in env (otherwise CUI shows "Unable to start session")
cd docker/development-easy
docker compose \
  -f docker-compose.yml \
  -f ../agentforge/docker-compose.override.yml \
  up -d openemr

# After PHP file edits, restart for opcache:
docker compose \
  -f docker-compose.yml \
  -f ../agentforge/docker-compose.override.yml \
  restart openemr
```

## Files touched

- **Created:**
  - `interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php` — PHP loader (CSRF mint + patient UUID + bootstrap injection + parent.left_nav.setPatient JS)
  - `interface/themes/agentforge-elevated.css` — Phase 7 elevated theme for legacy chrome
  - `patient-dashboard/src/patient/PatientSubNav.tsx` — 9-tab patient secondary nav (Dashboard / History / Assessments ▾ / Report / Documents / Transactions / Issues / Ledger / External Data)
  - `PATIENT_DASHBOARD_MIGRATION.md` (repo root) — 10-section defense doc + Appendix A (auth pathway) + Appendix B (5-route comparison)

- **Modified:**
  - `interface/modules/custom_modules/oe-module-agentforge/src/Bootstrap.php` — added: `rewriteChartShellDashboardTab` (MenuEvent), `rewriteDashboardTab` (PatientMenuEvent), `injectChartShellOverrides` (loadCurrentPatient + RTop.location + iframe-load watcher + back-link rewriter), `injectElevatedTheme` (CSS link), `backfillLocalApiScope` (RestApiSecurityCheckEvent priority 40)
  - `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig` — Knockout subscription on patient observable, race-guard 350ms defer, `reloadPanelFresh` cache-busted nav (replaces `blankPanelIframe`)
  - `patient-dashboard/src/main.tsx` — MemoryRouter for embedded / BrowserRouter for standalone, mode-aware `initialAuth`
  - `patient-dashboard/src/App.tsx` — `<HomeRoute>` redirect logic
  - `patient-dashboard/src/auth/AuthProvider.tsx` — `mode: 'bearer' | 'localApi'` discriminator on `AuthState` + `useFhirCredential` hook
  - `patient-dashboard/src/auth/AuthProvider.test.tsx` — coverage for both modes (3 new tests)
  - `patient-dashboard/src/auth/callback.tsx` — passes `mode: 'bearer'` to `completeAuthorization`
  - `patient-dashboard/src/fhir/client.ts` — `fhirGet` accepts `FhirCredential` (mode + token), branches header (Authorization: Bearer vs APICSRFTOKEN), sends `credentials: 'same-origin'` for cookie pass-through
  - `patient-dashboard/src/fhir/client.test.ts` — coverage for both header branches
  - `patient-dashboard/src/fhir/hooks.ts` — `useFhirQuery` reads from `useFhirCredential`
  - `patient-dashboard/src/patient/PatientHeader.tsx` — full redesign (avatar, meta pills, sticky-blur, items-center alignment, ClearPatientLink with X icon → `top.clearPatient()`)
  - `patient-dashboard/src/patient/PatientHeader.test.tsx` — updated assertions for new layout
  - `patient-dashboard/src/patient/PatientDashboardPage.tsx` — layout match to legacy (3-col top / full-width middle / 2-col bottom paired); `px-5` matching `gap-5`; `max-w-5xl` removed; sub-nav inserted below header
  - `patient-dashboard/src/components/ClinicalCard.tsx` — full redesign: 12 px corners, icon slot with `accent` prop (default / sky / emerald / amber / rose / violet), hover-lift, shimmer loading, iconographic empty / error states
  - `patient-dashboard/src/cards/{Allergies,ProblemList,HealthConcerns,Medications,Prescriptions,CareTeam,Vitals,Labs,Immunizations,Appointments,Demographics}Card.tsx` — added lucide icon + accent prop on every ClinicalCard call site
  - `patient-dashboard/tailwind.config.js` — added `shimmer` keyframe + animation, `af-card-hover` shadow
  - `agentforge/cui/src/index.css` — appended `.agentforge-cui__footer { display: none !important; }` to hide PHI / Eval pills from physician demo
  - `Documentation/AgentForge/submission.md` — added §2b W2-Surprise-Challenge scoreboard (12 deliverables, all ✅ except deploy-side operator items)
  - `README.md` (repo root) — added pointer to `PATIENT_DASHBOARD_MIGRATION.md` in the Documentation table
  - `docker/development-easy/docker-compose.yml` — added `OPENEMR__NO_BACKGROUND_TASKS: "true"` env to suppress the chart-shell background-service trigger
  - `patient-dashboard/package.json` + `package-lock.json` — `lucide-react` dependency

## Outcomes

The W2 surprise-challenge dashboard is now reachable from every chart-shell entry point (calendar / finder / messages / refresh-patient / chart-shell tab / secondary nav / Documents back-link). 11 cards render live FHIR data via same-origin LocalApi auth — no SMART OAuth round-trip needed in production. CUI rail seamlessly tracks patient activate / swap / deactivate with no white flash. Two OpenEMR-core 500s (FHIR scope-uninit, background-service spawner) are fixed in our module without core edits. Defense doc + submission scoreboard row shipped. Visual upgrade landed: avatar header, lucide-iconography across cards, 9-tab patient sub-nav, Phase 7 elevation on legacy chrome, layout match to legacy structure, uniform 20 px spacing rhythm. **117/117 vitest, `tsc --noEmit` clean, all PHP `php -l` clean, all wire-level smokes pass.**

## Next steps

Submission day (Sunday 2026-05-10) handoff list — for the new chat picking up tomorrow:

- [ ] **VPS redeploy** with new code (operator) — `git push gitlab master` then SSH redeploy. Pay attention to the env-var canonical command in §"Tools, dependencies, commands" above; recreating the openemr container without the agentforge override file drops `AGENTFORGE_API_PUBLIC_URL` and the CUI shows "Unable to start session" (regression we hit + fixed once this session).
- [ ] **Local-DB → VPS-DB import** (operator) — full dump-and-import per [memory: VPS DB deploys via full local-DB import](../../../../.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/project_vps_db_deploy_workflow.md).
- [ ] **`agentforge-enable.php`** rerun on VPS (operator) — refresh module branding per [memory: module registrar refresh](../../../../.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/project_module_registrar_refresh.md).
- [ ] **Cellular smoke** from a phone (operator) — open the deployed URL on cellular, log in, click a patient on calendar, verify React dashboard loads + CUI rail updates.
- [ ] **Demo video re-cut** (operator) — 30 s segment of the embedded dashboard inside the chart shell. Show: calendar → patient → React dashboard renders → click Dashboard secondary tab (already there) → click History → legacy page loads with elevated chrome → click Dashboard back → React reappears → click Clear → CUI returns to empty state.
- [ ] **Submission form fields** (operator) — populate deployed URL, video URL, GitLab URL.
- [ ] **D6 + D7 final audit** (10 min) — view-source on the deployed `dashboard.php` should still show zero PHP / Twig / Smarty in the panel response and `authUser:"<clinician>"` in the bootstrap.

Pending visual + dev-loop items deferred (NOT gating submission, but worth lifting in a future iteration):

- [ ] **Per-card data refinement** — severity color-stripes on Allergy rows, big-value treatment for Vitals (large numerics with units), more prominent abnormal-flag badges on Labs, avatar mini-circles for Care Team members, status indicator dots on Problem List.
- [ ] **Dev-mode hot-reload inside OpenEMR's chart shell** — wire `dashboard.php` to detect `?devMode=1` (or env flag) and load the bundle from `localhost:5174` (Vite dev server) instead of the built file. Then `npm run dev` in another terminal gives HMR inside the chart shell. ~30 min.
- [ ] **Postmessage protocol for CUI patient-change** — eliminate the React re-mount tick on patient swap. Documented in W1 with four race-condition failure modes; ~2-3 h to address properly.
- [ ] **Replace shape-token sweep across other Tailwind UI** if any survives (sub-nav dropdown menu still uses `rounded-lg` (8 px); fine as-is unless inconsistency surfaces).

## Links

- Numbered milestone (this session): [process/milestones/week-2/07-w2-patient-dashboard-integration.md](../../milestones/week-2/07-w2-patient-dashboard-integration.md)
- Prior milestone (architecture pivot + Phase 4): [process/milestones/week-2/06-w2-patient-dashboard-migration.md](../../milestones/week-2/06-w2-patient-dashboard-migration.md)
- Prior journal (architecture pivot session): [process/journal/week-2/0509-T0004-w2-dashboard-embedded-pivot.md](0509-T0004-w2-dashboard-embedded-pivot.md)
- Defense doc (graded as part of submission): [PATIENT_DASHBOARD_MIGRATION.md](../../../../../PATIENT_DASHBOARD_MIGRATION.md)
- W2 submission scoreboard: [Documentation/AgentForge/submission.md](../../../submission.md) §2b
