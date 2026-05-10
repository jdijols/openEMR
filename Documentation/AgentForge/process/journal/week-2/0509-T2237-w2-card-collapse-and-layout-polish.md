---
date: 2026-05-09
topic: Card collapse toggle, layout polish, persistence store, and Immunization FHIR null fix
related_milestone: none
---

# Card collapse toggle and layout polish — session journal

## Goal

Bring the new React patient dashboard to feature parity with the legacy dashboard's card-collapse interaction (title-click toggles body, persists across patient and tab switches), fix two layout bugs (cards stretching to row-height, bottom section laid out as a 3×2 grid instead of two independent columns), add a master "Expand All / Collapse All" control to the patient header, and resolve an unrelated Immunizations card error surfaced mid-session.

## Context

The patient dashboard ships as a React bundle served by `interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php` (built from `patient-dashboard/`). All 11 cards (Allergies, Vitals, Appointments, CareTeam, Demographics, HealthConcerns, Immunizations, Labs, Medications, Prescriptions, ProblemList) wrap their content in a shared `<ClinicalCard>` chrome — making it the natural single point for the toggle behavior.

## Key decisions

### Decision: collapse-toggle scope, click target, and a11y

- **Prompt:** "Need to add an interaction to all the dashboard cards that, when the card title is clicked, it expands or collapses the card itself, so it operates as a toggle. … Confirm you understand what I'm referring to before you start changing code."
- **Recommendation:** Land the toggle in shared [`ClinicalCard.tsx`](../../../../../patient-dashboard/src/components/ClinicalCard.tsx) so all 11 cards inherit one behavior. Click target = `<h2>` text only (not whole header), default expanded, chevron at right of title rotating -90° when collapsed, hover-underline on title text only, no background/significant hover on chevron. Wrap title text in a `<button>` inside `<h2>` per the WAI-ARIA accordion pattern; add `aria-expanded` + `aria-controls`; hide body via `hidden` attribute (preserves children mount state).
- **Outcome:** Single edit in [ClinicalCard.tsx](../../../../../patient-dashboard/src/components/ClinicalCard.tsx); 4 unit tests added in [ClinicalCard.test.tsx](../../../../../patient-dashboard/src/components/ClinicalCard.test.tsx). Header `border-b` drops when collapsed so the lone header line doesn't read as orphaned.

### Decision: persistence backend — localStorage over AJAX

- **Prompt:** "On your previous recommendation on the state of the expanding and collapsing cards across patients with Ajax, I agree. If it's easy to implement, let's go with that. I don't like how, if I switch tabs to, let's say, the reports tab and switch back, it resets all my cards."
- **Recommendation:** User said "AJAX" but the symptom (state resets when chart-shell remounts the iframe) is solved equally well by `localStorage`, which is per-browser-per-clinician and one tenth the surface area of a server-side per-user pref (no DB column, no API endpoint, no CSRF). True multi-device sync would require AJAX; for an EHR clinician on one workstation, that's a non-issue. Kept the public hook surface narrow so the implementation can be swapped later without consumer changes.
- **Outcome:** New [cardCollapseStore.ts](../../../../../patient-dashboard/src/cards/cardCollapseStore.ts) — singleton `Record<title, boolean>` synced to `localStorage` via `useSyncExternalStore`. Cards consume `useCardExpanded(title)`; the master toggle uses `useAllCardsExpanded()` + `setAllExpanded(value)`. Memory entry pinned: [feedback_openemr_fhir_nullish.md](../../../../../../.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/feedback_openemr_fhir_nullish.md).

### Decision: layout polish — `items-start` + two-column flex flow

- **Prompt:** "We may need to make sure that the cards all have their height set to hug the content. Right now, I believe they're set to fill the space …" then later: "the bottom six cards are not three rows of two cards; there are two columns of three cards, so they should be pushed up vertically in each column."
- **Recommendation:** Two distinct CSS-grid behaviors causing the symptom: (1) grid's default `align-items: stretch` was forcing cells to row-height; (2) the bottom `<section>` was a 6-cell `grid-cols-2` so a short cell got padded to its tall row-mate's height. Fix (1) with `items-start` on the grids; fix (2) by wrapping the desktop columns in `flex flex-col` so each column flows independently — mirrors the legacy demographics.php layout.
- **Outcome:** [PatientDashboardPage.tsx:87,96-113](../../../../../patient-dashboard/src/patient/PatientDashboardPage.tsx) updated. Left column = Demographics → Labs → Vitals; right column = Appointments → Health Concerns → Immunizations.

### Decision: Expand-All / Collapse-All control in the patient header

- **Prompt:** "add an Expand All and Collapse All toggle in the patient header within the dashboard on the right-hand side. This will also have the same Chevron to the right of the text and do exactly as it describes."
- **Recommendation:** Add a `CollapseAllToggle` sibling to the inner `flex-1` div in [PatientHeader.tsx](../../../../../patient-dashboard/src/patient/PatientHeader.tsx), pushed right by the existing flex row. Label flips between "Collapse All" (when every visible card is expanded — clicking collapses all) and "Expand All" (when any card is collapsed — clicking expands all). Same chevron-right-of-text + hover-underline-on-text-only treatment as the card titles for visual coherence.
- **Outcome:** [PatientHeader.tsx](../../../../../patient-dashboard/src/patient/PatientHeader.tsx) gained the control on the right side of the header; only the populated view renders it (skeleton/error states omit it).

### Decision: FHIR Coding schema — `.nullish()` not `.optional()`

- **Prompt:** Olivia Tran's Immunizations card showed "Could not load immunizations." — user pasted the network response showing 8 valid entries, with the first containing `vaccineCode.coding[0].display: null`.
- **Recommendation:** OpenEMR's FHIR serializer emits explicit `null` (not omitted) for missing string fields on Coding entries; Zod's `.optional()` accepts `undefined` but rejects `null`, so a single null on any coding field fails the entire bundle parse and surfaces as an error state. Relax `system`, `code`, `display` on shared `FhirCoding` to `.nullish()`. Consumer code already uses `??` which falls through `null` correctly, so no downstream changes. Same fix proactively clears latent failures on every other card that uses `FhirCoding`.
- **Outcome:** [schemas.ts](../../../../../patient-dashboard/src/fhir/schemas.ts) `FhirCoding` updated; [schemas.test.ts](../../../../../patient-dashboard/src/fhir/schemas.test.ts) gains a regression test using a real OpenEMR Immunization payload with `display: null`. Memory pinned for future card work.

### Decision: vitest 4 localStorage polyfill in test setup

- **Prompt:** "We'll go ahead and run the focus test file" — test file then failed with `localStorage.getItem is not a function`.
- **Recommendation:** Vitest 4's `--localstorage-file` plugin isn't configured in this project, so the global `localStorage` is an empty object with no Storage methods. Production code wraps storage access in try/catch and degrades to in-memory only, hiding the failure from the existing ClinicalCard tests (they passed despite localStorage never persisting). For the new dedicated store tests, this had to be fixed. A targeted Map-backed Storage polyfill in [src/test/setup.ts](../../../../../patient-dashboard/src/test/setup.ts) is less invasive than reconfiguring vitest globally and exercises the persistence path that production cares about.
- **Outcome:** Polyfill added to `src/test/setup.ts`; 6 new store tests in [cardCollapseStore.test.ts](../../../../../patient-dashboard/src/cards/cardCollapseStore.test.ts) all pass; full suite remains green at 133 tests.

## Trade-offs and alternatives

- **AJAX server-side per-user persistence** — would match legacy parity exactly and sync state across devices; deferred until multi-device sync is an explicit need. Hook surface preserved so a future swap is internal-only.
- **`flex-col` wrappers vs. CSS columns / masonry** — CSS multi-column would preserve mobile reading order without rewriting source order, but balances by content height (would split cards across columns unpredictably). Chose `flex-col` for predictable per-column control; mobile reading order trades off slightly (single-column cascade goes D→L→V→A→H→I rather than the prior D→A→L→H→V→I row pairs) — acceptable for an EHR that ships on desktop.
- **`useId` body-id vs. data-attribute** — `useId` gives a stable a11y `aria-controls` target; data-attribute would have worked too but isn't picked up by screen readers.

## Tools, dependencies, commands

- `npm --prefix patient-dashboard run build` — rebuilt the React bundle three times across the session (one per visible-from-dashboard.php fix); each run regenerates `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/agentforge-dashboard.{js,css}` and the PHP loader's `md5_file()` cache-buster picks up the new hash automatically — no hard refresh required.
- `npm --prefix patient-dashboard exec -- vitest run --root patient-dashboard <pattern>` — run patient-dashboard tests in isolation. The unrooted form pulls in `agentforge/cui` test files that need their own jsdom config and fail spuriously; the `--root` flag scopes vitest to one package.

## Files touched

- **Created:**
  - `patient-dashboard/src/cards/cardCollapseStore.ts`
  - `patient-dashboard/src/cards/cardCollapseStore.test.ts`
- **Modified:**
  - `patient-dashboard/src/components/ClinicalCard.tsx`
  - `patient-dashboard/src/components/ClinicalCard.test.tsx`
  - `patient-dashboard/src/patient/PatientDashboardPage.tsx`
  - `patient-dashboard/src/patient/PatientHeader.tsx`
  - `patient-dashboard/src/fhir/schemas.ts`
  - `patient-dashboard/src/fhir/schemas.test.ts`
  - `patient-dashboard/src/test/setup.ts`
  - `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/agentforge-dashboard.js` (built)
  - `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/agentforge-dashboard-index.css` (built)
  - `interface/modules/custom_modules/oe-module-agentforge/public/dashboard/index.html` (built)

## Outcomes

All 11 dashboard cards now toggle collapse on title click; state persists across chart-shell tab switches and across patients via `localStorage`. Patient header has a right-aligned "Expand All / Collapse All" control with consistent affordance. Bottom 6 cards lay out as two independent vertical columns; cards everywhere hug their content height. Immunizations card now loads correctly on Olivia Tran's chart (and any other patient with null-valued FHIR codings); 7 new tests + 1 schema regression bring the patient-dashboard suite to 133 passing.

## Next steps

- [ ] Build per-card edit modals matching the existing AllergyModal pattern (each card's `+` action button currently no-ops except for Allergies)
- [ ] Optional: promote this work to a numbered milestone if it warrants trail placement (currently `related_milestone: none`)
- [ ] Optional: revisit server-side per-user persistence if multi-device sync becomes a stated requirement (hook surface ready for swap)
- [ ] Investigate why other cards may also be hitting the same null-coding issue silently — the schema fix is proactive, but a quick grep for similar parse-failure patterns on other patients would confirm

## Links

- _None this session._
