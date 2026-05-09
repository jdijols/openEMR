---
date: 2026-05-09
topic: Patient Dashboard architecture pivot — standalone SPA → embedded module + design tokens
related_milestone: process/milestones/week-2/06-w2-patient-dashboard-migration.md
---

# Patient Dashboard architecture pivot — session journal

## Goal

Pivot the Patient Dashboard sub-project from Architecture 1 (standalone SPA at `/dashboard/` with its own OAuth flow) to Architecture 2 (React app embedded inside OpenEMR's chart shell as the dashboard tab content). User's prompt that triggered the pivot: *"Now you mentioned before that, because it's PHP, we can't really overwrite the front end, so how are we going to be able to integrate all the other aspects of our demo? … Can we embed our React app into the open EMR UI and take over where the dashboard was traditionally?"*

## Context

Phase 4 had shipped (11 cards, 113 tests, OAuth round-trip working end-to-end) when smoke against four cohort patients (Sofia Reyes, Margaret Chen, Phil Belford, Raymond Cooper) revealed a UX problem the standalone architecture created and could not fix: **5 screens to reach the dashboard** (login → patient picker → consent → callback → dashboard) vs. legacy OpenEMR's **3** (login → calendar → chart). Standalone also dropped the W1 CUI rail and the OpenEMR shell (calendar, top nav, encounter forms) from the demo path entirely. The original PRD §6/§7 read the brief's *"Frankenstein coexistence"* clarification as "two apps coexisting at different URLs"; the user's actual mental model was always "modernize one panel of the chart while everything around it keeps working."

## Key decisions

### Decision: Architecture pivot — embedded module supersedes standalone SPA

- **Prompt:** "Can we embed our React app into the open EMR UI and take over where the dashboard was traditionally? I don't think we really want a completely separate page that's not really connected to the other interfaces that open EMR grants us."
- **Recommendation:** Pivot to Architecture 2 — ship the React app as static files inside `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/` (same pattern the W1 CUI uses), let it inherit OpenEMR's existing PHP session, get patient context from the chart URL, and let OpenEMR's shell stay untouched. The brief allows this — *"Authentication via OAuth2/OpenID Connect"* describes the EMR's auth mechanism, not a requirement for the React app to drive its own OAuth client flow. 100% of the card/schema/test work from Phases 0–4 carries forward unchanged.
- **Outcome:** PRD §14 written documenting the revision; v1 (§§6–7) preserved as defense-doc narrative (what we considered, what changed, why). New PD-90..100 task list under §14. Tonight's commit batch landed the auth-injection + Vite-base-swap + design-token foundations; PHP loader + tab integration deferred to Saturday morning.

### Decision: Design tokens — slate/sky-derived from OG image, not OpenEMR Bootstrap 4.6

- **Prompt:** "the social sharing image banner that we see when I share the link for the production app to a friend in Messages, for example is a good example of our colors evolving to be more aesthetically pleasing."
- **Recommendation:** Inspect the OG image at [interface/modules/custom_modules/oe-module-agentforge/public/branding/og-image.png](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/branding/og-image.png) (deep navy plate `#0A2540`, bright accent `#4EA3FF`, gradient bg `#031628→#061B2F`). Translate that **dark-mode marketing palette** to a **light-mode product palette** using Tailwind's `slate` (cool grays) + `sky` (refined primary) + `emerald`/`amber`/`red` semantic colors. Same family, different surface. Token NAMES stay (`--af-*`); only values change, so the CUI rail auto-inherits the upgrade with zero per-component edits.
- **Outcome:** [agentforge/cui/src/index.css](../../../../../agentforge/cui/src/index.css) `--af-*` values swapped Bootstrap 4.6 → Tailwind slate/sky. [patient-dashboard/tailwind.config.js](../../../../../patient-dashboard/tailwind.config.js) gains the `af-*` color namespace mirroring the CUI tokens. Wholesale sed sweep across 14 dashboard components: `zinc-* → af-*`, `rose-* → af-danger-*`, `emerald-* → af-success-*`, `amber-* → af-warning-*`, `rounded-2xl → rounded-af-card`. PRD §15 codifies the tokens with WCAG-AA notes (focus rings, hit targets, contrast).

### Decision: `initialAuth` injection + `<HomeRoute>` supersede `/login` redirect for embedded mode

- **Prompt:** (implicit in the pivot — the PHP loader needs a way to bypass the React-side OAuth flow when embedded)
- **Recommendation:** Add `initialAuth` prop to `<AuthProvider>`. When present, AuthProvider boots in `authenticated` state immediately (no OAuth round-trip in the browser). [main.tsx](../../../../../patient-dashboard/src/main.tsx) reads `window.__AGENTFORGE_DASHBOARD__` and seeds `initialAuth`. New `<HomeRoute>` in [App.tsx](../../../../../patient-dashboard/src/App.tsx): if authenticated with patient context, `<Navigate>` to `/patient/<id>` immediately; otherwise (standalone-dev mode) `/login`. Backward-compatible with the existing OAuth flow.
- **Outcome:** Foundations land for the PHP loader to inject auth state before the React bundle boots Saturday. tsc clean, 113/113 tests still passing post-refactor.

### Decision: Defer integration tasks (PHP loader, tab hook, Phase 7) to Saturday morning

- **Prompt:** "I'm not going to sleep on this. I do want to address this now. Whether it takes three to four hours is fine with me."
- **Recommendation:** Counter-split the work. Tonight's discrete chunks are pure code (Vite base, AuthProvider refactor, design tokens, sed sweep, PRD revision); Saturday's are integration with OpenEMR's PHP module system (loader, token issuance, tab hook, Phase 7 elevation across PHP chrome). The latter is bug-prone at midnight and benefits from a fresh head. Executed only the pure-code portion tonight.
- **Outcome:** All foundational changes shipped tonight (PRD § 14 + §15, AuthProvider initialAuth, Vite base, design tokens, components repainted). Saturday picks up at PD-93..100 per PRD §14.

### Decision: Tier 1 stretch cards expanded to include Labs

- **Prompt:** "I just think we need to also include the Labs card into tier one. If that is all right with you, then let's go ahead and write the PRD against these tiers and what we decided on thus far."
- **Recommendation:** Accept Labs into Tier 1. It's FHIR-backed (`Observation?category=laboratory`), reuses the same Tier-0 infrastructure (Zod schemas, useFhirQuery, ClinicalCard), and adds high clinical signal (abnormal-flag rendering on lab values is one of the most visible "this dashboard is doing real EMR work" demonstrations). No marginal complexity.
- **Outcome:** Tier 1 = Demographics + Health Concerns + Immunizations + Appointments + Labs. PRD §2 + §7 FHIR mapping table updated. Labs landed Phase 4 with abnormal-flag pills (red text + High/Low pill) — visible in screenshot evidence (Raymond Cooper's chart shows Hgb A1c trending 7.6→7→7.4→6.9% all flagged High in rose, GFR 52→49→51 mL/min/1.73m² all Low).

### Decision: Hold the line on dashboard scope (5 required cards + 1 extra) over Jason's all-22-cards expansion

- **Prompt:** "we must include all of these cards … any downstream surfaces such that when you click Edit and View the cards … those surfaces must also be refactored on the front end to react … we should also include this adapting to React … (top navigation) … encounters and the visit summary."
- **Recommendation:** Pushed back with concrete math. 22 cards × edit views × top-nav rewrite × encounter forms = 100–170 hours of work; we have ~20. Many cards (Disclosures, Amendments, Reminders, Recall, Preferences) have no FHIR endpoint, so porting them requires backend changes the brief explicitly forbids. Better lever for cohesion: **Phase 7 visual elevation** (scoped CSS using shared design tokens) on the surrounding PHP chrome — same demo cohesion at 5% of the cost. For design-role positioning, depth of polish on a focused surface beats breadth-with-rough-edges every time.
- **Outcome:** Tier 0 (5 brief-required cards + Vitals) + Tier 1 (5 stretch cards) + Phase 7 (CSS-only elevation). 11 cards live by Phase 4. The pivot to embedded module makes Phase 7's cohesion case even stronger because the React dashboard now lives *inside* the same chart shell as the chrome it elevates.

## Trade-offs and alternatives

- **Architecture 1 (standalone SPA at /dashboard/)** — already built and working through Phase 4. Rejected: drops the OpenEMR shell + CUI rail from the demo path, forces 5-screen auth flow with patient picker, doesn't match user's actual mental model.
- **Pure session-cookie FHIR auth (no Bearer tokens)** — simpler than SMART EHR launch. Rejected: OpenEMR's FHIR controllers use `BearerTokenAuthorizationStrategy` and reject session-only requests; SMART-on-FHIR also explicit about Bearer requirement.
- **Iframe-into-demographics.php** — alternative to module-public-static. Rejected: iframe sizing/auth headaches and fragments design-token application; module-public-static (W1 CUI's pattern) is cleaner.
- **Cal Sans for product body text** — pretty for marketing OG. Rejected; staying on Lato (OpenEMR-native) with Tailwind heuristics (`font-medium`, `tracking-tight`) for refinement. Cal Sans stays a marketing-only flourish.

## Tools, dependencies, commands

- Wholesale token sweep across 14 dashboard components, longest-pattern-first ordering to avoid double-substitution:
  ```bash
  find src -type f \( -name "*.tsx" -o -name "*.css" \) -print0 \
    | xargs -0 sed -i '' \
        -e 's/zinc-900/af-text/g' \
        -e 's/zinc-700/af-text-subtle/g' \
        -e 's/zinc-500/af-text-muted/g' \
        ... (full ordering: zinc-900→700→600→500→400→300→200→100→50, then rose→700→600→500→200→50, then emerald, amber, rounded-2xl, bg-white)
  ```
- Production build verified after pivot: `npm run build` → 114 KB gzipped, base path `/interface/modules/custom_modules/oe-module-agentforge/public/dashboard/`, deterministic filenames `agentforge-dashboard.js` / `agentforge-dashboard-index.css`.

## Files touched

- **Modified:**
  - `Documentation/AgentForge/implementation/PRD-patient-dashboard.md` — added §14 architecture revision (~140 lines) + §15 design tokens (~80 lines); marked §7 superseded; bumped revision date.
  - `agentforge/cui/src/index.css` — `--af-*` values swapped Bootstrap 4.6 → Tailwind slate/sky family (CUI rail auto-upgrades).
  - `patient-dashboard/tailwind.config.js` — added `af-*` color namespace + `rounded-af-card` (8px) + `rounded-af-control` (6px) + Lato font stack with Inter fallback.
  - `patient-dashboard/vite.config.ts` — production `base` → module dashboard path; deterministic filenames.
  - `patient-dashboard/src/main.tsx` — reads `window.__AGENTFORGE_DASHBOARD__`, seeds `initialAuth`.
  - `patient-dashboard/src/auth/AuthProvider.tsx` — new `initialAuth` prop; embedded-mode bypass.
  - `patient-dashboard/src/App.tsx` — `<HomeRoute>` (replaces hardcoded `/` → `/login`).
  - `patient-dashboard/src/auth/login.tsx`, `auth/callback.tsx`, `components/ClinicalCard.tsx`, `patient/PatientHeader.tsx`, `patient/PatientDashboardPage.tsx`, all 11 card components — wholesale token swap.
  - `patient-dashboard/src/cards/AppointmentsCard.test.tsx` — updated assertion `toContain('rose')` → `toContain('af-danger')`.

## Outcomes

The Patient Dashboard sub-project is now architecturally aligned with the user's actual mental model (modernize one panel; rest of EMR untouched) and visually unified with the W1 CUI through shared `--af-*` tokens derived from the dark-mode brand banner. All 113 vitest cases pass; tsc clean; production bundle builds cleanly with the new base path. The integration glue (PHP loader, token issuance, tab hook) is the only remaining block before the demo flow Jason originally pictured can be smoke-tested end-to-end.

## Next steps

- [ ] **PD-93** Write `interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php` — pattern-mirror `panel.php`, validate session, read `set_pid`, mint/fetch SMART access token, render HTML with `window.__AGENTFORGE_DASHBOARD__` injected before bundle boots.
- [ ] **PD-94** Token issuance — two candidates: (a) SMART EHR launch redirect with launch context encoded in a launch token (no patient picker because context is in the token); (b) extend the existing `LaunchCode` infrastructure to mint OpenEMR-FHIR tokens (currently mints CUI/agentforge-api tokens). Investigate which is cleaner Saturday morning by reading `src/Common/Auth/OAuth2*.php` + `LaunchCode.php`.
- [ ] **PD-95** Register a hook in `openemr.bootstrap.php` that replaces the dashboard tab content with our React app when the agentforge module is enabled. Simplest path: add a sibling tab ("Modernized Dashboard") rather than overriding the legacy demographics.php tab — easier to revert + clearer A/B for graders.
- [ ] **PD-97** Write `interface/themes/agentforge-elevated.css` with `--af-*` variable references targeting login screen, top nav, patient header strip, calendar tab, encounter forms. ≤2h cap.
- [ ] **PD-98** End-to-end smoke against local Docker — log in, calendar, click patient, chart loads with React dashboard tab + CUI rail visible alongside. Recover from any token-issuance edge cases.
- [ ] **Defense doc** (`PATIENT_DASHBOARD_MIGRATION.md` at repo root) — pull narrative from PRD §6 + §14 + §15 + dashboard-recon outputs (10 prescribed sections per PD-60). Architecture-revision narrative is already in §14; transpose into a section of the defense doc.
- [ ] **Submission integration** — scoreboard row in `Documentation/AgentForge/submission.md`, demo recut to include 30s of the embedded dashboard.

## Links

- Numbered milestone (created same session): [process/milestones/week-2/06-w2-patient-dashboard-migration.md](../../milestones/week-2/06-w2-patient-dashboard-migration.md)
- PRD with revision: [Documentation/AgentForge/implementation/PRD-patient-dashboard.md](../../../implementation/PRD-patient-dashboard.md)
- Reverse-engineering output: [Documentation/AgentForge/implementation/dashboard-recon/](../../../implementation/dashboard-recon/)
- OG image inspiration: [interface/modules/custom_modules/oe-module-agentforge/public/branding/og-image.png](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/branding/og-image.png)
- W1 CUI panel mount pattern (reference for PD-93): [interface/modules/custom_modules/oe-module-agentforge/public/panel.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php)
