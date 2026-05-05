---
date: 2026-05-04
topic: Clinical Copilot favicon + OG card + comprehensive head, plus a CUI Cal Sans experiment that ended in revert
related_milestone: none
---

# Branding bundle and CUI typography — session journal

## Goal

Instructor feedback session called out the lack of a custom favicon and a polished social card on the demo VPS. Goal: ship a complete, modern favicon set + a 1200×630 OG card + a "highest-standards" `<head>` (favicon links, Open Graph, Twitter Card, JSON-LD) for the Clinical Copilot deployment, drafted to read as a production product rather than a Gauntlet program submission. Secondary: explore using the favicon's display font (Cal Sans) on CUI brand surfaces.

## Context

The CUI lives inside an OpenEMR-served iframe and previously inherited OpenEMR's default favicon. Instructor specifically flagged "meta and OG fields" — meaning the modern favicon set + its supporting `<head>` tags + OG/Twitter tags so the demo URL renders as a polished card when shared in Slack/Discord/iMessage. Treat the meta+OG ask as two related but distinct deliverables.

## Key decisions

### Decision: Reframed "meta and OG fields" as two related deliverables, not one

- **Prompt:** "He made a note about meta and OG fields for this favicon. I have no idea what that means..."
- **Recommendation:** Distinguished (1) the modern favicon link/meta bundle (icon, apple-touch-icon, mask-icon, manifest, theme-color) from (2) Open Graph + Twitter Card unfurl tags + a 1200×630 social image. Both have to ship together for the asset to look like a real product when shared or pinned.
- **Outcome:** Established the asset list before any design work — became the scope contract for the rest of the session.

### Decision: Adopted user-authored favicon (`cc-favicon.svg.svg`) as the canonical master

- **Prompt:** "OK, I made a favicon myself. The file is inside the project repo already: cc-favicon.svg. Go ahead and create all the assets that we need based off of this favicon. Everything should be downstream from this design, not the old design that you had."
- **Recommendation:** Abandoned my prior arc-based stylized C's and adopted the user's letterform "CC" (two real Cal Sans glyphs on a navy plate). Frontend designer shipping their own letterforms is a stronger result than my procedurally-drawn shapes.
- **Outcome:** [`cc-favicon.svg.svg`](../../../../../cc-favicon.svg.svg) at repo root is the source; everything else in the bundle is derived from it.

### Decision: Comprehensive bundle scope (Apple/Android/PWA/Microsoft/OG/JSON-LD)

- **Prompt:** "Be comprehensive about all the requirements you have here, with the Apple Touch icon, the mask icon, manifest everything, and be thorough."
- **Recommendation:** Generated the full modern asset set (16 PNG variants + ICO + 5 SVGs + 1200×630 OG) plus a comprehensive `head-snippet.html` covering favicon links, iOS PWA hints, Safari mask-icon, Microsoft tile, web manifest, Open Graph (with `secure_url`, `type`, `width`, `height`, `alt`), Twitter Card, and JSON-LD (`SoftwareApplication` + `MedicalAudience`).
- **Outcome:** 23 files in [`interface/modules/custom_modules/oe-module-agentforge/public/branding/`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/branding/) — committed in `603d809c0`.

### Decision: OG card copy reframed as production positioning, not program credit

- **Prompt:** "the 'built for AgentForge cohort one' I don't want it to be so tied down to the Gauntlet program... How would you market a live version of this to hospitals and physicians..."
- **Recommendation:** Replaced "AI documentation assistant, embedded in OpenEMR." + "BUILT FOR AGENTFORGE · COHORT 1" with outcome-led "Less time charting. More time with patients." + "BUILT FOR CLINICIANS · POINT OF CARE." Mirrored copy across all `<title>` / `meta description` / `og:*` / `twitter:*` / JSON-LD `description`. Visual fixes in the same pass: darker bg gradient and `feDropShadow` filter on the plate so the favicon has visible elevation, plus shorter tagline so it ends with comfortable right padding.
- **Outcome:** [`og-image.svg`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/branding/og-image.svg) and [`head-snippet.html`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/branding/head-snippet.html) read as a real product launch instead of a class submission.

### Decision: Cal Sans on CUI — targeted display token, then full revert for readability

- **Prompt:** First "I'm curious what font we're using within the CUI..." → later "I actually decided I don't like it in the UI. The text is not very readable, especially at that size."
- **Recommendation:** Initially recommended option 2 — add a `--af-font-display` token (Cal Sans + Lato fallback) and apply only to three brand-touching selectors (`.agentforge-cui__title`, `.agentforge-cui__subtitle`, `.agentforge-cui__empty-title`); leave chat/proposal/alert body text on Lato (`--af-font`). Cal Sans is a single-weight (SemiBold) display font: works at OG-card sizes but suffers at 14–16px UI scale. After implementation, user evaluated and reverted on readability grounds.
- **Outcome:** Net CUI change = none. `@fontsource/cal-sans` installed then uninstalled, all source edits backed out, rebuild dropped 6 woff/woff2 files via `emptyOutDir: true`. Confirms Cal Sans is right for *brand* surfaces (favicon, OG) but not for in-product UI.

### Decision: Vite base-path fix (kept independently of the Cal Sans revert)

- **Prompt:** "I rebuilt the CUI and cleared cache in a new tab, and still nothing."
- **Recommendation:** Diagnosed that the built CSS emitted `@font-face url(/cal-sans-*.woff2)` (root-relative), but the bundle is served from `/interface/modules/custom_modules/oe-module-agentforge/public/cui/`. Browser fetched at `/`, got 404, silently fell back to Lato — this would also break ANY future Vite-emitted asset URL (chunked JS, additional fonts, CSS-referenced images). Set Vite `base` for `vite build` to the deployment prefix; dev (`vite serve`) keeps `/`. Conditional via `defineConfig(({ command }) => ...)`.
- **Outcome:** [`agentforge/cui/vite.config.ts`](../../../../../agentforge/cui/vite.config.ts) emits asset URLs at the correct deployment path. Bug pre-dated this session — discoverable only because Cal Sans was the first imported asset that had a non-source-relative URL. Fix retained after the Cal Sans revert because it's an orthogonal production correctness improvement.

## Trade-offs and alternatives

- **Inkscape vs librsvg + ImageMagick** for SVG → PNG → ICO pipeline — went with `rsvg-convert` (cleaner SVG rendering than ImageMagick's built-in SVG support) + `magick` (ICO multi-resolution assembly).
- **Vite `base: './'` (relative URLs) vs absolute deployment prefix** — picked absolute. Relative would have been more portable across subpath deployments but breaks chunked JS imports if Vite ever splits the bundle.
- **Cal Sans body-wide vs tokenized display vs none** — Cal Sans body-wide rejected (single-weight, kills body hierarchy); display token tried then reverted; Lato-only is the final state.
- **Inline-SVG OG image vs PNG-only** — shipped both (`og-image.svg` as source, `og-image.png` as the served asset) so future copy/layout edits don't require re-rasterization tooling.

## Tools, dependencies, commands

- `brew install librsvg imagemagick` — SVG rasterization (`rsvg-convert`) and multi-resolution ICO assembly (`magick`). Permanent on the dev machine.
- `brew install --cask font-cal-sans` — Cal Sans (`~/Library/Fonts/CalSans-SemiBold.otf`) for fontconfig-driven SVG text rendering. Permanent.
- `cd agentforge/cui && npm install @fontsource/cal-sans` then `npm uninstall @fontsource/cal-sans` — net zero on package.json/lock. The explicit inline `cd` matters; per the recurring `working_directory` lesson, omitting it leaks the install into the OpenEMR root `package.json`.
- `rsvg-convert -w <px> -h <px> <in.svg> -o <out.png>` — single command per PNG variant.
- `magick favicon-16.png favicon-32.png favicon-48.png favicon.ico` — ICO assembly.
- `cd agentforge/cui && npm run build` — rebuilds the CUI bundle (run twice this session: once with Cal Sans, once after revert).

## Files touched

- **Created (kept):**
  - `cc-favicon.svg.svg` — user's source design at repo root
  - `interface/modules/custom_modules/oe-module-agentforge/public/branding/` — full directory: `favicon.{svg,ico}`, `favicon-{16,32,48,96}.png`, `apple-touch-icon{,-120,-152,-167}.png`, `android-chrome-{192,512}.png`, `maskable-icon-{192,512}.png`, `maskable-icon.svg`, `mask-icon.svg`, `mstile-150.png`, `og-image.{svg,png}`, `site.webmanifest`, `browserconfig.xml`, `head-snippet.html`
- **Modified (kept):**
  - `agentforge/cui/vite.config.ts` — conditional `base` for `vite build`
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css` — rebuilt CSS with corrected asset URLs
- **Touched then reverted (net none):**
  - `agentforge/cui/src/main.tsx` — Cal Sans import added/removed
  - `agentforge/cui/src/index.css` — `--af-font-display` token + 3 selector applications added/removed
  - `agentforge/cui/package.json`, `package-lock.json` — `@fontsource/cal-sans` added/removed
  - `interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-cal-sans-*.woff{,2}` — 6 build artifacts shipped in `c500e1821`, dropped on rebuild

## Outcomes

The Clinical Copilot demo has a real brand identity: a custom favicon (with proper iOS / Android / Safari / Windows variants), a polished 1200×630 OG card with production-quality copy, and a complete `<head>` reference snippet ready to drop into the OpenEMR template. The CUI ships unchanged (Lato), but a previously-unknown Vite base-path bug that would have broken any future emitted asset URL is now fixed. Two commits already pushed (`603d809c0`, `c500e1821`); a third lands the CUI revert.

## Next steps

- [ ] Wire `head-snippet.html` into OpenEMR's main HTML head template (separate session — it's a deployment-affecting change to the global app chrome).
- [ ] Decide whether to keep `cc-favicon.svg.svg` at the repo root or move it under `branding/sources/`.
- [ ] If the demo URL ever moves to a custom domain, find/replace `https://108-61-145-220.nip.io` in `head-snippet.html`.
- [ ] Refresh demo VPS deployment to pick up the new branding (if/when wiring lands).

## Links

- Numbered milestone (if any): _none — branding is not yet on the milestone trail._
- Branding folder: [interface/modules/custom_modules/oe-module-agentforge/public/branding/](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/branding/)
- Tooling changelog bullet: [process/milestones/week-1/02-tooling-and-skills.md](../../milestones/week-1/02-tooling-and-skills.md)
