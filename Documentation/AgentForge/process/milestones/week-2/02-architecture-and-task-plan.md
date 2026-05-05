# W2 architecture and task plan — locked in

**Purpose:** Captures the moment W2 transitions from "we have a brief" to "we have a comprehensive plan ready to implement." Closes out W2's pre-implementation phase: peer architecture defense (Mon 5/4 @ 3 PM CT) → live API probe validating the extraction approach → brief-required `W2_ARCHITECTURE.md` authored and refined → gated execution map (`TASKS.md`) created → 50-case eval rubric structure pinned → Saturday self-injection rehearsal scheduled. G2-MVP-01 (cohort patient seeding) is the next actionable task.

## What shipped in the W2 pre-implementation phase

### `W2_ARCHITECTURE.md` (comprehensive design doc — brief deliverable)

17 numbered sections + W1 implementation continuity check. Notable contents:

- **Instructor decisions table + executive summary** — three architectural changes from W1: multimodal extraction, multi-agent supervision, PR-blocking eval gate.
- **System diagram** — single tall vertical Mermaid; W2 deltas highlighted in amber, every yellow box attaches to a W1 surface (no green-field subsystems, no new runtimes).
- **Document ingestion sequence diagram** — physician click → upload → idempotent DocRef mint → extract handoff → cross-check → bbox lookup → verify → upsert FHIR Observations.
- **Extraction architecture (probe-validated)** — `attach_and_extract(patient_id, file_path, doc_type)` brief-compliant tool surface; delegates to `intake_extractor` worker; MIME dispatch (PDF → Claude `document` block, PNG/JPEG → `image` block); Zod parse → `pdf-parse` cross-check → `pdfjs-dist` bbox lookup.
- **Strict Zod schemas** — `SourceCitationSchema` carrying the brief's 5-field citation contract verbatim; `LabPdfExtractionSchema`; `IntakeFormSchema`; required validation tests.
- **Multi-agent orchestration** — Vercel AI SDK supervisor (no LangGraph migration); 3 inspectability guarantees; `selectModel(workerName)` config map for per-worker model assignment; explicit branching rules in system prompt.
- **Hybrid RAG** — `pgvector` on existing Postgres + `tsvector` for sparse + Cohere Rerank; ~25 chunks across USPSTF screening, JNC8 BP, ADA glycemic.
- **Citation contract + UI** — composer state machine, drag-drop, **single-file scope**, two-message acknowledgment with ellipsis typing indicator, click-to-modal for patient docs vs new-tab for guideline citations, intake proposal card (read-only at MVP, per-field edit at Final).
- **FHIR / OpenEMR integrity** — `documents` → `DocumentReference` → `Observation` with `derivedFrom` linkage; 3 idempotency keys; W2 write-tool inventory (4 new at Early + 1 at Final + 1 recovery utility).
- **Eval architecture** — 50 cases, 5 named boolean rubrics, `baseline.json` pinned, dual-surface PR-blocking gate (Git Hook + GH Actions), >5pp regression OR sub-95% absolute fails, Saturday self-injection rehearsal mandatory.
- **Observability** — extraction-turn span shape with PHI-safe metadata only; **per-step latency** (not aggregate); brief's required fields including W2-NEW retrieval hits / extraction confidence / eval outcome.
- **Risks, narrowing, schedule, references** — top 3 risks with mitigations; explicit non-goals (multi-file, lab CRUD, medication UPDATE, family hx UPDATE/DELETE, MVP per-field edit, mobile-responsive); MVP/Early/Final gate scope.
- **W1 implementation continuity check** — 10-row verification that every W2 dependency has a W1 anchor; no blockers, no rework.

### `TASKS.md` (gated execution map)

Mirrors W1's proven structure: 8-column task tables, stop-the-line invariants (S1–S15, with S11–S15 W2-new), gate dependency graph, schedule overlay, cut-tier matrix.

- **3 gates:** G2-MVP (Tue 11:59 PM CT), G2-Early (Thu 11:59 PM CT), G2-Final (Sun 12:00 PM CT).
- **~90 individual task IDs** across the gates + cross-cutting band.
- **Stop-the-line S12** — *Eval gate fires on regression* — the brief's hard gate, with rehearsal pinned at `G2-Final-Rehearsal`.
- **Cut-tier matrix** with explicit "never cut" guardrails: eval gate, cohort patients, upload+extraction core, schemas.

### Live API probe evidence

[`agentforge/api/scripts/w2-vlm-probe.mjs`](../../../../agentforge/api/scripts/w2-vlm-probe.mjs) — re-runnable Anthropic API probe. Validated extraction approach against three actual W2 sample documents:

| Source | Path | Latency | Tokens | Cost | JSON | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| Chen lipid panel PDF | Claude `document` block | 5.6 s | 4284/700 | $0.0078 | ✓ | All 5 results extracted; every `quote_or_value` matches source verbatim ("232 H", "48 L"). |
| Reyes intake PNG | Claude Vision `image` block | ~7 s | ~1800/450 | ~$0.0042 | ✓ | 3 medications + dose/frequency, 1 allergy, 2 family-history rows; verbatim quotes. |
| Reyes HbA1c PNG | Claude Vision `image` block | 6.2 s | 1821/467 | $0.0042 | ✓ | HbA1c 8.2% (high), fasting glucose 152 (high), eGFR 88 (normal) — all correct, all cited. |
| **Total** | | | | **$0.0172** | 3/3 | **Zero hallucinations on visual inspection.** |

Haiku 4.5 sufficient for our document set. Claude PDF internally fuses page text + per-page image; we get table comprehension + verbatim quotes in one call without a separate OCR pipeline.

### Cohort sample documents

[`Documentation/AgentForge/assets/W2-documents/`](../../../assets/W2-documents/) — 8 files for 4 patients × 2 doc types × mix of PDF/PNG. To be renamed to medical-office convention `{LastName}-{FirstName}-{DocumentClass}-{SubType}.{ext}` during G2-MVP-02. Patients to be seeded as **new-patient appointments with empty charts** during G2-MVP-05..06 — the intake form populates the chart on first upload, mimicking the real "patient walks in for first visit" workflow.

### Repo root file shape (week-snapshotted)

```
openEMR/                                    ← repo root
├── W1_ARCHITECTURE.md                       (renamed from ARCHITECTURE.md — frozen W1 snapshot)
├── W2_ARCHITECTURE.md                       (NEW — this week's design)
├── TASKS.md                                 (NEW — active W2 task list, rolling slot)
└── Documentation/AgentForge/archive/
    ├── PRD.md                               (W1 PRD archived; no W2 PRD created — content folded into W2_ARCHITECTURE.md)
    └── TASKS_W1.md                          (W1 tasks archived)
```

When W3 starts: rename `TASKS.md` → `archive/TASKS_W2.md`; create fresh root `TASKS.md`; preserve `W2_ARCHITECTURE.md` at root and add `W3_ARCHITECTURE.md`.

## Decisions log (lifted from session journals)

Full pivot histories in the dated journals; lifted summaries for the index:

- **VLM choice (Claude + `pdf-parse` cross-check)** — peer pushback on Claude vs PDFPlumber resolved by live probe. PDFPlumber rejected because it doesn't accept PNG (3 of 8 cohort samples are PNGs). Cross-check addresses hallucination concern with a free deterministic tripwire. See [`0505-T0111-w2-architecture-tasks-lockdown.md`](../../journal/week-2/0505-T0111-w2-architecture-tasks-lockdown.md).
- **Two W2 docs instead of three** — collapsed PRD into `W2_ARCHITECTURE.md` front matter; brief-literal filenames `W1_ARCHITECTURE.md` / `W2_ARCHITECTURE.md`. See same journal.
- **`pgvector` for vector retrieval** — instructor emphasis on "vector database" satisfied with single-image swap (`postgres:16-alpine` → `pgvector/pgvector:pg16`). See same journal.
- **Narrowed write-tool scope** — 4 new tools at Early + per-field edit at Final + `delete_uploaded_document` recovery tool replaces lab CRUD. See same journal.
- **Cohort patients seeded as new-patient appointments with empty charts** — clinically realistic and dramatically simpler than full chart depth. See same journal.

## What's next

- **G2-MVP-01..07:** cohort patient seeding (BLOCKER for everything else)
- **G2-MVP-10..36:** schemas, upload + DocBytes endpoints, extraction worker, observability
- **G2-MVP-50..56:** pgvector image swap, RAG corpus, evidence_retriever
- **G2-MVP-60..69:** composer + modal + acknowledgment + intake proposal card
- **G2-MVP-99:** end-to-end smoke test (gate exit criterion, due Tue 11:59 PM CT)

## Cross-references

This milestone summarizes work captured across these W2 journals:

- [`0504-T1431-dev-recovery-and-trail-reorg.md`](../../journal/week-2/0504-T1431-dev-recovery-and-trail-reorg.md) — local-dev recovery (already promoted to milestone [`01-local-dev-recovery-runbook.md`](01-local-dev-recovery-runbook.md))
- [`0504-T1500-w2-architecture-defense-prep.md`](../../journal/week-2/0504-T1500-w2-architecture-defense-prep.md) — architecture defense + post-meeting probe lockdown
- [`0504-T2235-branding-and-cui-typography.md`](../../journal/week-2/0504-T2235-branding-and-cui-typography.md) — favicon + OG bundle (parallel work, not blocking architecture)
- [`0505-T0111-w2-architecture-tasks-lockdown.md`](../../journal/week-2/0505-T0111-w2-architecture-tasks-lockdown.md) — this milestone's anchor session

Active deliverables and references:

- [`W2_ARCHITECTURE.md`](../../../../W2_ARCHITECTURE.md) · [`TASKS.md`](../../../../TASKS.md) · [`agentforge/api/scripts/w2-vlm-probe.mjs`](../../../../agentforge/api/scripts/w2-vlm-probe.mjs)
- W1 baseline: [`W1_ARCHITECTURE.md`](../../../../W1_ARCHITECTURE.md)
- W2 brief: [`Documentation/AgentForge/references/Week 2 - AgentForge Clinical Co-Pilot.pdf`](../../../references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
