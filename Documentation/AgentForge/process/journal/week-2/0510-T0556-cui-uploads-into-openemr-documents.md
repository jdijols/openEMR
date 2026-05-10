---
date: 2026-05-10
topic: CUI uploads land in OpenEMR Documents tab + provenance ledger
related_milestone: none
---

# CUI uploads into OpenEMR Documents — session journal

## Goal

Wire CUI chat uploads into OpenEMR's canonical `documents` table so files
appear in the patient's Documents tab (under a new "Clinical Copilot"
folder), get reclassified after extraction, and stamp provenance back to
clinical writes. End the session with the post-extraction "View in
documents" link navigating the chart shell's main content area to the
file viewer (not a new tab).

## Context

Pre-session, CUI uploads only landed in `sites/default/documents/agentforge_w2/{uuid}.bin`
sidecars. The agent could read them via `attach_and_extract`, but they
were invisible to OpenEMR's chart UI, FHIR DocumentReference, drive
encryption, and ACL — a "shadow store". User wanted clinicians to see
those files in the Documents tab.

## Key decisions

### Decision: dual-write to OpenEMR `documents` (best-effort)

- **Prompt:** "Where are files, documents that are uploaded to a patient's chart, like a PDF file or a PNG file for an intake form or lab results, stored within OpenEMR?"
- **Recommendation:** Project the existing `agentforge_w2/` upload into OpenEMR's canonical `documents` table on every successful upload via `Document::createDocument()`, but treat it as best-effort — failure logs and continues, the agent still has the sidecar copy. Keep both stores during demo, clean up later.
- **Outcome:** New [OpenEmrDocumentsRegistrarPort](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/OpenEmrDocumentsRegistrarPort.php) + `OpenEmrDocumentsRegistrarAdapter` wired into [DocumentUploadAction](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/DocumentUploadAction.php). Sidecar gets stamped with `oe_document_id`.

### Decision: "Clinical Copilot" inbox + post-extraction reclassify

- **Prompt:** "sometimes the file name might not be explicit about what type of file it is… we just have to determine which category to upload it to, whether it's a lab or an intake form, by some means when it's not clear."
- **Recommendation:** Don't try to be smart at upload time. Always upload to a single "Clinical Copilot" inbox category, then move to "Lab Report" / "Patient Information" after extraction's parsed-content verdict (not the brittle filename regex). On uncertain extraction, file stays in the inbox — safe default.
- **Outcome:** [ClinicalCopilotCategoryInstaller](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/ClinicalCopilotCategoryInstaller.php) (idempotent nested-set INSERT), [public/document/reclassify.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/document/reclassify.php) endpoint, fire-and-forget `reclassifyDocument` callback in [attach_and_extract.ts](../../../../../agentforge/api/src/tools/attach_and_extract.ts).

### Decision: provenance via ledger column, not per-row

- **Prompt:** "I also love your provenance bonus. Let's do that too."
- **Recommendation:** Add `source_docref_uuid VARCHAR(64) NULL` to `agentforge_completed_write_proposal` (the existing ledger). Thread the docref through `propose_*_write` payload as a `_source_docref_uuid` metadata key, lift to top-level body in `apply_pending_write.ts`, store in ledger on success. Implement allergy end-to-end this PR; mechanical follow-up extends to other writes via the same `liftMetadataKeys` helper.
- **Outcome:** Schema in [sql/table.sql](../../../../../interface/modules/custom_modules/oe-module-agentforge/sql/table.sql). Threading in [AllergyWriteAction.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/AllergyWriteAction.php), [allergy.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/write/allergy.php), [propose_writes.ts](../../../../../agentforge/api/src/tools/propose_writes.ts:239), [apply_pending_write.ts](../../../../../agentforge/api/src/conversations/apply_pending_write.ts).

### Decision: GenID('categories_seq') for nested-set INSERT

- **Prompt:** Error log showed `Duplicate entry '0' for key 'PRIMARY'` on every retry of the category installer.
- **Recommendation:** OpenEMR's `categories.id` is **not** AUTO_INCREMENT — `Tree::add_node()` allocates via `$db->GenID('categories_seq')`. My first cut INSERTed without `id`, MariaDB defaulted to 0, retries clashed and bumped lft/rght each time. Switch to GenID, wrap in `QueryUtils::inTransaction()` so failures roll back the tree shift.
- **Outcome:** [ClinicalCopilotCategoryInstaller.php](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Documents/ClinicalCopilotCategoryInstaller.php) rewritten. One-shot DB repair: `DELETE FROM categories WHERE id = 0 AND name = 'Clinical Copilot'`.

### Decision: "View in documents" navigates main content area, not new tab

- **Prompt:** "I want it to navigate the Main Content Area, where the dashboard is, to the Documents tab and open the document right there… We do this in other implementations, like when we reference encounters or visit history through other buttons in the CUI header."
- **Recommendation:** Mirror the existing `requestEncounterNavigation` / `requestVisitHistoryNavigation` pattern. CUI posts `NAV_REQUEST` with `kind: 'document'`; rail container's `navigateDocumentInChrome(documentId, patientPid)` helper calls `topWin.navigateTab(url, 'pat', ...)` so the file opens in the patient panel where the Dashboard / Visit History live.
- **Outcome:** [rail_container.html.twig](../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig) gains the helper + handler; [App.tsx](../../../../../agentforge/cui/src/App.tsx) `onViewInDocuments` swaps `window.open` for `postMessage`.

### Decision: URL params are positional in OpenEMR's legacy router

- **Prompt:** Screenshot showed "Not authorized to view requested file" on the document deep-link.
- **Recommendation:** `Controller.act()` (legacy positional dispatcher) reads `$_GET` keys in URL order and passes them positionally to `view_action($patient_id, $doc_id)`. My URL had `document_id` before `patient_id` — args swapped, IDOR check failed. Match OpenEMR's own convention ([general_list.html:177](../../../../../templates/documents/general_list.html:177)): `patient_id` always first.
- **Outcome:** Helper now emits `?document&view&patient_id=Y&document_id=X` with a comment explaining why the order is load-bearing.

## Trade-offs and alternatives

- **Backfill script for legacy `agentforge_w2/`-only uploads** — deferred. Existing files won't appear in Documents tab without a one-shot migration; user can request when needed.
- **Provenance via per-table column on `lists`/`forms`/etc.** — rejected. Single ledger column is far less invasive and joins cleanly. Other write paths can adopt the same `_source_docref_uuid` payload-stash pattern incrementally.
- **`window.open(url, '_blank')` for the documents link** — initial implementation; user vetoed in favor of in-shell navigation matching the encounter / visit-history pattern.
- **`generateId()` (global `sequences` pool) for category id** — rejected because the categories table has stock seeded ids 1–30 that the global pool didn't allocate; collision risk. `categories_seq` is what `Tree::add_node` uses on this table.

## Tools, dependencies, commands

- One-time DB repair after the buggy installer's retries:
  ```
  docker compose exec openemr mariadb -uopenemr -popenemr openemr -e \
    "DELETE FROM categories WHERE id = 0 AND name = 'Clinical Copilot'"
  ```
- Opcache reset to pick up patched PHP without container restart:
  ```
  docker compose exec openemr bash -c 'php -r "opcache_reset();"'
  ```
- CUI bundle rebuild (Twig templates served live, but JS needs build):
  ```
  cd agentforge/cui && npx vite build
  ```

## Files touched

- **Created:**
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/ClinicalCopilotCategoryInstaller.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/OpenEmrDocumentsRegistrarPort.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/OpenEmrDocumentsRegistrarAdapter.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/NoopOpenEmrDocumentsRegistrar.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/DocumentReclassifyPort.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/OpenEmrDocumentReclassifyAdapter.php`
  - `interface/modules/custom_modules/oe-module-agentforge/public/document/reclassify.php`
- **Modified:**
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/DocumentUploadAction.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/DocumentUploadPort.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/DocumentUploadResult.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Documents/OpenEmrDocumentRepository.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Write/AllergyWriteAction.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Write/CompletedWriteProposalLedgerInterface.php`
  - `interface/modules/custom_modules/oe-module-agentforge/src/Write/MysqlCompletedWriteProposalLedger.php`
  - `interface/modules/custom_modules/oe-module-agentforge/sql/table.sql`
  - `interface/modules/custom_modules/oe-module-agentforge/sql/001_module_install.sql`
  - `interface/modules/custom_modules/oe-module-agentforge/public/upload/document.php`
  - `interface/modules/custom_modules/oe-module-agentforge/public/write/allergy.php`
  - `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig`
  - `agentforge/api/src/tools/attach_and_extract.ts`
  - `agentforge/api/src/tools/propose_writes.ts`
  - `agentforge/api/src/agent/w2_tools.ts`
  - `agentforge/api/src/agent/system_prompt.ts`
  - `agentforge/api/src/conversations/apply_pending_write.ts`
  - `agentforge/cui/src/App.tsx`
  - `agentforge/cui/src/api/client.ts`
  - `agentforge/cui/src/chat/MessageList.tsx`
  - `agentforge/cui/src/types/chat.ts`
  - 10 PHPUnit isolated tests under `tests/Tests/Isolated/Modules/AgentForge/` (ledger interface widening + DocumentUploadAction ctor)

## Outcomes

- CUI uploads now create a row in OpenEMR's `documents` table under the new "Clinical Copilot" category, with the same encryption-at-rest, hash, ACL, and FHIR DocumentReference path as native uploads.
- After extraction succeeds, the file moves to "Lab Report" or "Patient Information" automatically; uncertain extractions stay in the Clinical Copilot inbox.
- Allergy writes derived from extraction stamp `source_docref_uuid` on the `agentforge_completed_write_proposal` ledger row — clickable provenance back to the source PDF.
- Post-extraction CUI link "View in documents" navigates the chart shell's patient panel to the document viewer in-place (no new tab), mirroring the encounter / visit-history nav pattern.

## Next steps

- [ ] Backfill script for legacy `agentforge_w2/`-only uploads so prior files surface in the Documents tab.
- [ ] Extend `_source_docref_uuid` provenance threading to medication / family history / vitals write paths (mechanical, infrastructure already in place).
- [ ] Optionally collapse the dual store: have `attach_and_extract`'s bytes fetcher read from the OpenEMR `documents` filesystem path, then deprecate the `agentforge_w2/` sidecar.

## Links

- Numbered milestone: _none this session — additive feature, no new milestone created._
- Related journal: [0509-T2237-w2-card-collapse-and-layout-polish.md](0509-T2237-w2-card-collapse-and-layout-polish.md)
