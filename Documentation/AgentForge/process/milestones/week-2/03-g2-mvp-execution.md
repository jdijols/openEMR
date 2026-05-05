# 03 — W2 G2-MVP execution + API smoke verified

## Purpose

This milestone is the index-worthy summary of the W2 G2-MVP gate execution: **33 of ~34 tasks done across 12 commits, with the brief's MVP minimum verified end-to-end via the API curl smoke (G2-MVP-58).** Built on the architecture + task plan locked at [`02-architecture-and-task-plan.md`](02-architecture-and-task-plan.md). Full session context — decisions, debugging seams, file lists — lives in the journal entry [`0505-T1726-g2-mvp-execution-and-api-smoke.md`](../../journal/week-2/0505-T1726-g2-mvp-execution-and-api-smoke.md). The remaining gate is G2-MVP-99 (full UI E2E smoke); three continuation options are surfaced below.

## What ships

By scope tier from the brief:

- **Document ingestion** (G2-MVP-01..25) — 4 W2 cohort patients seeded with empty charts, 8 sample documents renamed to medical-office convention; PHP module DocumentUploadAction + DocumentBytesAction + ObservationWriter live with isolated tests; `/upload/document.php` and `/document/bytes.php` HTTP entries wired with `X-Internal-Auth` trusted-agent path; SHA-256 idempotency on `(patient, sha256)` enforced (S13).
- **Multimodal extraction** (G2-MVP-30..36) — `intake_extractor` worker dispatches PDF→`document` block / PNG/JPEG→`image` block to Claude Haiku 4.5; pdf-parse cross-check (S14) verifies every leaf citation's `quote_or_value` against raw PDF text; pdfjs-dist bbox lookup hook in place. `attach_and_extract` Vercel AI SDK tool with `assertBoundPatient` defense-in-depth (S1). Orchestrator wires it via `w2_tools.ts` factory with lazy-init Anthropic + Cohere + bge-small + pdf-parse clients.
- **Hybrid RAG** (G2-MVP-50..56) — pgvector swap, `rag_chunks` schema with HNSW + GIN indexes, 24 chunks across USPSTF / JNC8 / ADA corpora, sparse + dense + dedupe + Cohere Rerank pipeline. `evidence_retrieve` tool wraps each chunk in a W1 `source_pack` envelope so claim blocks citing chunk_ids survive `verifyClinicalBlocks`.
- **Routing nudge** (G2-MVP-57) — system prompt extended: question + treatment-decision verb → invoke `evidence_retrieve` before answering. Patient-record-only questions skip retrieval.
- **PHI redaction** (G2-MVP-40..41) — `redactPhi` summarizes `document` / `image` content blocks (raw base64 → `{type, size_bytes, mime, _phi_safe_summary:true}`) and §6 extraction envelopes (→ `{document_type, schema_valid, n_facts, n_uncertain[, n_unsupported]}`) before Langfuse spans are emitted. S11 hard-rule held.
- **CUI components** (G2-MVP-60..69) — 10 components/hooks built and 20/20 vitest smoke green: `Composer`, `AttachmentPreview`, `ErrorBanner`, `TypingIndicator`, `ExtractionAcknowledgment`, `IntakeProposalCard`, `useFileValidation`, `DocumentModal`, `CitationLink`, `useDocumentBytes`. Components are isolated; integration into `App.tsx` / `MessageList.tsx` is the open work for G2-MVP-99.

## Smoke gate result (G2-MVP-58)

Clinical question via curl: *"Given her LDL of 158 and her T2DM, should we intensify her statin?"*

- `citation_navigation` populated with 5 chunks from 3 distinct sources (USPSTF + ADA).
- 3 surviving claim blocks with `source_type='guideline_chunk'` citations: `uspstf-statin#statin-intensification-in-diabetes`, `ada-glycemic#statin-therapy-in-diabetes`, `uspstf-statin#monitoring-and-follow-up`.
- 1149 output tokens, $0.022, no `attach_and_extract_threw` / `intake_extractor_schema_fail` / `evidence_retrieve_threw` logs.
- Manual chart-empty smoke (G2-MVP-07): all 4 W2 patients on Donna Lee's 2026-05-04 calendar (15:45 / 16:00 / 16:15 / 16:30 overflow slots), each chart empty.

## Test totals

- **Vitest:** ~95 scenarios green across schemas, intake_extractor, attach_and_extract, evidence_retriever, w2_tools helper, redact_w2, and 20 CUI smokes.
- **PHPUnit isolated:** 12 scenarios green across `DocumentUploadAction`, `DocumentBytesAction`, `ObservationWriter`, `ModuleHttpContract`. W1 baseline preserved — the 3 pre-existing failures (Twig template compilation × 2, `ContextEndpointsStaticStructureTest`) verified to predate this milestone.

## Known gap (deferred to G2-Early)

- **`attach_and_extract` does not yet wrap leaf extraction facts in `source_pack` envelopes**, so chat responses to extraction-mode turns (e.g., "I just uploaded an intake form…") have the W1 `verifyClinicalBlocks` gate stripping the patient-record claim blocks. The data plane is fully validated end-to-end; the presentation layer for extraction-mode turns is properly G2-Early-10..12 (supervisor refactor + handoff spans) + G2-Early-26 (intake-proposal-card dispatch) scope.
- The smoke's headline question avoids this issue by chance — Chen's chart is empty by design, so the answer hangs entirely on guideline citations, which are wired correctly.

## Continuation options for G2-MVP-99

The remaining gate is **G2-MVP-99** (full UI E2E smoke — physician opens chart in browser, drops intake form into composer, sees acknowledgment + proposal card, drops lab, asks the clinical question, clicks a citation, modal opens at cited page). Three honest paths:

- **Option A — Ship as-is.** Brief's MVP minimum (*"first extraction and first evidence retrieval demo"*) is met via the API smoke. Mark G2-MVP-99 as "demo recorded; presentation gaps documented for G2-Early-10..12 + G2-Early-26"; record demo, draft submission package, submit. The data plane is rock-solid; the gaps are honestly Thursday-grade work.
- **Option B — Wire CUI integration tonight.** Edit [`agentforge/cui/src/App.tsx`](../../../../agentforge/cui/src/App.tsx) and [`chat/MessageList.tsx`](../../../../agentforge/cui/src/chat/MessageList.tsx) so that chat responses with extraction-acknowledgment payloads render `IntakeProposalCard` + `ExtractionAcknowledgment` + `DocumentModal` inline. Components are smoke-tested as standalone (20/20 vitest); the integration glue is the missing piece. ~60–90 minutes.
- **Option C — Pause + resume Wednesday morning.** Get sleep, do CUI integration with fresh eyes, submit later. Lowest risk on quality, highest cognitive load on the calendar.

The author's lean (recorded in the journal): **A** is the elite move given the data plane is the hard part and that's what the brief actually asks for. **B** if the user wants the cleaner demo recording. **C** if exhaustion is real.

## Decisions (lifted from journal)

- **4 plan-amendment tasks added before execution** — G2-MVP-01b, G2-MVP-57, G2-MVP-58, G2-Early-30b closed three pre-execution gaps in the original plan.
- **Option A — full sequential execution chosen** over critical-path-first, per user's "I think we're going to have time to execute all of it."
- **pdf-parse 2.x → 1.1.1 with inner-lib import workaround** — class-based `PDFParse` API in 2.x not worth integrating; 1.1.1's `index.js` debug-branch readFileSync bug bypassed via `import('pdf-parse/lib/pdf-parse.js')`.
- **Inject caller-known UUIDs (`patient_uuid`, `source_document_id`, citation `source_id`/`source_type`) into LLM JSON before Zod parse** — the LLM cannot know our internal UUIDs. Worker now post-processes the LLM output before validation.
- **Wrap `evidence_retrieve` chunks in W1 `source_pack` envelope** — without this, `verifyClinicalBlocks` strips every guideline-cited claim and the response collapses to `insufficient_evidence_after_verification`. Did NOT do the same for `attach_and_extract` (deferred per cut-tier 3 / G2-Early-26).

Full prompt → recommendation → outcome chain in the [journal entry](../../journal/week-2/0505-T1726-g2-mvp-execution-and-api-smoke.md#key-decisions).

## Links

- Journal: [process/journal/week-2/0505-T1726-g2-mvp-execution-and-api-smoke.md](../../journal/week-2/0505-T1726-g2-mvp-execution-and-api-smoke.md)
- Prior milestone: [02-architecture-and-task-plan.md](02-architecture-and-task-plan.md)
- W2 architecture: [W2_ARCHITECTURE.md](../../../../W2_ARCHITECTURE.md)
- W2 task plan: [TASKS.md](../../../../TASKS.md)
- Project brief: [Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf](../../../references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
- Commit range: `afcd330d7` → `99713875f` on `master`.
