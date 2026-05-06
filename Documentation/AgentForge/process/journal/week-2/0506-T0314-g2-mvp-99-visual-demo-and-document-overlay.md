---
date: 2026-05-06
topic: G2-MVP-99 visual demo wiring (CUI integration) + post-MVP G2-Final-31 host-rendered document overlay
related_milestone: process/milestones/week-2/03-g2-mvp-execution.md
---

# G2-MVP-99 visual demo wiring + G2-Final-31 host overlay — session journal

## Goal

Take the W2 CUI from "API smoke verified, visual integration unwired" (the state [`0505-T1726`](0505-T1726-g2-mvp-execution-and-api-smoke.md) handed off) to "operator-driven demo recorded against the canonical MVP question." Then, post-submission, finish G2-Final-31: a document preview overlay that sits over both the OpenEMR shell and the CUI rail without disturbing either layout.

## Context

Came in on top of the G2-MVP-58 API smoke green from the prior session. Three options were on the table for closing the MVP gate; the visual demo path (Option B in the prior journal) was chosen explicitly. ~5h45m to MVP submission at session start; demo video was uploaded successfully before midnight, then the session continued through the small hours into post-MVP polish for the G2-Final-31 document overlay.

## Key decisions

### Decision: Option B over Option A — wire CUI tonight rather than ship the API smoke as the MVP demo

- **Prompt:** "I have an error has occurred text appearing in place of my CUI, so I think B is probably best for us to wire the CUI up tonight and get the upload journey complete for the demo."
- **Recommendation:** Diagnose the rail's `An error has occurred` first (blocker before any CUI work could even render), then push through the integration: file picker, attach-then-upload-then-chat sequencing, extraction block emission from the orchestrator, IntakeProposalCard rendering, citation modal. Wire the smallest-coherent surface and document the rest as deferred.
- **Outcome:** [`AppointmentEncounterBinder::requireEncounterEvents()`](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php:292) now also `require_once`s `forms.inc.php` so `addForm()` is in scope when `todaysEncounterCheck()` auto-creates the encounter for an empty-chart W2 cohort patient. CUI integration landed across `App.tsx`, `MessageList.tsx`, `client.ts`, plus a new `extraction` ChatBlock type in [`agentforge/api/src/openemr/types.ts:138`](../../../../../agentforge/api/src/openemr/types.ts:138). Demo recorded and submitted before midnight CT.

### Decision: preserve existing design language — user feedback corrects a regression I caused

- **Prompt:** "You change the entire design of the bottom footer area … I didn't think we needed to change the existing design. All we needed to do was add the plus button within the text area."
- **Recommendation:** Saved the lesson as a feedback memory ([`feedback_preserve_existing_design_language.md`](../../../../../../.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/feedback_preserve_existing_design_language.md)) and reverted the textarea+Send+MicControl form to the original layout. The W2 standalone `Composer.tsx` was abandoned — file-attach state moved into `App.tsx` directly (`+` button + drag-drop + AttachmentPreview compact-variant chip, all positioned absolute inside the textarea wrap, mutually exclusive with the chip when a file is staged).
- **Outcome:** Composer JSX in [`agentforge/cui/src/App.tsx:711`](../../../../../agentforge/cui/src/App.tsx:711) restored to the prior shape with one minimum-diff inline change. Same correction principle re-applied later when the user flagged that the W2 `IntakeProposalCard`'s ad-hoc styling diverged from W1's `ProposalBlock` chrome — extracted [`ProposalCardShell.tsx`](../../../../../agentforge/cui/src/chat/ProposalCardShell.tsx) so both consumers (W1 single-target writes, W2 intake) share one set of accent borders, status pills, and button rows. Renamed user-visible "Decline" → "Reject" everywhere the shell renders.

### Decision: G2-Early-27 lab summary auto-write — pulled forward, then rolled back at 25 min to deadline

- **Prompt:** "I'm also leaning towards pulling forward the G2 early 27 write the lab summary so we can actually execute on the aspirational demo you described, which seems perfect."
- **Recommendation:** Architecturally: orchestrator detects successful `attach_and_extract` for `doc_type='lab_pdf'` → calls `insertPendingProposal` directly with `write_target='clinical_note'` and a formatted body (no LLM round-trip) → emits a `proposal` ChatBlock. Reuses existing W1 `propose_clinical_note_write` infrastructure; same `pending_proposals` row shape, same `/conversations/:id/confirm` endpoint applies it.
- **Outcome:** Code shipped in [`agentforge/api/src/agent/orchestrator.ts`](../../../../../agentforge/api/src/agent/orchestrator.ts) (helper `maybeBuildLabSummaryProposal` + `formatLabSummaryNoteBody`). On Confirm the W1 PHP catch-all in `ClinicalNoteWriteAction::execute()` returned `"write failed"` — debugging the underlying `ClinicalNotesService` exception in 25 min was higher risk than rolling back the live write. Auto-emit was gated off; the helper code was preserved for the proper G2-Early-27 fix later. Replaced with an *informational* `ProposalCardShell` rendered from a new `extraction.lab_summary` field — no Confirm/Reject buttons, status pill explicitly cites the deferred task ("Captured. Chart writes scheduled for next iteration (G2-Early-27)."). Same honest treatment was applied to the intake card.

### Decision: iframe sandbox tokens — left-click citations weren't opening URLs

- **Prompt:** "If I just click the link as it's presented, nothing happens. It's being blocked for some reason."
- **Recommendation:** The `<iframe sandbox>` attribute on the rail container in [`rail_container.html.twig:15`](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig:15) had `allow-scripts allow-same-origin allow-forms` — anything not in the token list is blocked. `target="_blank"` anchor clicks are blocked unless `allow-popups` (and `allow-popups-to-escape-sandbox` so the new tab gets a normal browsing context) are present. Right-click → "Open in new tab" worked because that's a browser-driven action that bypasses the sandbox.
- **Outcome:** Added `allow-popups allow-popups-to-escape-sandbox` to the sandbox attribute. Inline guideline citations in `MessageList` now render as native `<a target="_blank" rel="noopener noreferrer">` (in both the multi-segment and single-cite-id branches) instead of buttons calling `window.open` — the latter was being silently swallowed in some Chromium configurations even with the right sandbox. Demo's "click guideline citation → opens USPSTF/ADA URL in new tab" loop verified live.

### Decision: G2-Final-31 architecture — host-rendered overlay over expand-the-iframe

- **Prompt:** "when it goes full screen, the CUI also goes full screen behind it, which is very jarring and should not be the case. I should be able to see the openEMR UI on the left and my CUI on the right, with the document modal overlaid on top of both of them."
- **Recommendation:** First attempt (rejected) used a `AGENTFORGE_RAIL_FULLSCREEN` postMessage that toggled `position: fixed; inset: 0` on the rail container — modal worked, but the entire CUI rail visibly took over the screen behind it AND surfaced a pdfjs second-open bug (cached `Uint8Array` had its underlying buffer transferred to the worker on first load → second `getDocument({data})` saw a detached buffer and rendered blank). Second attempt: the CUI just postMessages `AGENTFORGE_OPEN_DOCUMENT_OVERLAY` with a fully-resolved bytes URL, and the host shell renders an overlay div directly in the OpenEMR `<body>` — sits on z-index 99999 above everything, OpenEMR + rail layouts stay completely undisturbed underneath the dim backdrop.
- **Outcome:** [`rail_container.html.twig`](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) now defines `openDocumentOverlay()` / `closeDocumentOverlay()` host functions and `.agentforge-document-overlay__*` CSS. CUI's `App.tsx` `onOpenDocument` posts the message; the in-CUI `DocumentModal` component is preserved as a Vitest fixture but no longer mounted by App.tsx. TASKS.md G2-Final-31 closed; full architecture reasoning recorded there.

### Decision: custom pdfjs viewer (stacked-canvas scroll) over Chrome's embedded PDF plugin

- **Prompt:** "The PDF Viewer that's native to the browser is a little bit glitchy on scrolling … Is there a better way to implement this to fix that problem?"
- **Recommendation:** Built [`agentforge/cui/public/document-viewer.html`](../../../../../agentforge/cui/public/document-viewer.html) — a ~120-line standalone page that loads pdfjs-dist v5 (copied as a sibling static asset), fetches the bytes URL same-origin, renders every PDF page as a stacked `<canvas>` in a scrollable div with `scroll-behavior: smooth`. PNG/JPEG branches to inline `<img>` rendering through the same scroll container. The host overlay's iframe `src` becomes `viewer.html?file=<bytes_url>&page=N`. HTML-native scroll is consistent across browsers and isolates us from PDFium's iframe-nested quirks.
- **Outcome:** Smooth scroll confirmed live. Image support (PNG/JPEG via Content-Type branching) added in the same viewer — the cohort's phone-photo intake forms (Reyes, Kowalski) render through the same flow as the Chen/Whitaker PDFs.

### Decision: Vite publicDir relocation — viewer assets survive future bundle rebuilds

- **Prompt:** "we have this new bug now that makes the file (pdf or png) does not show up. what happened when we made this recent change? it was just working and now it says Not found"
- **Recommendation:** Diagnosed: [`vite.config.ts`](../../../../../agentforge/cui/vite.config.ts) has `emptyOutDir: true` on the build output (`interface/modules/.../public/cui/`). Every `npm run build` wipes the dir before emitting fresh bundle output, so the manually-placed `document-viewer.html` and `pdf.min.mjs` got nuked by the next CUI rebuild. Iframe `src` then 404'd → "Not found" + tiny iframe.
- **Outcome:** Created [`agentforge/cui/public/`](../../../../../agentforge/cui/public/) (Vite's default `publicDir`); moved both files there. Vite copies that folder verbatim into `outDir` on every build, so the static assets are now part of the bundle pipeline and survive future rebuilds. Verified: post-rebuild `ls` of the deployed module dir shows both files alongside the fresh JS/CSS.

## Trade-offs and alternatives

- **Pulling intake-section per-section writes forward (G2-Early-26)** — rejected. Three of five intake sections (medications add, family-history add, demographics update) need new write tools that don't exist yet; partial wire-up would have been a bigger lie than the honest "Captured. Chart writes scheduled…" status pill.
- **pdfjs-dist's bundled `web/viewer.html`** — abandoned. v5 ships `pdf_viewer.mjs` (a programmatic API for building a viewer) but no longer ships a turnkey `viewer.html`. Writing the minimum viable viewer from scratch was simpler than assembling the v5 components.
- **Expand-the-iframe variant for the document overlay** — first attempt; rejected by user as visually jarring.
- **`window.open(blob_url)` as the in-tab fallback** — kept transiently, then removed when the proper host overlay made it redundant.

## Tools, dependencies, commands

- `cp agentforge/cui/node_modules/pdfjs-dist/build/pdf.min.mjs agentforge/cui/public/pdf.min.mjs` — Vite publicDir copy.
- `cd agentforge/cui && npm run build` — verifies publicDir contents land in the deployed module dir.
- `TZ=America/Chicago date +"%m%d-T%H%M"` — journal-filename timestamp (per skill rules).
- Bundle hashes captured at handoff points: `c728a9de…` (host-overlay first land), `73892d4e…`, `a1130fe7…`, then post-MVP iterations.

## Files touched

- **Created:**
  - `agentforge/cui/src/chat/ProposalCardShell.tsx` (shared chrome for W1 + W2 proposal cards)
  - `agentforge/cui/src/citations/pdfjs.ts` (shared pdfjs loader with worker URL)
  - `agentforge/cui/public/document-viewer.html` (host-overlay PDF + image viewer)
  - `agentforge/cui/public/pdf.min.mjs` (copied from node_modules; Vite publicDir)
  - `Documentation/AgentForge/process/journal/week-2/0506-T0314-g2-mvp-99-visual-demo-and-document-overlay.md` (this file)
  - `~/.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/feedback_preserve_existing_design_language.md`
- **Modified (CUI):**
  - `agentforge/cui/src/App.tsx` (Composer integration, attachment state, onOpenDocument postMessage, restore-original-layout pivot)
  - `agentforge/cui/src/api/client.ts` (postUploadDocument; postChat now accepts docref_uuid + doc_type)
  - `agentforge/cui/src/chat/MessageList.tsx` (extraction block render, suppressDuplicateProposalNarration extension, citation `<a target=_blank>` anchors, ProposalBlock through shell, attachment row split, TypingIndicator inside scroll container)
  - `agentforge/cui/src/chat/IntakeProposalCard.tsx` (refactored through ProposalCardShell; "Captured" honest status)
  - `agentforge/cui/src/chat/AttachmentPreview.tsx` (compact mode + PDF placeholder fallback + size-flexible glyph)
  - `agentforge/cui/src/chat/ExtractionAcknowledgment.tsx` (lab ack copy fix)
  - `agentforge/cui/src/citations/DocumentModal.tsx` (preserved as Vitest fixture; postMessage + new-tab affordance both removed when host overlay landed)
  - `agentforge/cui/src/citations/useDocumentBytes.ts` (`credentials: 'same-origin'` + URL base anchor)
  - `agentforge/cui/src/types/chat.ts` (extraction ChatBlock + ChatAttachment field)
  - `agentforge/cui/src/config.ts` (readModuleBase)
  - `agentforge/cui/src/vite-env.d.ts` (moduleBase declaration)
  - `agentforge/cui/src/index.css` (composer compose-input-wrap, attachment chip large/compact, typing dots animation, proposal-body section styling, attachment-row standalone)
- **Modified (API):**
  - `agentforge/api/src/agent/orchestrator.ts` (extraction block emit, lab summary helper, lab_summary text on extraction, insertPendingProposal import)
  - `agentforge/api/src/agent/verification.ts` (`extraction` added to nonEmptyClinical)
  - `agentforge/api/src/openemr/types.ts` (extraction ChatBlock schema with intake_data + lab_summary)
- **Modified (Module):**
  - `interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php` (require forms.inc.php so addForm() is in scope)
  - `interface/modules/custom_modules/oe-module-agentforge/public/panel.php` (moduleBase exposed via `__AGENTFORGE_CUI__` global)
  - `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig` (sandbox tokens added; document overlay CSS + JS handler; multiple iterations on close-button styling and iframe sizing)
- **Modified (Docs):**
  - `TASKS.md` (G2-Early-26 extended with persistence-gap note, G2-Early-27 added for Lab Summary clinical note auto-write, G2-Final-31 added then closed for the document overlay)
  - `~/.claude/projects/-Users-jasondijols-Documents-Code-Projects-openEMR/memory/MEMORY.md` (index entry for the new feedback memory)

## Outcomes

- **MVP demo submitted** before midnight CT 2026-05-05 with the full visual flow: drop intake → IntakeProposalCard → drop lab → ack + Lab Summary preview → ask the canonical statin-intensification question → guideline citations as clickable inline links opening USPSTF/ADA in new tabs.
- **G2-Final-31 closed post-MVP** — document modal now overlays the entire OpenEMR application (not just the rail) via host-rendered overlay + custom pdfjs viewer. Smooth HTML-native scroll. PDF + PNG/JPEG both supported through one viewer. Overlay assets relocated to Vite's `publicDir` so they survive future rebuilds.
- **W1 ProposalCardShell extraction** — W1 propose-write cards (vitals, chief complaint, allergy, etc.) and the W2 intake card now share one set of chrome primitives. "Decline" → "Reject" globally. Future proposal-style surfaces drop into the shell instead of growing their own ad-hoc styling.
- **Latent W1 PHP bug fixed** (`addForm` undefined when auto-creating an encounter for an empty-chart patient) — this only fired for the W2 cohort by design (empty new-patient charts) so it had been masked through W1.
- **Iframe sandbox hardened in the right direction** — `allow-popups` + `allow-popups-to-escape-sandbox` now part of the rail iframe, fixing what looked like a browser quirk but was actually scoped sandbox blocking.

## Next steps

- [ ] Promote this session to a numbered milestone (`process/milestones/week-2/04-g2-mvp-99-and-final-31.md`) — the G2-MVP-99 close + G2-Final-31 close are both index-worthy.
- [ ] Restore the lab-summary clinical-note auto-write (G2-Early-27) — `maybeBuildLabSummaryProposal` is gated off behind a `void` reference; fix the underlying `ClinicalNoteWriteAction` "write failed" exception in the W1 PHP catch-all (likely `ClinicalNotesService::appendPhysicianNoteForEncounter` throwing on something specific to synthesized proposals — pass `proposal_id` is server-minted vs LLM-minted? encounter ACL? worth a focused look).
- [ ] Wire G2-Early-26 properly (per-section intake confirm dispatch) — chief_concern + allergies via existing W1 tools, plus new G2-Early-25 medication_add / family_history_add. Demographics defers to G2-Final.
- [ ] G2-Early-30c (or similar): inline per-value lab citations with click-to-source, so the lab acknowledgment's invitation matches what's actually surfaceable (currently just "View source PDF" link, no per-result clicks).
- [ ] Update `W2_ARCHITECTURE.md §10` with the Lab Summary clinical-note pattern + the host-rendered document overlay architecture (G2-Final-31).

## Links

- Prior session: [0505-T1726-g2-mvp-execution-and-api-smoke.md](0505-T1726-g2-mvp-execution-and-api-smoke.md)
- Prior milestone: [process/milestones/week-2/03-g2-mvp-execution.md](../../milestones/week-2/03-g2-mvp-execution.md)
- W2 task plan: [TASKS.md](../../../../../TASKS.md) (G2-MVP-99, G2-Early-26, G2-Early-27, G2-Final-31)
- Project brief: [Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf](../../../references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
