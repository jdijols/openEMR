---
date: 2026-05-01
topic: CUI panel polish — header parity across states, white empty canvas, auto-grow textarea (no drag handle), Send + Mic flex-fill the compose column
related_prior_journal: ./0501-T1557-brief-cache-bust-stale-bundle.md
related_task_list: ../../../../../TASKS.md
---

# CUI panel polish — post-PR5 cleanup pass

## Goal

Tighten the loose ends from the PR1–PR5 CUI redesign that the summary
session shipped earlier today: (1) the chrome bar appeared shorter on
the empty state than on an active chart, (2) the empty-state canvas
still rendered as an inset card with its own border + radius even after
the chrome inversion, (3) the compose textarea exposed a manual
drag-resize handle that the user did not want, and (4) the Send / Start
dictation buttons sat at content-height regardless of how tall the
textarea grew. Operator directive throughout: small visual diffs,
preserve PR5 framing, do not regress the test suite.

## Context

PR1–PR5 (prior session, see chat summary) had:

- Inverted the chrome — gray header + footer, full-width white message
  feed in the middle.
- Stripped the assistant message card so agent text flows on the white
  canvas with no border / radius / accent / avatar / "Copilot" label.
- Kept user messages as a right-aligned light-blue bubble with a 1 px
  border, with the dictation badge tucked inside the bubble at the top
  left.

What landed in the production module after PR5 — confirmed by the user's
two screenshots at session start:

- Active-chart header: gray bar, ~3 vertical rems of chrome, "Refresh
  chart" button on the right.
- Empty-state ("Open a patient chart to begin."): bare `<h1>` rendered
  *outside* any `<header>` wrapper, no gray bar, no Refresh button. The
  inner `.agentforge-cui__empty` block still had `background: var(--af-surface-alt)`,
  `border: 1px solid var(--af-border)`, `border-radius: var(--af-radius)`
  → a card-in-a-card look.
- Compose textarea: `resize: vertical` and `rows={3}` with no auto-grow
  effect, so the only way to make it taller was the drag gutter.
- Compose buttons: `width: 100%` but no flex sizing → height = content,
  not column.

## Key decisions

### Decision 1: Extract `renderPanelHeader(showRefresh)` so all three states share the same chrome bar — but parameterize Refresh visibility

- **Prompt:** *"Not bad, but the header should be consistent between
  the empty state and when a patient chart is active. … the top header
  is very short in height and should be consistent between both
  states."*
- **Initial recommendation:** Wrap the empty/loading branches in the
  same `<header class="agentforge-cui__header">` chrome the active
  branch already uses. Always render Refresh, but degrade its action
  for non-ready states (`reloadPanel` → plain `window.location.reload()`
  with no cache-bust call, since there is no JWT).
- **Follow-up prompt:** *"on the empty state view, the refresh chart
  button should be hidden, and the background of the main content area
  should just be white. … that main content area right now looks like
  it has a border radius that shouldn't be there"*.
- **Refined recommendation:** Replace the always-on `panelHeader`
  expression with a `renderPanelHeader(showRefresh: boolean)` factory.
  Pass `false` only for the chart-required empty branch
  (`no_chart_bound` / `no_patient_context`); keep `true` for the
  generic handshake-error branch (so a stuck "Unable to start session"
  still has a recovery affordance), the loading branch (so a stuck
  "Connecting…" can be reloaded), and the ready branch (where it does
  the real cache-busting `refreshChartBinding`).
- **Outcome:** `aria-label` keeps state-specific wording —
  `"Refresh chart binding"` on ready, `"Reload Copilot panel"` on
  recovery — so screen readers stay honest *and* the
  `App.test.tsx:126` `waitFor(... /refresh chart binding/i)` still
  synchronises with the handshake-ready transition. Header height now
  matches the active state in every branch that shows the button; the
  no-chart branch is a touch shorter by intentional product choice (no
  recovery action exists when no patient is bound).

### Decision 2: Flatten `.agentforge-cui__empty` to the same white canvas as the message strip

- **Prompt:** *(continuation of the empty-state cleanup above.)*
- **Recommendation:** The PR4 styling intentionally promoted the empty
  state to a "card with glyph + headline + body" — at the time the
  whole rail used a card-in-card framing. PR5's chrome inversion
  obsoleted that: the white message strip is now the canvas, and the
  empty state is just a centered version of that same canvas.
  Concretely: `background: var(--af-surface-alt)` →
  `var(--af-surface)`; `border: 1px solid var(--af-border)` → `none`;
  `border-radius: var(--af-radius)` → `0`. Keep the flex centering and
  the glyph + headline + body markup so the visual weight stays the
  same; only the chrome around them changes.
- **Outcome:** Empty state, loading state, and message feed share the
  same white canvas with no nested borders. The stethoscope glyph and
  `"Open a patient chart to begin."` copy now sit centered in the rail
  without inset chrome.

### Decision 3: Drop the manual textarea drag-resize gutter; replace with `useLayoutEffect` auto-grow capped by CSS `max-height`

- **Prompt:** *"the text area height doesn't need to be adjustable.
  It'll grow if the text the physician is typing exceeds the lines
  allowed, but to have that clickable and draggable interaction to
  change the height of the text area is not needed."*
- **Recommendation:** Two coupled changes are needed:
  (a) CSS — flip `resize: vertical` → `resize: none`, add
  `max-height: 12rem` and `overflow-y: auto` so very long pastes don't
  blow up the footer chrome and instead scroll inside the box;
  (b) React — add a `composeInputRef` and a `useLayoutEffect` keyed on
  `[handshake.status, input]` that resets `el.style.height = 'auto'`,
  reads `scrollHeight`, and sets the height to
  `min(scrollHeight, computed max-height)`. `useLayoutEffect` (not
  `useEffect`) avoids a one-frame flash of the wrong height between
  paint and the effect callback.
- **Trade-off considered:** CSS `field-sizing: content` would do the
  same job in one declaration. Rejected for now — Safari support is
  still patchy and operator browsers include older versions in
  iframe-restricted environments. The `useLayoutEffect` is ~10 lines
  and has zero browser variance.
- **Outcome:** The drag handle is gone; height tracks content up to
  12 rem and scrolls past that. The compose footer never grows beyond
  what the chrome bar can comfortably hold.

### Decision 4: Make Send + Start dictation share the compose-actions column 50/50 with `flex: 1 1 0`

- **Prompt:** *"For the send and start dictation buttons, make their
  heights fill the height of the container. Even if the text area
  grows in height, they always fill up and grow with it as well."*
- **Recommendation:** The layout chain was already 90 % there:
  `.agentforge-cui__form` is `display: flex; align-items: stretch`, so
  `.agentforge-cui__compose-actions` already stretches vertically to
  match the textarea's current height. The missing piece was telling
  each child button to claim half of that column. Add
  `flex: 1 1 0` to both `.agentforge-cui__send` and
  `.agentforge-cui__mic-btn`, plus `min-height: 2.5rem` so neither
  collapses below a clinically tappable target on first paint (when
  the auto-grow effect hasn't yet measured the textarea).
- **Outcome:** Send and Mic now share the right column 50/50 and grow
  vertically in lockstep with the textarea up to its 12 rem cap.

## Trade-offs and alternatives

- **Always render Refresh, even on no-chart.** Considered (Decision 1
  initial path). Rejected — the user explicitly asked to hide it
  because there is nothing to refresh yet; the visual consistency win
  was not worth a button that does nothing meaningful.
- **`min-height` on `.agentforge-cui__header` so the no-chart bar
  matches the with-button bar pixel-for-pixel.** Deferred — the user's
  follow-up screenshot showed the no-chart bar is acceptable as-is.
  Easy to layer in later if appetite emerges.
- **CSS `field-sizing: content` for the textarea.** Rejected for now
  (Safari + iframe-restricted browser support). Worth revisiting once
  Baseline support is broader.
- **`auto-resize-textarea`-style npm package.** Rejected — the
  10-line `useLayoutEffect` is smaller than the import path.
- **Keep `width: 100%` on the buttons after adding flex.** Kept as
  belt-and-suspenders. The flex column's default `align-items: stretch`
  already widens children, but the explicit `width: 100%` matches the
  rest of the codebase and survives any future tweak that introduces
  `align-items: center` on the actions column.

## Tools, dependencies, commands

- `cd agentforge/cui && npm run typecheck` — clean across all 4
  iterations.
- `cd agentforge/cui && npm run test` — 61 / 61 vitest cases passing;
  no test changes needed (the `aria-label` strategy in Decision 1
  preserves the existing `waitFor` regex).
- `cd agentforge/cui && npx vite build` — regenerated
  `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js`
  + `agentforge-cui-index.css` once per iteration so `panel.php`'s
  `md5_file()` cache-bust picks up the new bundle hash on next chart
  open. Bundle final sizes: 174.88 kB JS / 16.14 kB CSS (gzip 54.92 /
  3.23).
- `rm -f interface/modules/custom_modules/oe-module-agentforge/public/cui/index.html`
  — Vite still emits a stub `index.html` we don't ship; removed after
  each build.
- **No package installs** in this session.

## Files touched

- **Modified:** [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx)
  - Added `useLayoutEffect` import and `composeInputRef` for the
    textarea auto-grow effect.
  - Replaced the single `panelHeader` JSX expression with
    `renderPanelHeader(showRefresh: boolean)`.
  - Branched call sites: `error + isNoChart` →
    `renderPanelHeader(false)`; everything else →
    `renderPanelHeader(true)`.
  - Added the `useLayoutEffect` block that sizes the textarea to
    `min(scrollHeight, computed max-height)` on every input change.
  - Added a thin `reloadPanel()` helper for the non-ready Refresh
    button onClick.
- **Modified:** [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css)
  - `.agentforge-cui__empty` — flipped to `background: var(--af-surface)`,
    `border: none`, `border-radius: 0`. Updated the docblock to call
    out PR5 parity.
  - `.agentforge-cui__input` — `resize: vertical` → `none`; added
    `overflow-y: auto` + `max-height: 12rem`.
  - `.agentforge-cui__send` and `.agentforge-cui__mic-btn` — added
    `flex: 1 1 0` + `min-height: 2.5rem`. Added a docblock on
    `.agentforge-cui__send` explaining the column-fill rationale.
- **Regenerated by `vite build`:**
  - [`interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js)
  - [`interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css)
- **Created:** this journal entry.
- **No test files modified.** The decision to keep
  `aria-label="Refresh chart binding"` only on the ready branch was
  specifically to avoid disturbing
  `App.test.tsx`'s `waitFor(...{ name: /refresh chart binding/i })`
  handshake-ready synchronisation.

## Outcomes

- **Header parity across panel states.** Empty (`Open a patient chart
  to begin.`), loading (`Connecting…`), generic error (`Unable to
  start session.`), and ready (active chart) all render the same gray
  chrome bar with the title; Refresh is shown wherever a recovery
  action is meaningful and hidden on the chart-required empty branch.
- **Empty / loading states share the white message-strip canvas.** No
  inset card chrome (no border, no radius) — visual continuity with
  the active feed.
- **Textarea auto-grows; no manual drag handle.** Height tracks the
  number of wrapped lines up to a 12 rem cap, then scrolls inside the
  box.
- **Send + Mic fill the compose column.** Both buttons split the
  available column height 50/50 and grow with the textarea up to the
  12 rem cap, with a 2.5 rem floor on first paint.
- **All 61 vitest cases green; typecheck clean; no lints introduced.**
- **Bundle hashes change → `panel.php` cache-bust serves the new bundle
  on next chart open.** No operator-side hard reload required (per the
  G6-16 cache-bust mechanism documented in the prior journal).

## Next steps

- [ ] **Operator: hard-refresh once on the production tab** if you have
      an open Copilot panel from before the redeploy — subsequent
      operators inherit the new bundle through the URL hash.
- [ ] **Stage + commit the CUI polish bundle as a single atomic
      commit.** Suggested message:
      `feat(agentforge/cui): polish post-PR5 — header parity, white empty canvas, auto-grow compose, flex-fill action buttons`.
      Diff scope: `agentforge/cui/src/App.tsx`,
      `agentforge/cui/src/index.css`, the two regenerated bundles in
      `interface/modules/custom_modules/oe-module-agentforge/public/cui/`,
      and this journal entry.
- [ ] **Consider `field-sizing: content` follow-up.** When Safari /
      iframe-restricted browsers cross 100 % Baseline, swap the
      `useLayoutEffect` auto-grow for the one-line CSS declaration
      and delete the `composeInputRef`. Until then, the React effect
      is the safe path.
- [ ] **Optional: add a vitest case pinning the
      `no_chart` → no-Refresh-button shape.** A 5-line test that
      renders `App` with a no-chart handshake and asserts
      `screen.queryByRole('button', { name: /refresh/i })` is `null`
      would prevent a future regression where someone re-adds Refresh
      to all branches "for consistency". Not blocker for this commit.

## Links

- Prior session journal (PR5 chrome inversion + author / message
  redesign — captured in chat summary, not yet a standalone entry):
  see chat transcript context for design decisions PR1–PR5.
- Cache-bust mechanism that ships the new bundle to warmed tabs:
  [`./0501-T1557-brief-cache-bust-stale-bundle.md`](./0501-T1557-brief-cache-bust-stale-bundle.md).
- Patched panel root component: [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx).
- Patched CUI stylesheet: [`agentforge/cui/src/index.css`](../../../../../agentforge/cui/src/index.css).
