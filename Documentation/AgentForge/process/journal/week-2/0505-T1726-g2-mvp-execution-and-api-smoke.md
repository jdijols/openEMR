---
date: 2026-05-05
topic: G2-MVP execution — code track complete + API curl smoke verified end-to-end
related_milestone: process/milestones/week-2/03-g2-mvp-execution.md
---

# G2-MVP execution — session journal

## Goal

Take the W2 G2-MVP gate from "task plan locked" to "verified end-to-end via curl smoke." User chose **Option A — push through** (not critical-path-only) after a brief plan-vs-MVP analysis surfaced three gaps. By session end, 33 of ~34 G2-MVP tasks done across 12 commits, with the brief's MVP minimum — *"first extraction and first evidence retrieval demo"* — verified via the API smoke (G2-MVP-58).

## Context

The session came in on top of [`0505-T0111-w2-architecture-tasks-lockdown.md`](0505-T0111-w2-architecture-tasks-lockdown.md), which had locked [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) and [`TASKS.md`](../../../../../TASKS.md) without any code shipped yet. Tuesday 2026-05-05 was the MVP deadline (11:59 PM CT). Two terminals — agent API + curl shell.

## Key decisions

### Decision: 4 plan-amendment tasks added before execution

- **Prompt:** "Do an analysis of the @TASKS.md file we just created for week two and compare it against the requirements for the MVP submission… surface those edits here."
- **Recommendation:** Three gaps in the existing plan: (1) the smoke-test clinical question depended on `evidence_retrieve` routing that didn't formally land until G2-Early — needed a lightweight system-prompt nudge at MVP; (2) the eval-gate baseline assumed W1 already had `factually_consistent` + `safe_refusal` runners — needed verification; (3) the Chen lipid PDF's specific facts (LDL 158, T2DM) needed alignment with the smoke-test question. Added G2-MVP-01b, G2-MVP-57, G2-MVP-58, G2-Early-30b.
- **Outcome:** Six surgical edits to [`TASKS.md`](../../../../../TASKS.md) under `docs(agentforge): W2 plan amendments`. User approved before execution began.

### Decision: Option A — full sequential execution

- **Prompt:** "Option A: push through. Let's go."
- **Recommendation:** Given the MVP deadline and user's explicit "I think we're going to have time to execute all of it," pushed through every G2-MVP task in code, committing in logical chunks rather than cherry-picking critical path. Risk: longer execution; benefit: nothing left to wire later.
- **Outcome:** 32 code-track tasks completed across 9 commits before the smoke phase.

### Decision: pdf-parse 2.x → 1.1.1 with inner-lib import workaround

- **Prompt:** Mid-smoke debug — `attach_and_extract_threw: TypeError: fn is not a function` because `pdf-parse@2.x` ships a class-based `PDFParse` API instead of the simple function export.
- **Recommendation:** Downgrade to the production-stable `pdf-parse@1.1.1`. Avoid the well-known `index.js` debug-branch bug that calls `readFileSync` on a missing test fixture under modern Node ESM dynamic import by importing the inner library file directly: `import('pdf-parse/lib/pdf-parse.js')`.
- **Outcome:** [`agentforge/api/src/agent/w2_tools.ts`](../../../../../agentforge/api/src/agent/w2_tools.ts) imports the inner lib; `package.json` pinned `^1.1.1`.

### Decision: Inject caller-known UUIDs into LLM JSON before Zod parse

- **Prompt:** Schema validation failures showed `patient_uuid` and `source_document_id` "Required" — the LLM literally cannot know our internal UUIDs.
- **Recommendation:** Post-process the LLM output before Zod parse: caller injects `document_type + patient_uuid + source_document_id` at top level and walks every leaf citation to overwrite `source_id + source_type` with the canonical DocRef. The LLM never sees these fields in the prompt.
- **Outcome:** [`agentforge/api/src/workers/intake_extractor.ts`](../../../../../agentforge/api/src/workers/intake_extractor.ts) does the injection; prompt rewritten to pin nested key names with an explicit JSON skeleton.

### Decision: Wrap evidence_retrieve chunks in W1-shaped source_pack envelope

- **Prompt:** Smoke's clinical question returned `insufficient_evidence_after_verification` — the W1 verification gate (`verifyClinicalBlocks`) strips claim blocks whose `citation_ids` aren't in the tool-result `source_pack` set, and W2 tools weren't returning source_packs.
- **Recommendation:** Each retrieved chunk now wrapped with `{resource_family: 'clinical_guideline', table: 'rag_chunks', uuid: chunk_id, as_of, retrieval_path, navigation_hint: {kind: 'guideline_chunk', params: {chunk_id, section, source_url}}}`. Did NOT do the same for `attach_and_extract` — that's a larger refactor properly belonging to G2-Early (per cut-tier 3).
- **Outcome:** [`agentforge/api/src/tools/evidence_retrieve.ts`](../../../../../agentforge/api/src/tools/evidence_retrieve.ts) wraps chunks; clinical question returned 5 USPSTF/ADA citations and 3 surviving claim blocks.

### Decision: G2-MVP-99 deferred to a fresh session — three options surfaced

- **Prompt:** End-of-session — user asked for documentation + would start a new chat to choose the path forward.
- **Recommendation:** Three honest options on the table given the smoke landed clean but the extraction-side display has known gaps. Captured below.
- **Outcome:** This journal entry + the milestone doc carry the option set so the next session has full context.

## Trade-offs and alternatives

- **pdf-parse 2.x with class-API integration** — rejected. Class-based `new PDFParse(...).getText()` API discovery was speculative; downgrade was deterministic.
- **Critical-path-first execution (Option B)** — user explicitly chose Option A. Notes: the data plane gates (extraction + retrieval) are the brief's MVP minimum; UI integration polish is properly G2-Early.
- **Wire `attach_and_extract` source_packs now** — deferred. Walking every leaf extraction fact to mint per-fact source_packs is a ~30-min refactor that isn't blocking the smoke's gate question (Chen's chart is empty by design; the clinical answer hangs on guideline citations, which are now wired).

## Continuation options for the next session

A future session opening with this journal can pick from three directions for closing out G2-MVP-99 (the full UI E2E smoke):

- **Option A — Ship as-is.** The brief's MVP minimum (*"first extraction and first evidence retrieval demo"*) is met via the API smoke. Mark G2-MVP-99 as "demo recorded; presentation gaps documented for G2-Early-10..12 + G2-Early-26"; submit. The data plane is rock-solid; the gaps are honestly Thursday-grade work.
- **Option B — Wire CUI integration tonight.** Edit `agentforge/cui/src/App.tsx` / `chat/MessageList.tsx` so chat responses with extraction-acknowledgment payloads render the `IntakeProposalCard` + `ExtractionAcknowledgment` + `DocumentModal` components inline. Components exist as standalone (smoke-tested with 20/20 vitest); the integration glue is what's missing. ~60–90 min.
- **Option C — Pause + resume Wednesday morning.** Get sleep, do CUI integration with fresh eyes, submit later. Lowest risk, highest cognitive load on the calendar.

Lean: **A** is the elite move given the data plane is the hard part and that's what the brief actually asks for. **B** if the user wants the cleaner demo recording. **C** if exhaustion is real.

## Tools, dependencies, commands

- **pgvector swap:** `docker compose -f docker/development-easy/docker-compose.yml -f docker/agentforge/docker-compose.override.yml pull postgres && ... up -d --force-recreate postgres`. Then verified `pgvector` extension via `psql … -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extname, extversion FROM pg_extension WHERE extname='vector';"` (0.8.2 ✓).
- **Migrations from host (host networking):** `POSTGRES_URL='postgresql://agentforge:agentforge@127.0.0.1:15432/agentforge' npm run db:migrate` and same prefix for `npm run rag-index`. The `dev:host` script (already existed) overrides for the running API.
- **bge-small download:** First call to `npm run rag-index` lazy-loaded `Xenova/bge-small-en-v1.5` (~80 MB) into `~/.cache/huggingface/`.
- **Cohere key:** Replaced `replace-me-cohere-dev-key` placeholder with a real key in [`docker/agentforge/secrets.dev.env`](../../../../../docker/agentforge/secrets.dev.env) (gitignored).
- **MariaDB UUID extraction (HEX fallback for `BIN_TO_UUID`-less MariaDB):** `SELECT LOWER(CONCAT(SUBSTR(HEX(uuid),1,8),'-',SUBSTR(HEX(uuid),9,4),'-',SUBSTR(HEX(uuid),13,4),'-',SUBSTR(HEX(uuid),17,4),'-',SUBSTR(HEX(uuid),21))) FROM patient_data WHERE genericval1='AF-COHORT-011';`
- **Dev session-token mint helper:** [`agentforge/api/scripts/mint-dev-session-token.mjs`](../../../../../agentforge/api/scripts/mint-dev-session-token.mjs) — re-implements OpenEMR module's HMAC handshake payload using the same `SESSION_TOKEN_SECRET` so curl-issued tokens verify identically to handshake-redeemed ones. Mint with `npx dotenv -e ../../docker/agentforge/secrets.dev.env -- node scripts/mint-dev-session-token.mjs <patient_uuid> [user_id] [ttl_sec]`.

## Files touched

Captured at the commit-message level — see commits `afcd330d7` through `99713875f` for full diffs. High-level groups:

- **Created:** `agentforge/api/src/schemas/extraction.ts`, `agentforge/api/test/schemas/extraction.test.ts`, `agentforge/api/src/workers/intake_extractor.ts` + test, `agentforge/api/src/workers/evidence_retriever.ts` + test, `agentforge/api/src/tools/attach_and_extract.ts` + test, `agentforge/api/src/tools/evidence_retrieve.ts`, `agentforge/api/src/agent/w2_tools.ts` + test, `agentforge/api/db/migrations/004_rag_chunks.sql`, `agentforge/api/scripts/build-rag-index.mjs`, `agentforge/api/scripts/mint-dev-session-token.mjs`, `agentforge/api/eval/guidelines/{ada-glycemic,jnc8-bp,uspstf-statin}.md`, `agentforge/cui/src/{chat,citations}/...` (10 W2 components + tests), `interface/modules/custom_modules/oe-module-agentforge/src/Documents/*.php` (12 module files), `interface/modules/custom_modules/oe-module-agentforge/src/Http/{UploadDocument,ReadDocumentBytes}.php`, `interface/modules/custom_modules/oe-module-agentforge/public/{upload/document.php,document/bytes.php}`, `tests/Tests/Isolated/Modules/AgentForge/{DocumentUploadAction,DocumentBytesAction,ObservationWriter}IsolatedTest.php`, `Documentation/AgentForge/assets/W2-documents/README.md`, plus 8 sample-doc renames.
- **Modified:** [`TASKS.md`](../../../../../TASKS.md) (32+ rows updated with done-proofs), [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) (cohort table, open-questions log, §6 schema refinement), [`agentforge/api/src/agent/orchestrator.ts`](../../../../../agentforge/api/src/agent/orchestrator.ts) (W2 tool wiring), [`agentforge/api/src/agent/system_prompt.ts`](../../../../../agentforge/api/src/agent/system_prompt.ts) (routing nudge), [`agentforge/api/src/app.ts`](../../../../../agentforge/api/src/app.ts) (chat schema accepts `docref_uuid`/`doc_type`), [`agentforge/api/src/observability/redact.ts`](../../../../../agentforge/api/src/observability/redact.ts) (W2 content-block + extraction summarization for S11), [`docker/agentforge/docker-compose.override.yml`](../../../../../docker/agentforge/docker-compose.override.yml) (pgvector image), [`docker/agentforge/secrets.env.example`](../../../../../docker/agentforge/secrets.env.example) (`COHERE_API_KEY`), [`agentforge/contracts/module-http-paths.json`](../../../../../agentforge/contracts/module-http-paths.json) (15 paths up from 13), [`contrib/util/agentforge/seed_cohort.php`](../../../../../contrib/util/agentforge/seed_cohort.php) (4 W2 patients with empty charts), [`contrib/util/agentforge/seed_appointments.php`](../../../../../contrib/util/agentforge/seed_appointments.php) (W2 cohort routes through new-patient-pool overflow on 2026-05-04).
- **Deleted:** _None this session._

## Outcomes

- 33 of ~34 G2-MVP tasks done across 12 commits (`afcd330d7` → `99713875f`).
- Cohort + appointments verified live (G2-MVP-07): Chen / Whitaker / Reyes / Kowalski on 2026-05-04 with empty charts.
- API smoke verified live (G2-MVP-58): clinical question returned 5 USPSTF/ADA citations + 3 surviving claim blocks; bge-small + Cohere Rerank + pgvector + routing nudge all wire correctly. Output 1149 tokens, $0.022.
- Test totals: 95+ vitest scenarios + 12 PHPUnit isolated all green. W1 baseline preserved (3 pre-existing failures verified to predate this session).
- Known gap (deferred to G2-Early-10..12 + G2-Early-26): `attach_and_extract` doesn't wrap leaf extraction facts in `source_pack` envelopes, so chat responses to extraction-mode turns have W1 verification gate stripping the patient-record claim blocks. The data plane is fully validated; the presentation layer for extraction-mode turns is G2-Early supervisor-refactor scope.

## Next steps

- [ ] Decide A / B / C from the **Continuation options** section above for closing G2-MVP-99.
- [ ] If A: record demo video + draft submission package; mark G2-MVP-99 as "presentation gaps documented for G2-Early."
- [ ] If B: wire `IntakeProposalCard`, `ExtractionAcknowledgment`, `DocumentModal`, `CitationLink` into [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) and [`chat/MessageList.tsx`](../../../../../agentforge/cui/src/chat/MessageList.tsx); then run the 11-point operator checklist in [`TASKS.md`](../../../../../TASKS.md) under G2-MVP-99.
- [ ] Either way, add G2-Early-26 source_pack wrapping for `attach_and_extract` so the supervisor refactor at G2-Early-10..12 has a clean integration target.

## Links

- Numbered milestone: [process/milestones/week-2/03-g2-mvp-execution.md](../../milestones/week-2/03-g2-mvp-execution.md)
- Prior session: [0505-T0111-w2-architecture-tasks-lockdown.md](0505-T0111-w2-architecture-tasks-lockdown.md)
- W2 architecture doc: [W2_ARCHITECTURE.md](../../../../../W2_ARCHITECTURE.md)
- W2 task plan: [TASKS.md](../../../../../TASKS.md)
