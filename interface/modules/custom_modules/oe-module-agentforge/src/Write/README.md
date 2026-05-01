# Write services (`OpenEMR\Modules\AgentForge\Write`)

UC-B confirmed-write logic (PRD §4.7). Production entrypoints live under `public/write/*.php`; portable rules are implemented here for PHPUnit coverage without booting the full stack.

- **Chief complaint** — `ChiefComplaintWriteAction` + `OpenEmrEncounterChiefComplaintAdapter` → `EncounterService::updateEncounter` (`form_encounter.reason`).
- **Vitals** — `VitalsWritePayload` + `VitalsWriteAction` + `OpenEmrEncounterVitalsAdapter` → `EncounterService::validateVital` / `insertVital` (`form_vitals`). Pain maps to `note` as `Pain score: …`.
- **Tobacco** — `TobaccoWritePayload` (strict PRD enums → `smoking_status` ids) + `TobaccoWriteAction` + `OpenEmrPatientTobaccoHistoryAdapter` → `SocialHistoryService::create` (`history_data.tobacco` pipe encoding).
- **Confirmed outcome** — shared `ConfirmedWriteOutcome` for UC-B write responses (`accepted` / `openemr_rejected`).
- **Proposal dedupe** — `MysqlCompletedWriteProposalLedger` → `agentforge_completed_write_proposal` (module bookkeeping only).
