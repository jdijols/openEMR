---
date: 2026-05-03
topic: CUI proposal-card destructive UX, toggle-button refresh, header patient-link, calendar toolbar layout
related_milestone: none
---

# CUI and calendar toolbar UX pass — session journal

## Goal

Tighten the Clinical Copilot rail and the OpenEMR calendar toolbar based on live design feedback: rework destructive proposal-cards (Delete/Cancel + red), iterate the rail toggle's icon and two-state styling, make the patient label in the CUI header a working Dashboard link mirroring OpenEMR's top-bar pattern, and fix the calendar's `#viewPicker` so the Month button stops wrapping when the rail is open.

## Context

All changes are visual / interaction polish on already-shipped features. The CUI bundle (`agentforge/cui/`) is a sandboxed iframe served by `panel.php`; the calendar lives in a *separate* iframe inside OpenEMR's tabs system. Cross-iframe coordination happens through the existing `NAV_REQUEST` postMessage protocol in [rail_container.html.twig](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig). One non-obvious gotcha surfaced mid-session: the development Docker overlays a named volume on top of `public/themes/`, so host edits to compiled theme CSS never reach the container — themes must be rebuilt via `/root/devtools build-themes` for the SCSS source change to land in the served file.

## Key decisions

### Decision: Destructive proposal cards swap Confirm/Reject for Delete/Cancel

- **Prompt:** "instead of the buttons being Confirm or Reject, they should be Delete and Cancel, with the correct icons paired ... red-style Delete button ... for all delete type proposed change cards"
- **Recommendation:** Detect delete proposals by `write_target.endsWith('_delete')` so future delete targets (`medication_delete`, etc.) inherit the destructive look automatically without an enum bump. Add a new `IconTrash`, a `--danger` button modifier reusing existing `--af-danger*` tokens, and widen `formatDeliveryFailure`'s verb union so failure pills read "Delete failed" / "Cancel failed" on these cards.
- **Outcome:** [MessageList.tsx](../../../../../agentforge/cui/src/chat/MessageList.tsx) + [index.css](../../../../../agentforge/cui/src/index.css). All 89 vitest tests + typecheck clean.

### Decision: Toggle button icon — sparkles, not brain

- **Prompt:** "make sure that we're using an icon set that matches the refresh button inside the CUI header ... outlined and lighter ... side profile of a brain" → after rejection: "can we just get some generic-looking AI icon, maybe some stars or something like this?"
- **Recommendation:** Two iterations failed — FontAwesome `fa-brain` (top-down filled) was rejected, and a hand-drawn outlined side-profile brain SVG read poorly at 14px. Pivoted to the de-facto AI mark: two 4-pointed sparkles inlined as SVG in the same outlined-stroke style as `IconPanelSync`. Inline SVG (not FA) keeps it stylistically aligned with the CUI's own iconography even though the toggle lives in the OpenEMR header chrome.
- **Outcome:** [header_icon.html.twig](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/header_icon.html.twig).

### Decision: Toggle button geometry — square with symmetric margin

- **Prompt:** "Make sure the button is a square shape and that it has the same distance to the right of it as it does to the left of it"
- **Recommendation:** Drop Bootstrap's wider horizontal `btn-sm` padding via inline `padding: 0.25rem; line-height: 1`, switch `ml-1` → `mx-1`, and set the SVG to `display: block` so the button locks to a 28×28 box around the 20px sparkle regardless of surrounding font size.
- **Outcome:** Same Twig template as above.

### Decision: Two-state open/closed toggle pivots on aria-expanded; color is theme-probed

- **Prompt:** "right now it's a light gray, where it should be this dark navy blue color that is used elsewhere ... make sure that the colors are in sync across both states"
- **Recommendation:** First pass hardcoded Bootstrap's stock `#6c757d` (visibly off — OpenEMR's `style_light` overrides secondary to `#1f2937`, and other themes use `#467ac2`/`#002b36`/etc.). Replaced with a one-time JS probe at init that reads `.btn-outline-secondary`'s computed color and writes it into a CSS custom property `--toggle-active-color` on the toggle button. CSS keys off `[aria-expanded="true"]` (already flipped by the existing rail JS) so no new state plumbing was needed; hover always inverts to the *opposite* state so the button telegraphs what a click will do.
- **Outcome:** Theme-color probe added in [rail_container.html.twig](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig); CSS uses `var(--toggle-active-color, #1f2937)` in [header_icon.html.twig](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/header_icon.html.twig).

### Decision: Patient name in CUI header → Dashboard tab via NAV_REQUEST

- **Prompt:** "when it is clicked, it opens the dashboard. The same exact way, clicking the patient's name inside the top section of the open EMR UI opens the dashboard or, if it is open, refreshes the dashboard"
- **Recommendation:** Wrap the `<h1>` text in a zero-styled `<button>` (only when both a copilot title AND a bound patient UUID are present), post a new `NAV_REQUEST` envelope with `kind: 'patient_dashboard'`, and route it on the parent side to the existing `navigateDemographicsInChrome()` helper — which already calls `loadCurrentPatient()`, the same global the OpenEMR top-bar `ptName` link is bound to via Knockout. Behavior is provably identical, not approximated. Hover/`:focus-visible` add an underline, no other resting-state change.
- **Outcome:** [App.tsx](../../../../../agentforge/cui/src/App.tsx) + [index.css](../../../../../agentforge/cui/src/index.css) + new branch in [rail_container.html.twig](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig). Verified end-to-end in the Vite preview: resting computed style identical to plain h1 text; click emits `{ type: 'NAV_REQUEST', hint: { kind: 'patient_dashboard', params: {} }, expected_patient_uuid }` to `window.location.origin`.

### Decision: Calendar `#viewPicker` — equal-flex sides with content-floor min-width

- **Prompt:** Two-stage. First: "allowing more space for the view picker ... so that the month button does not appear on a second line until it absolutely has to." Then: "both functions and viewpicker have the same width properties so that will make the date nav centered between both of them"
- **Recommendation:** Initial fix gave only `#viewPicker` `flex: 0 0 auto` so `#functions` absorbed all slack — Month stopped wrapping but dateNAV pinned right-of-centre. User flagged the asymmetry; final shape gives BOTH `#functions` and `#viewPicker` identical `flex: 1 1 0; min-width: max-content`. The `max-content` floor pegs each side at its own intrinsic width (~290px for viewPicker's five buttons), so in any layout wide enough for equal halves dateNAV centres naturally and Month never wraps. **Crucial gotcha:** the dev Docker mounts a named volume over `public/themes/`, so `sed`-edits to host CSS never reached the container — only `docker compose exec openemr /root/devtools build-themes` lands the SCSS change in the served file. The user's earlier inspector snippet (`#dateNAV, .col-md-6 { flex: 0 0 50% }`) was a stale-cache artifact, not present in any actual served file.
- **Outcome:** [ajax_calendar_sass.scss](../../../../../interface/themes/ajax_calendar_sass.scss) + container theme rebuild. Verified via `curl http://localhost:8300/public/themes/style_light.css` — both `#functions` and `#viewPicker` now have matching minified `flex:1 1 0;min-width:max-content` declarations.

## Trade-offs and alternatives

- **Brain icon attempts** — Discarded both FA `fa-brain` (top-down filled) and a custom outlined side-profile SVG. Both read poorly at 14–20px. Sparkles align with the AI-product visual language users already recognize.
- **Hardcoded `#1f2937` for the open-toggle color** — Considered, but breaks under any non-default OpenEMR theme. JS probe is ~10 LOC and theme-safe.
- **`#viewPicker { flex: 0 0 auto }` only (first attempt)** — Stopped Month wrapping but pinned dateNAV right. Symmetric `flex: 1 1 0` + `min-width: max-content` on both sides solves both the wrap and the centering at once.
- **Direct-patching minified CSS in the container** — Faster than a rebuild, but the next theme build would silently revert the change. Preferred SCSS source edit + `build-themes` so the fix is durable.

## Tools, dependencies, commands

- `docker compose -f docker/development-easy/docker-compose.yml exec -T openemr /root/devtools build-themes` — required after every SCSS edit; the `themevolume` named volume hides host theme edits.
- `npm run typecheck` and `npm test` (in `agentforge/cui/`) — used to validate each CUI bundle change.
- `curl -sk http://localhost:8300/public/themes/style_light.css` from the host — confirms the served (post-rebuild) CSS matches the container, useful for diagnosing browser-cache vs server-state confusion.

## Files touched

- **Modified:** `agentforge/cui/src/chat/MessageList.tsx` (IconTrash, isDelete branch, widened verb union)
- **Modified:** `agentforge/cui/src/App.tsx` (`requestPatientDashboardNavigation`, header title-link branch)
- **Modified:** `agentforge/cui/src/index.css` (`.agentforge-msg__proposal-btn--danger`, `.agentforge-cui__title-link`)
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/templates/header_icon.html.twig` (icon swap, square geometry, two-state CSS)
- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig` (theme-color probe, `patient_dashboard` NAV_REQUEST branch)
- **Modified:** `interface/themes/ajax_calendar_sass.scss` (viewPicker layout — final form: equal flex + max-content floor)
- **Modified:** 25× `public/themes/*.css` (initial direct sed pass; later superseded by `build-themes` rebuild output)

## Outcomes

- Delete-type proposal cards now render Delete (red) + Cancel (X) automatically for any `*_delete` write target.
- Rail toggle button is a 28×28 square with symmetric margin, two outlined sparkles, and a two-state look that flips colors on open/closed and previews the opposite state on hover.
- Toggle's open-state fill matches the active OpenEMR theme automatically (default `#1f2937`, cobalt blue, solar, etc.) — no hardcoded swatch.
- Patient label in the CUI header is a working link to the Dashboard tab, behaviorally identical to OpenEMR's top-bar `ptName` link (open if closed, refresh if open).
- Calendar `#topToolbarRight` lays out as `[functions slack] [dateNAV centered] [viewPicker slack]` with both side groups matched and Month locked inline by the `max-content` min-width floor.
- The Docker `themevolume` gotcha is now documented in the journal so the next session doesn't lose 30 minutes diagnosing it.

## Next steps

- [ ] Visual smoke-test the toggle two-state colors under non-default themes (`style_dark`, `style_cobalt_blue`, `style_solar`) — only verified the default `style_light`.
- [ ] If `style_dark` or `style_manila` (light-secondary themes, `#f8f9fa`) make the open-state toggle hard to read against the header bar, consider a contrast-aware probe (luminance check, swap text color).
- [ ] Watch for any new write target backend-side that uses `_delete` suffix — destructive UX picks it up automatically; verify on first appearance.

## Links

- _None this session._
