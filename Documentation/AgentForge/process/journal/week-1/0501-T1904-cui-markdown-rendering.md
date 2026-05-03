---
date: 2026-05-01
topic: Render Markdown in assistant prose surfaces of the CUI rail (text + claim segments + warning + auto-brief), Cursor/Claude-style
related_prior_journal: ./0501-T1838-cui-panel-polish-header-empty-textarea-buttons.md
related_task_list: ../../../../../TASKS.md
---

# CUI Markdown rendering — readable assistant prose for a busy clinician

## Goal

Stop the rail from showing literal `**` and `###` in agent replies. The user
wanted the Markdown the model already emits to render as structure (bold,
headings, lists, tables) the way Cursor and Claude do — across **every**
assistant-authored surface, including the auto-delivered case brief, so a
busy physician can scan section titles instead of reading punctuation.
Operator framing: *"as clean as possible and as robust across all message
types that the agent sends."*

## Context

Pre-session state:

- [agentforge/cui/src/chat/MessageList.tsx](../../../../agentforge/cui/src/chat/MessageList.tsx)
  rendered all assistant `text` and `claim` content as React string children.
  `displayAssistantText` only stripped a legacy `One-liner:` prefix; no
  Markdown pipeline existed.
- The system prompt and case-presentation prompt produced JSON envelopes with
  Markdown-style emphasis inside `text` strings, which the rail then surfaced
  as literal punctuation.
- The CUI ships in a sandboxed iframe inside `panel.php`; raw HTML from the
  model is a real safety concern, and `eslint.config.js` already bans
  `dangerouslySetInnerHTML` on that surface (G2-10).

## Key decisions

### Decision: Formatting belongs in the CUI, not in `verifyClinicalBlocks`

- **Prompt:** *"Can we have some mechanism inside whatever is our final
  validation of agent messages to include the proper formatting…"*
- **Recommendation:** Keep `verifyClinicalBlocks`
  ([agentforge/api/src/agent/orchestrator.ts](../../../../agentforge/api/src/agent/orchestrator.ts))
  focused on clinical integrity (claims, citations, evidence). Markdown is a
  **presentation** concern — render it once in the rail so the same model
  output reads identically in chat turns and the auto-brief, without
  rewriting bytes mid-pipeline or expanding the block schema with a
  `format` flag.
- **Outcome:** No server-side block transform. Single rendering point added
  in [agentforge/cui/src/chat/AssistantMarkdown.tsx](../../../../agentforge/cui/src/chat/AssistantMarkdown.tsx).

### Decision: `react-markdown` + `remark-gfm` + `rehype-sanitize` over a micro-renderer

- **Prompt:** Asked the user to choose between (a) full library, (b) tiny
  in-house regex renderer, (c) library without GFM.
- **Recommendation:** Library route — robustness on weird model output
  (nested lists, fenced code, tables, autolinks) and GitHub-style sanitize
  defaults (which already block `<script>`, unsafe URL protocols, and
  `<img onerror=…>`) outweigh the bundle cost. Production build came in at
  338 KB / 105 KB gzipped, acceptable for a chat surface.
- **Outcome:** Three deps installed; gzipped bundle within budget; no
  custom regex parser to maintain.

### Decision: Markdown only on assistant-authored prose, not user bubbles or proposal previews

- **Prompt:** Same selection — operator chose the "all assistant prose"
  scope (text + claim segments + warning text).
- **Recommendation:** User bubbles must render literal text so a clinician's
  typed `**` survives intact (clinical free-text is not a markup language).
  `proposal.preview` is a deterministic chart-write summary — Markdown there
  could create misleading emphasis on a write that's about to land in the
  EHR. `refusal.reason` is a machine code (`blocked_cross_patient_tool_args`),
  not prose. Everything else (text, claim text segments, claim legacy text,
  warning text) gets Markdown.
- **Outcome:** [renderBlock in MessageList.tsx](../../../../agentforge/cui/src/chat/MessageList.tsx)
  branches on `assistantMessage === true` for exactly those four call sites;
  user / proposal / refusal / tool blocks untouched.

### Decision: Inline mode unwraps block-level Markdown via `disallowedElements` + `unwrapDisallowed`

- **Prompt:** *(implementation pivot — claim text segments and warning text
  render inside an existing `<p>` or `<button>`; nesting block-level
  Markdown there is invalid HTML.)*
- **Recommendation:** Two render modes in [AssistantMarkdown.tsx](../../../../agentforge/cui/src/chat/AssistantMarkdown.tsx):
  block (`<div>` wrapper, full schema) and inline (`<span>` wrapper plus
  `disallowedElements` for `p, h1-h6, ul, ol, li, blockquote, hr, pre,
  table, …` with `unwrapDisallowed: true`). Block Markdown that appears
  inline (e.g. a stray `### inside a claim`) degrades to its inline children
  rather than breaking layout.
- **Outcome:** Claim text segments inside `<p>`, warning text inside the
  alert chrome, and citation-button labels all accept inline Markdown
  without producing nested `<p>` or `<div>` errors.

### Decision: Demote `# Title` and `## Subtitle` to `<h3>`/`<h4>` so model output can't out-shout the panel chrome

- **Prompt:** *(design pivot — the rail iframe is narrow and the panel
  header already owns the largest type.)*
- **Recommendation:** `components` overrides in
  [AssistantMarkdown.tsx](../../../../agentforge/cui/src/chat/AssistantMarkdown.tsx)
  remap `h1 → h3` and `h2 → h4`. Sanitize schema also strips `img, picture,
  source, input, details, summary, section, div` from GitHub defaults so the
  model can't render a giant photo or open a `<details>` payload inside the
  rail. Anchor override forces `target="_blank" rel="noopener noreferrer"`
  to prevent tab-nabbing out of the OpenEMR shell.
- **Outcome:** A model-emitted `# Top of brief` becomes a section-sized
  `<h3>`, never an iframe-dominating banner. `<a href="javascript:...">`
  is dropped by `defaultUrlTransform`.

### Decision: Steer prompts toward Markdown headings without changing the block schema

- **Prompt:** *"…so it shows the markdown syntax as a readable preview"* +
  the brief should benefit too.
- **Recommendation:** Update
  [system_prompt.ts](../../../../agentforge/api/src/agent/system_prompt.ts)
  to permit Markdown inside `text` block strings (envelope still must not
  be Markdown-fenced) and update
  [case_presentation_prompt.ts](../../../../agentforge/api/src/agent/case_presentation_prompt.ts)
  to specify `### Interval`, `### Objective`, `### Problems & meds`,
  `### Allergies`, `### Visit topics` instead of bare `"Interval:"` labels.
  Claim blocks stay plain prose so cited phrases remain legible.
- **Outcome:** No schema migration needed; the rail already renders Markdown
  inside `text` fields. Cached briefs from before this change render with
  Markdown automatically because the cache stores blocks, not rendered HTML.

### Decision: Tighten the existing XSS test now that sanitize fully drops the dangerous tag

- **Prompt:** *(test failure on first run — old test expected the literal
  `<img src=x onerror=alert(1)>` string to survive as visible text.)*
- **Recommendation:** Behavior changed for the better: rehype-sanitize
  drops the `<img>` entirely (not in our allow-list) instead of escaping
  it as text. Replace the old assertion with stronger guarantees — no
  `<img>` element, no `onerror` attribute anywhere in `innerHTML`, no
  `alert(1)` text — and add a mirrored assertion that user bubbles still
  surface the literal payload (because user input bypasses Markdown).
- **Outcome:** Both assertions pass; XSS surface is strictly smaller than
  before.

## Trade-offs and alternatives

- **Render Markdown server-side and ship pre-rendered HTML** — would let the
  server normalize formatting once, but reintroduces an HTML sanitization
  surface in the JSON envelope and forces every consumer (CUI, future
  mobile, future logs) to deal with HTML. Skipped.
- **Add a `format: 'markdown'` flag to the block schema** — nominally
  cleaner, but Markdown inside an existing `text` field is fully
  backward-compatible with consumers that render it as plain text.
  Skipped to avoid a schema migration for a presentation tweak.
- **Bundle `rehype-highlight` for code syntax highlighting** — physicians
  rarely see code blocks; the extra ~50 KB is not worth it. Code blocks
  render plain monospace.
- **Allow Markdown in `proposal.preview`** — operationally risky (bold on
  a chart-bound action could mislead the consenting clinician). Kept
  literal.

## Tools, dependencies, commands

- `cd agentforge/cui && npm install react-markdown remark-gfm rehype-sanitize --save`
  — installed `react-markdown ^10.1.0`, `remark-gfm ^4.0.1`,
  `rehype-sanitize ^6.0.0`. **Gotcha (same as the prior G6-15 install):** the
  shell tool's `working_directory` parameter was silently ignored on the
  first attempt and the install landed in the OpenEMR root `package.json`.
  Reverted root `package.json` + `package-lock.json` and re-ran with explicit
  `cd` in the command itself. The 02 changelog already documents this
  gotcha; this session is a second confirmation.
- `cd agentforge/cui && npx vitest run` — 72 / 72 pass (10 test files).
- `cd agentforge/cui && npx tsc --noEmit` — clean.
- `cd agentforge/cui && npx vite build` — 338.87 KB / 104.78 KB gzipped JS,
  18.05 KB / 3.49 KB gzipped CSS.
- `cd agentforge/api && npx vitest run test/agent` — 59 / 59 pass after
  prompt edits.
- Pre-existing API typecheck errors in unrelated test files
  (`test/http/health-and-correlation.test.ts`,
  `test/stt/transcribe.assemblyai.test.ts`,
  `test/transcripts/store.test.ts`) confirmed by `git stash` ↔ `tsc`
  comparison; not introduced by this session.

## Files touched

- **Created:**
  - `agentforge/cui/src/chat/AssistantMarkdown.tsx`
  - `Documentation/AgentForge/process/journal/week-1/0501-T1904-cui-markdown-rendering.md`
- **Modified:**
  - `agentforge/cui/package.json` (+3 runtime deps)
  - `agentforge/cui/package-lock.json`
  - `agentforge/cui/src/chat/MessageList.tsx` — wired `<AssistantMarkdown>`
    into the `text`, `claim` segments, `claim` legacy, and `warning` paths
    behind `assistantMessage === true`
  - `agentforge/cui/src/chat/MessageList.test.tsx` — tightened XSS test;
    added 11 assertions covering bold / heading / list rendering, h1
    demotion, user-bubble literals, claim-segment Markdown, warning
    Markdown chrome, `javascript:` URL stripping, link target/rel safety,
    and `One-liner:` strip-then-Markdown ordering
  - `agentforge/cui/src/index.css` — new `.agentforge-msg__md` block tied
    to existing `--af-*` tokens (quiet headings, tight lists, code chips,
    GFM tables, edge-spacing reset)
  - `agentforge/api/src/agent/system_prompt.ts` — Markdown permitted
    inside `text` block strings; envelope-fence rule preserved
  - `agentforge/api/src/agent/case_presentation_prompt.ts` — section
    labels switched from `"Interval:"` to `### Interval` (etc.); claim
    bodies stay plain prose
  - `Documentation/AgentForge/process/02-tooling-and-skills.md` —
    changelog bullet for the three new CUI deps
- **Deleted:** _None this session._

## Outcomes

- Every assistant-authored prose surface in the rail (text blocks, claim
  text segments, warning text, auto-brief) now renders Markdown as
  structure: `**bold**` is bold, `### Heading` is a small section title,
  `-` becomes a bullet list. User bubbles still render literal text.
- The auto-brief specifically benefits: `### Interval`, `### Objective`,
  etc., make a busy clinician's first scan of the brief skim heading-first.
- Citation buttons, navigation, and proposal cards are untouched — Markdown
  never sees a `cite` segment label, a write target, or a refusal code.
- XSS surface is strictly smaller than before: rehype-sanitize drops
  `<img>`, `<iframe>`, `<script>`, raw HTML embeds, and `javascript:`
  URLs; the eslint ban on `dangerouslySetInnerHTML` is unchanged
  (react-markdown does not need it).
- 72 CUI tests + 59 agent API tests + 0 typecheck errors (CUI-side) +
  successful production build.

## Next steps

- [ ] Operator: visually QA the rail against a real chart — confirm the
      auto-brief headings read at a glance and bold drug names in claims
      look right at the rail's narrow widths (320–600 px).
- [ ] Optional: if the model's Markdown output trends toward inconsistency
      across providers (Anthropic vs Azure OpenAI), tighten the prompt
      heading list to a single canonical set rather than the current
      "preferred" labels.
- [ ] Optional polish: consider a `--af-text-md-strong` token so bold
      weight in Markdown can drift from the body `<strong>` weight without
      a CSS-rule edit.
- [ ] Operator: commit the working tree (per repo policy, not done in
      this session).

## Links

- Prior journal: [0501-T1838-cui-panel-polish-header-empty-textarea-buttons.md](./0501-T1838-cui-panel-polish-header-empty-textarea-buttons.md)
- Component: [agentforge/cui/src/chat/AssistantMarkdown.tsx](../../../../agentforge/cui/src/chat/AssistantMarkdown.tsx)
- Render wiring: [agentforge/cui/src/chat/MessageList.tsx](../../../../agentforge/cui/src/chat/MessageList.tsx)
- Prompts: [agentforge/api/src/agent/system_prompt.ts](../../../../agentforge/api/src/agent/system_prompt.ts) · [agentforge/api/src/agent/case_presentation_prompt.ts](../../../../agentforge/api/src/agent/case_presentation_prompt.ts)
