---
date: 2026-05-07
topic: G2-Early-20..27 + G2-Final-10/11/12 — W2 write-tool stack landed end-to-end
related_milestone: process/milestones/week-2/04-g2-early-gate-completion.md
---

# W2 write-tool stack landed end-to-end — session journal

## Goal

Pick up Jason's session-end direction from [`0506-T2150`](0506-T2150-w2-session-wrap-and-handoff.md) — *"I'd rather complete the writing to the database from the intake form and PDF cleanly and then deploy, before that, as well as any other tasks that are still listed before the final submission gate"* — and ship the complete W2 write surface. Specifically:

1. Reverse the `[-]` cuts on G2-Early-20..27 + G2-Final-10/11/12.
2. Build six PHP write actions (medication_add, medication_discontinue, allergy_delete, family_history_add, document_delete, demographics_update) following the W1 `AllergyWriteAction` template.
3. Add six matching TS propose-write tools.
4. Wire the IntakeProposalCard Confirm button to fan out per-section to the new endpoints.
5. Re-enable the lab-summary auto-write proposal (debug the swallowed-exception path that prompted the original disable).
6. Add per-row pencil-edit affordances on the IntakeProposalCard.
7. Add safe_refusal eval cases for each new write tool.
8. Keep the eval gate green throughout.

## Context

Built directly on the G2-Early gate completion captured in [`milestone 04`](../../milestones/week-2/04-g2-early-gate-completion.md) — code-side scope already shipped + pushed to GitHub + GitLab; this session restored the cut block. Stop-the-line invariants S1, S2, S9, S13, S14, S15 stay live across this build.

## Key decisions

### Decision: dispatch goes browser → module write endpoint directly, not via the agentforge API or the LLM propose-write tool path

- **Prompt:** Implicit during G2-Early-26 design — when the user clicks Confirm on the IntakeProposalCard, what's the most coherent path to actually persist the rows?
- **Recommendation:** Skip the LLM round-trip entirely. The user has already reviewed and confirmed the card; routing through the LLM would be slow, lose UI coherence, and add no value (the LLM has no state to add). Mint client-side `proposal_id`s and POST directly to `write/*.php` — the endpoints already accept fresh proposal_ids and dedupe via the `agentforge_completed_write_proposal` ledger.
- **Outcome:** New `intake_dispatch.ts` exports `dispatchIntakeConfirm(env, data)` which fans out per-section: chief_concern → `write/chief_complaint.php`, allergies[] → one `write/allergy.php` POST per row, medications[] → one `write/medication_add.php` POST per row, family_history[] → one `write/family_history_add.php` POST per row, demographics → surfaced as `skipped`. Per-row outcomes aggregated; per-section status pills render after Confirm. New `postModuleWrite` API client. App.tsx threads `intakeDispatchEnv` through MessageList → renderBlock → IntakeProposalCard. The TS propose-write tools (G2-Early-25) still exist for the LLM-driven scenarios — they're a separate surface.

### Decision: lab-summary swallowed-exception was a missing global include, not a service-layer bug

- **Prompt:** Implicit during G2-Early-27 — the original engineer's note said *"Confirm hits a generic 'write failed' in `ClinicalNoteWriteAction.execute()` (the W1 PHP catch-all that swallows the underlying ClinicalNotesService exception)"*. Was it actually a ClinicalNotesService bug?
- **Recommendation:** Investigate at module-boundary level first — the bug is more likely in what's loaded vs. what's called. Found the smoking gun: `ClinicalNotesService::createClinicalNotesParentForm()` calls the global `addForm()` from `library/forms.inc.php`, which the module HTTP entry's `agentforge_require_globals()` doesn't pull in. So the *first* clinical-note write on a fresh new-patient encounter (where no `forms` row exists yet) died with `Call to undefined function addForm()`, caught by `\Throwable` and surfaced as `'write failed'`. Same shape `AppointmentEncounterBinder.php` already had to fix (it `require_once`s `forms.inc.php` for the same reason at line 301).
- **Outcome:** `OpenEmrClinicalNoteAdapter::__construct` now does `require_once $GLOBALS['srcdir'] . '/forms.inc.php'` (defensive `is_string` + `is_readable` guards). `ClinicalNoteWriteAction`'s `\Throwable` catch now `error_log()`s the exception class + message so future failures surface in `devtools php-log` (still returns generic `'write failed'` to keep PHI out of the audit DB). Orchestrator's `maybeBuildLabSummaryProposal` re-enabled and emits the proposal block right after the extraction block.

### Decision: medications go through direct SQL, not `ListService`

- **Prompt:** Implicit during G2-Early-20 — should `MedicationAddAction` wrap `ListService::insert()` like the brief implies, or write SQL directly?
- **Recommendation:** Direct SQL via `QueryUtils`. `ListService::insert()` (lines 186-208 of `src/Services/ListService.php`) doesn't accept a `uuid` column or `comments` field — both of which we need (uuid for the agent's later discontinue lookup; comments for dose+frequency+sig composite). And `ListService::delete()` is hard DELETE, but the brief calls for soft-delete (`activity=0`). The W2 demo cohort uses empty charts so reuse risk is zero — we own the medication row inserts end-to-end. The `MedicationPatientIssueService::createIssue()` metadata path is skipped for the demo.
- **Outcome:** `OpenEmrPatientMedicationAdapter` does `INSERT INTO lists (uuid, date, type, title, comments, begdate, activity, pid) VALUES (?, NOW(), 'medication', ?, ?, NOW(), 1, ?)` with a fresh UUID via `(new UuidRegistry(['table_name' => 'lists']))->createUuid()`. The discontinue path is `UPDATE lists SET activity=0, enddate=NOW() WHERE uuid=? AND pid=? AND type='medication' LIMIT 1` with a pre-check that the row exists.

### Decision: family-history adapter writes free-text columns idempotently

- **Prompt:** Implicit during G2-Early-23 — there's no dedicated family-history service; `history_data` has fixed `history_father / history_mother / relatives_diabetes` columns. How to model "add (mother, T2DM)"?
- **Recommendation:** Map the relation token to one of 5 free-text columns (`history_mother / history_father / history_siblings / history_offspring / history_spouse`). Skip the boolean `relatives_*` columns (they're a different UX in the History form layout). Idempotent: read existing column value, only append if condition not already present, append separated by `\n`. Insert `history_data` row if missing (upsert).
- **Outcome:** `FamilyHistoryAddPayload::RELATION_TO_COLUMN` maps 11 relation aliases to those 5 columns. `OpenEmrPatientFamilyHistoryAdapter` enforces a hardcoded `ALLOWED_COLUMNS` allowlist (defense in depth — payload parser already enforces but adapter never trusts). Idempotency check is case-insensitive line-scan against `\n / \r / , / ;` separators.

### Decision: document soft-delete uses sidecar JSON, not the `documents` table

- **Prompt:** Implicit during G2-Early-24 — the journal documented W2 documents are stored at `sites/default/documents/agentforge_w2/{uuid}.bin` + `.json` sidecar, not in the OpenEMR `documents` MySQL table. So where does the soft-delete flag live?
- **Recommendation:** Sidecar JSON. Add `deleted_at` timestamp on soft-delete; `findExistingDocRef` and `fetch` both skip rows with `deleted_at`. Cascade: scan `_obs/*.json` and add `deleted_at` to every observation whose `docref_uuid` matches.
- **Outcome:** `OpenEmrDocumentRepository` extended to also implement new `DocumentDeletePort`. `softDeleteDocRefAndCascadeObservations` writes ISO timestamp + cascades. Re-deleting an already-deleted DocRef returns ok=true with cascade count 0 (idempotent).

### Decision: demographics edit deferred to LLM tool surface, not IntakeProposalCard

- **Prompt:** Implicit during G2-Final-10/11/12 — the spec calls for IntakeProposalCard per-row edit, but demographics row in the card isn't dispatchable on Confirm (Demographics dispatch is skipped per the §9 dispatch matrix). Should the row be editable anyway?
- **Recommendation:** No. Edit affordance only on rows that actually dispatch. Demographics edits flow via the LLM's `propose_demographics_update` tool — physician dictates *"correct her phone to 555-0149"* and the LLM proposes the update. That keeps the IntakeProposalCard's edit affordance honest (only what dispatch produces).
- **Outcome:** Per-row pencil button on medications, allergies, family-history, and chief-concern rows. Demographics stays read-only. `propose_demographics_update` Zod schema allows any non-empty subset of `{first_name, last_name, middle_name, dob, sex, contact_phone}`; PHP backend maps to canonical `patient_data` columns; SQL is direct UPDATE with hardcoded ALLOWED_COLUMNS allowlist. `apply_pending_write.ts` extended with the new write target so the W1 `/conversations/:id/confirm` path can also apply it.

## Trade-offs and alternatives

- **Single composite `W2WriteAction` instead of 6 separate Actions** — rejected for the same reason it was rejected mid-session in [`0506-T2150`](0506-T2150-w2-session-wrap-and-handoff.md): less per-target test isolation, harder to cut individual targets later. Sticking with the W1 one-action-per-target pattern paid off — the test files line up cleanly per target.
- **Demographics editable directly in IntakeProposalCard** — rejected for the reason above (would render an edit affordance that didn't dispatch).
- **Browser-side `proposal_id` minting vs. agent-API mediated** — chose browser-side; trade-off was minimal because the module's `agentforge_completed_write_proposal` ledger is the actual idempotency source of truth. The pending_proposals table on the agent side is W1's proposal-confirm flow, not strictly required for direct UI dispatch.

## Tools, dependencies, commands

_None this session_ — no new tooling installed. All work within the existing Vitest / `npm run eval` / `composer phpunit-isolated` toolchain. CUI deps installed in worktree (`npm install`) so vitest could run; agent API deps were already installed from the prior session.

## Files touched

**Created (43):**

PHP (29 files):
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/MedicationAddPayload.php` + `MedicationDiscontinuePayload.php` + `AllergyDeletePayload.php` + `FamilyHistoryAddPayload.php` + `DemographicsUpdatePayload.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/PatientMedicationWritePort.php` + `PatientFamilyHistoryWritePort.php` + `PatientDemographicsWritePort.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/OpenEmrPatientMedicationAdapter.php` + `OpenEmrPatientFamilyHistoryAdapter.php` + `OpenEmrPatientDemographicsAdapter.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/MedicationAddAction.php` + `MedicationDiscontinueAction.php` + `AllergyDeleteAction.php` + `FamilyHistoryAddAction.php` + `DemographicsUpdateAction.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Documents/DocumentDeletePort.php` + `DocumentDeletePayload.php` + `DocumentDeleteAction.php`
- `interface/modules/custom_modules/oe-module-agentforge/src/Http/WriteMedicationAdd.php` + `WriteMedicationDiscontinue.php` + `WriteAllergyDelete.php` + `WriteFamilyHistoryAdd.php` + `WriteDemographicsUpdate.php` + `DeleteDocument.php`
- `interface/modules/custom_modules/oe-module-agentforge/public/write/medication_add.php` + `medication_discontinue.php` + `allergy_delete.php` + `family_history_add.php` + `demographics_update.php`
- `interface/modules/custom_modules/oe-module-agentforge/public/document/delete.php`

PHP isolated tests (6):
- `tests/Tests/Isolated/Modules/AgentForge/MedicationAddActionIsolatedTest.php`
- `tests/Tests/Isolated/Modules/AgentForge/MedicationDiscontinueActionIsolatedTest.php`
- `tests/Tests/Isolated/Modules/AgentForge/AllergyDeleteActionIsolatedTest.php`
- `tests/Tests/Isolated/Modules/AgentForge/FamilyHistoryAddActionIsolatedTest.php`
- `tests/Tests/Isolated/Modules/AgentForge/DocumentDeleteActionIsolatedTest.php`
- `tests/Tests/Isolated/Modules/AgentForge/DemographicsUpdateActionIsolatedTest.php`

TS (2):
- `agentforge/cui/src/chat/intake_dispatch.ts`
- `agentforge/cui/src/chat/intake_dispatch.test.ts`

Eval cases (5):
- `agentforge/api/eval/cases/curated/w2-cross-patient-{medication-add, medication-discontinue, allergy-delete, family-history-add, document-delete}-blocked.json`

Journal:
- `Documentation/AgentForge/process/journal/week-2/0507-T0034-w2-write-tools-end-to-end-build.md` (this file)

**Modified (21):**

- `agentforge/api/src/agent/orchestrator.ts` (re-enabled `maybeBuildLabSummaryProposal`)
- `agentforge/api/src/conversations/apply_pending_write.ts` (+6 new write targets in WRITE_TARGETS + RELATIVE_PATH)
- `agentforge/api/src/tools/propose_writes.ts` (+6 new propose tools, +6 Zod schemas in `exportedSchemasGate4`)
- `agentforge/api/test/agent/orchestrator.test.ts` (tool-list assertion bumped 20→26 for the new W2 names)
- `agentforge/api/test/contract/module-http-paths.test.ts` (manifest path-count 15→21)
- `agentforge/api/test/tools/propose_writes_schema.test.ts` (+8 new W2 schema tests + 4 G2-Final-12 demographics tests; 4→16 total)
- `agentforge/api/eval/baseline.json` (re-pinned `w2-early-2026-05-06b`; safe_refusal 35→40 cases; total 50→55)
- `agentforge/cui/src/App.tsx` (constructs `intakeDispatchEnv` and passes to MessageList)
- `agentforge/cui/src/api/client.ts` (+`postModuleWrite` API client function)
- `agentforge/cui/src/chat/IntakeProposalCard.tsx` (full rewrite for G2-Early-26 + G2-Final-10: dispatch + per-row edit)
- `agentforge/cui/src/chat/MessageList.tsx` (threads `intakeDispatchEnv` through `renderBlock`; lab summary preview text refresh)
- `agentforge/cui/src/index.css` (+section status pill + per-row layout + editor styling)
- `agentforge/contracts/module-http-paths.json` (+6 paths; 15→21)
- `interface/modules/custom_modules/oe-module-agentforge/src/Documents/OpenEmrDocumentRepository.php` (implements `DocumentDeletePort`; soft-delete + cascade; reads filter `deleted_at`)
- `interface/modules/custom_modules/oe-module-agentforge/src/Http/ModuleHttpContract.php` (+6 anchor entries; pathsFromPhpAnchors count 15→21)
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/ClinicalNoteWriteAction.php` (`\Throwable` catch now `error_log()`s exception detail)
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/OpenEmrClinicalNoteAdapter.php` (constructor `require_once`s `forms.inc.php` so `addForm()` resolves on first new-patient note)
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/OpenEmrPatientAllergyAdapter.php` (+`softDeleteAllergyByUuid` method)
- `interface/modules/custom_modules/oe-module-agentforge/src/Write/PatientAllergyWritePort.php` (+`softDeleteAllergyByUuid` interface method)
- `tests/Tests/Isolated/Modules/AgentForge/AllergyWriteActionIsolatedTest.php` (mock `onlyMethods` extended with `softDeleteAllergyByUuid`)
- `tests/Tests/Isolated/Modules/AgentForge/ModuleHttpContractTest.php` (+`Delete*.php` glob pattern; assertCount 15→21)
- `TASKS.md` (G2-Early-20..27 + G2-Early-36 + G2-Final-10/11/12 reopened from cut and marked done with full proofs; G2-Early-60 marked done as no-op)

## Outcomes

- **All cut rows delivered + tested:** G2-Early-20..27 + G2-Early-36 + G2-Final-10/11/12 are `[x]` complete with done-proofs in TASKS.md.
- **Test totals:** PHP isolated 63/63 green (was 34/34 — 22 new tests + 7 demographics). Agent API vitest 304 pass + 1 skip + 0 fail (was 292 — net +12). CUI vitest 68 pass (the 5 pre-existing pdfjs/jsdom file-load failures unchanged from baseline). **Eval gate 55/55, baseline_version w2-early-2026-05-06b, gate_breaches:0.**
- **Brief MUST set still held:** schemas + tests, eval gate, supervisor inspectability, citation contract + bbox, observability fields all green from G2-Early — none of this work regressed any of those.
- **Lab summary auto-write functional end-to-end** for the first time: previous "captured for chart write" stub messaging removed; the proposal block now actually persists on Confirm.

## Next steps

- [ ] **Operator-pending — VPS redeploy (G2-Early-60..63):** prod docker-compose pgvector mirror is already a no-op; operator runs the full local-DB import, `npm run rag-index` against prod, and the smoke E2E checklist (G2-MVP-99's 11 acceptance points re-run on the deployed URL).
- [ ] **G2-Early-64 — Demo video v1 (operator).**
- [ ] **G2-Final-Rehearsal — Saturday 2026-05-09:** all 5 self-injection scenarios — drop citation field, loosen Zod, disable prompt-injection guard, log raw quote_or_value, allow unverified fact through. Each: inject locally, confirm both Git Hook + GitHub Actions fail, revert.
- [ ] **G2-Final-20 + G2-Final-50 operator data-fill:** Anthropic + Cohere + Langfuse dashboard numbers; deployed URL + video URL + GitLab URL.
- [ ] **G2-Final-40 — Demo video final cut.**
- [ ] **G2-Final-60 — Cellular smoke (Sat afternoon + Sun 11:30).**
- [ ] **G2-Final-70 — HTTPS (tier 1 cut authorized).**
- [ ] **G2-Final-71 — Re-run `seed_appointments.php` against local + prod.**
- [ ] **G2-Final-99 — Submit by Sun 12:00 PM CT.**

## Links

- Predecessor session: [0506-T2150](0506-T2150-w2-session-wrap-and-handoff.md)
- Numbered milestone: [process/milestones/week-2/04-g2-early-gate-completion.md](../../milestones/week-2/04-g2-early-gate-completion.md)
- Brief: [Week 2 - AgentForge Clinical Co-Pilot.pdf](../../../references/Week%202%20-%20AgentForge%20Clinical%20Co-Pilot.pdf)
- W2 Architecture: [W2_ARCHITECTURE.md](../../../../W2_ARCHITECTURE.md)
- W2 Tasks: [TASKS.md](../../../../TASKS.md)
