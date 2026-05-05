---
date: 2026-05-05
topic: W2 architecture and task plan locked in (defense → probe → W2_ARCHITECTURE.md → TASKS.md)
related_milestone: process/milestones/week-2/02-architecture-and-task-plan.md
---

# W2 architecture and tasks lockdown — session journal

## Goal

Move W2 from "we have a brief" to "we have a comprehensive plan ready to implement." Specifically: defend the proposed architecture in the 3 PM peer breakout, resolve any pushback with live evidence, author `W2_ARCHITECTURE.md` (a brief-required submission deliverable), and translate it into `TASKS.md` (a gated execution map mirroring W1's proven structure). End state: zero open questions on design; G2-MVP-01 ready to start.

## Context

The Week 2 brief asks us to extend the W1 Clinical Copilot with multimodal document ingestion, multi-agent supervision, hybrid RAG with rerank, and a PR-blocking eval gate that the grader will deliberately try to break. Brief's hard gate: *"If the eval gate does not block the regression, the Week 2 build does not pass."* Schedule is tight — Mon 5/4 architecture defense → Tue 5/5 MVP → Thu 5/7 deployed + eval gate live → Sun 5/10 final submission.

## Key decisions

### Decision: VLM choice — Claude (PDF + Vision) with `pdf-parse` cross-check, validated by live probe

- **Prompt:** "There was a real question raised by them, however, because they believed that the Claude Vision API would not be sufficient for our needs. One of the individuals was suggesting that they would locally create an agent with Python to scan. The other individual, instead of using Claude, was planning to use something called PDF Plumber."
- **Recommendation:** Steel-manned the peer pushback (hallucination is a real concern), but PDFPlumber doesn't accept PNG (3 of 8 cohort samples are PNGs simulating phone photos), and a local Python agent adds a runtime to a TS+PHP shop. Claude PDF internally fuses page text + per-page image; we get table comprehension + verbatim quotes in one call. Added a `pdf-parse` (Node) cross-check so every fact's `quote_or_value` must appear verbatim in the source — addresses hallucination concern with a free deterministic tripwire, no Python.
- **Outcome:** Validated by a live probe ([`agentforge/api/scripts/w2-vlm-probe.mjs`](../../../../../agentforge/api/scripts/w2-vlm-probe.mjs)) against three W2 sample documents. Total cost $0.0172, 3/3 parsed cleanly, zero observed hallucinations on Haiku 4.5. Locked into [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) §5.

### Decision: Two W2 documents instead of three — collapse PRD into the architecture

- **Prompt:** "Then draft a new PRD for this week's requirements, being very thorough and comprehensive… What do you think about this approach? I think this is the safest plan, but I'm wondering, do you think this is overkill?"
- **Recommendation:** Not overkill on principle, slightly overkill on form. W1's wide-open scope justified separate PRD (what+why) and ARCHITECTURE (how); W2's narrower scope makes that split duplicative. Recommended absorbing PRD-shape content (goals, non-goals, personas) into the front matter of `W2_ARCHITECTURE.md` and skipping a separate `W2_PRD.md`. Two docs (`W2_ARCHITECTURE.md` + `TASKS.md`) instead of three.
- **Outcome:** User accepted narrowed approach. Archived W1 PRD + TASKS to `Documentation/AgentForge/archive/`; renamed `ARCHITECTURE.md` → `W1_ARCHITECTURE.md`; created brief-compliant `W2_ARCHITECTURE.md` + new active `TASKS.md` at repo root. File-naming pattern: brief-literal prefix (`W1_`, `W2_`) for architecture (matches grader's expected filename), suffix-by-week for tasks (`TASKS.md` rolls forward; `TASKS_W1.md` archived).

### Decision: pgvector on existing Postgres instead of SQLite FTS5 + sidecar JSONL

- **Prompt:** "The brief and my instructors have said multiple times about creating a vector database for the retrieval. I believe you mentioned not including vector. I just want to make sure we're making the right decision here."
- **Recommendation:** Original SQLite FTS5 + sidecar embeddings was functionally equivalent at our 25-chunk scale, but instructors' repeated emphasis on "vector retrieval" makes the optics matter. pgvector on our existing Postgres (single-line image swap from `postgres:16-alpine` to `pgvector/pgvector:pg16`) directly satisfies "vector database" language without a new service or BAA surface.
- **Outcome:** [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) §8 rewritten — Postgres `tsvector` for sparse + `pgvector` HNSW for dense + Cohere Rerank. Migration plan codified at `agentforge/api/db/migrations/004_rag_chunks.sql` (per [`TASKS.md`](../../../../../TASKS.md) G2-MVP-51).

### Decision: Narrowed write-tool scope — 4 new tools at Early, per-field edit at Final, single recovery tool replaces lab CRUD

- **Prompt:** "We have to make sure that our agent has the ability to read, write, update, and delete these fields… If we're going to be writing this information that we're getting from these two document types, then we need to have those abilities as well. Correct me if you think this is wrong or a bad approach."
- **Recommendation:** The principle is right (no missing capabilities where the physician expects to act), but the as-stated scope was 25-30 hours of new work — would eat the rest of the week. Counter-proposed: 4 new write tools at Early gate (`propose_medication_add`, `propose_medication_discontinue`, `propose_allergy_delete`, `propose_family_history_add`); 1 recovery tool (`delete_uploaded_document`) replaces per-tool lab UPDATE/DELETE because labs are immutable in clinical practice and DocRef cascade soft-delete is the cleaner recovery path; per-field edit on intake proposal card moves to Final (Sun) not MVP (Tue); demographics-update tool defers to Final-if-time. Net: ~12-15 hours of additional work, sustainable across the remaining days.
- **Outcome:** [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) §10 W2 write-tool inventory lists 6 new tools (4 Early + 1 Final + 1 recovery utility) with explicit gate-tagging. [`TASKS.md`](../../../../../TASKS.md) G2-Early-20..26 breaks each into test-first PHP action + Zod tool + eval coverage. §15 narrowing list explicitly calls out lab-CRUD-per-tool, family-history UPDATE/DELETE, medication UPDATE-dose, mobile-responsive layout, multi-file uploads as out of scope.

### Decision: Cohort sample patients seeded as new-patient appointments with empty charts

- **Prompt:** "For the patients with intake forms, since we are receiving that, those patients will be have a new patient appointment like the order on the schedule with no other information on their other than what was received at the front desk and through the medical assistant (mimic other new patient charts). Make this as realistic as possible."
- **Recommendation:** Treat all four (Margaret Chen, *Whitaker, Sofia Reyes, *Kowalski) as new-patient appointments rather than seeding full chart depth. The intake form populates the chart on first upload; any lab the patient brought is uploaded next. This mirrors the actual "patient walks in, hands you a form" workflow — clinically realistic and dramatically simpler to seed (~4-6 hours instead of larger). First names for Whitaker and Kowalski to be invented during seeding (provisional `Robert` / `Anna`, verify against PDF text first).
- **Outcome:** [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) §10 *Cohort patient setup for the W2 demo* captures the seeding shape. [`TASKS.md`](../../../../../TASKS.md) G2-MVP-01..07 blocks all subsequent W2 work — without these patients on the demo schedule, no upload flow has anywhere to land. Files in [`Documentation/AgentForge/assets/W2-documents/`](../../../assets/W2-documents/) to be renamed to medical-office convention `{LastName}-{FirstName}-{DocumentClass}-{SubType}.{ext}` and committed.

### Decision: Comprehensive `TASKS.md` mirroring W1's proven structure

- **Prompt:** "Yeah, I'm ready for you to create the new tasks.md file. Go ahead and also read the previous task.md file to understand the structure, since that was very, very useful in our implementation."
- **Recommendation:** Mirror W1's 8-column task table pattern (`ID | Task | ARCH § | Depends on | Tests required | Criticality | Done proof | Cut tier`), stop-the-line invariants table, gate dependency graph, schedule overlay, cut-tier matrix. Extend stop-the-line tests with W2-specific S11–S15 (most importantly S12: eval gate fires on regression — the brief's hard gate). Three gates: G2-MVP / G2-Early / G2-Final. **(test-first)** markers on security and agent-correctness tasks.
- **Outcome:** [`TASKS.md`](../../../../../TASKS.md) — 372 lines, ~90 individual task IDs, full gate dependency graph, 6-tier cut matrix with explicit "never cut" guardrails (eval gate, cohort, upload+extraction core, schemas). Saturday self-injection rehearsal pinned as `G2-Final-Rehearsal` — validates the brief's hard gate before grading sees it.

## Trade-offs and alternatives

- **LangGraph or OpenAI Agents SDK** — would force-fit the brief's "inspectable orchestration framework" wording, but requires re-implementing W1's Vercel AI SDK orchestrator + Langfuse wiring. Risk-adjusted return negative. Vercel AI SDK + Langfuse handoff spans satisfies the inspectability bar.
- **Sidecar JSONL embeddings instead of pgvector** — functionally equivalent at our scale and slightly simpler to ship, but instructors emphasized vector retrieval explicitly multiple times. pgvector reads as the directly-named answer.
- **Multi-file uploads** — would match modern messenger UX, but adds composer state machine complexity, supervisor parallel-invocation work, eval cases for multi-extraction turns. Brief doesn't require it. Ruled out for W2.
- **Per-tool lab UPDATE/DELETE** — clinical workflow doesn't actually need it (labs are immutable). Single `delete_uploaded_document` recovery tool that cascades soft-delete via the idempotency key is cleaner.
- **Per-field edit on intake proposal card at MVP** — would expand state management and write-call partial-failure handling early. Deferred to Final; MVP ships with read-only proposal (full Confirm or Reject).

## Tools, dependencies, commands

- `node scripts/w2-vlm-probe.mjs all` — runs Claude PDF + Vision against the 3 sample documents; verifies API path before committing to extraction approach. Probe lives at [`agentforge/api/scripts/w2-vlm-probe.mjs`](../../../../../agentforge/api/scripts/w2-vlm-probe.mjs).
- New deps to install during G2-MVP-30..31 (per `TASKS.md`, all inline-`cd` per memory rule): `pdf-parse`, `pdfjs-dist`, `@anthropic-ai/sdk`, `@xenova/transformers` (for `bge-small` embeddings), `cohere-ai`.
- Postgres image swap during G2-MVP-50: `postgres:16-alpine` → `pgvector/pgvector:pg16` in `docker/agentforge/docker-compose.override.yml` and `docker-compose.prod.yml`.

## Files touched

- **Created:**
  - [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) — comprehensive W2 design doc (1474 lines), brief-compliant submission deliverable
  - [`TASKS.md`](../../../../../TASKS.md) — gated execution map (372 lines)
  - [`agentforge/api/scripts/w2-vlm-probe.mjs`](../../../../../agentforge/api/scripts/w2-vlm-probe.mjs) — Claude API probe script
- **Modified:**
  - [`0504-T1500-w2-architecture-defense-prep.md`](0504-T1500-w2-architecture-defense-prep.md) — defense prep journal updated post-meeting with probe lockdown (precursor to `W2_ARCHITECTURE.md`)
- **Renamed:**
  - `ARCHITECTURE.md` → `W1_ARCHITECTURE.md` (preserved at repo root, week-snapshotted)
  - `PRD.md` → [`Documentation/AgentForge/archive/PRD.md`](../../../archive/PRD.md) (W1 archive)
  - W1 `TASKS.md` → [`Documentation/AgentForge/archive/TASKS_W1.md`](../../../archive/TASKS_W1.md) (root `TASKS.md` is now the active W2 list)
- **Planned (rename happens at G2-MVP-02):** all 8 files in [`Documentation/AgentForge/assets/W2-documents/`](../../../assets/W2-documents/) move to medical-office naming pattern.

## Outcomes

- W2 design is locked: every architectural decision has a rationale captured in `W2_ARCHITECTURE.md` (instructor decisions table at top) and a verification step in `TASKS.md` (test-first markers, stop-the-line invariants).
- VLM extraction approach is no longer theoretical — probe results show Haiku 4.5 reading our actual document set cleanly at $0.005-$0.01 per extraction.
- The brief's hard gate (eval CI fails on regression) has explicit task lines (`G2-Early-38..42`) and a Saturday rehearsal milestone (`G2-Final-Rehearsal`).
- Repo root file shape is week-snapshotted: `W1_ARCHITECTURE.md` + `W2_ARCHITECTURE.md` side by side; `TASKS.md` rolls forward; W1 PRD/TASKS archived.

## Next steps

- [ ] G2-MVP-01: verify Whitaker + Kowalski first names against their PDF text; lock provisional `Robert` / `Anna` if files don't carry real names.
- [ ] G2-MVP-02..04: rename + commit cohort sample documents with medical-office naming + add `README.md` listing per-patient assignments.
- [ ] G2-MVP-05..07: extend `seed_cohort.php` + `seed_appointments.php` for 4 new-patient appointments; verify locally that empty charts render correctly.
- [ ] G2-MVP-10..11: write `agentforge/api/src/schemas/extraction.ts` + 5 Zod validation tests.

## Links

- Numbered milestone: [`process/milestones/week-2/02-architecture-and-task-plan.md`](../../milestones/week-2/02-architecture-and-task-plan.md)
- Defense prep precursor (same day): [`0504-T1500-w2-architecture-defense-prep.md`](0504-T1500-w2-architecture-defense-prep.md)
- W2 brief: [`Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf`](../../../references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
- Active deliverables: [`W2_ARCHITECTURE.md`](../../../../../W2_ARCHITECTURE.md) · [`TASKS.md`](../../../../../TASKS.md)
- W1 baseline: [`W1_ARCHITECTURE.md`](../../../../../W1_ARCHITECTURE.md)
