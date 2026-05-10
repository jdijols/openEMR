-- AgentForge module install (PRD §3.2 `001_module_install.sql` — OpenEMR Module Manager entry: sql/table.sql)
-- Gate 1 G1-01 — launch-code storage + optional log.correlation_id

#IfNotTable agentforge_launch_code
CREATE TABLE `agentforge_launch_code` (
    `code` VARCHAR(64) NOT NULL,
    `user_id` BIGINT(20) NOT NULL,
    `patient_uuid` VARCHAR(64) DEFAULT NULL,
    `encounter_id` BIGINT(20) DEFAULT NULL,
    `issued_at` DATETIME NOT NULL,
    `redeemed_at` DATETIME DEFAULT NULL,
    PRIMARY KEY (`code`),
    KEY `idx_user_issued` (`user_id`, `issued_at`)
) ENGINE=InnoDB;
#EndIf

#IfMissingColumn log correlation_id
ALTER TABLE `log` ADD COLUMN `correlation_id` VARCHAR(64) NOT NULL DEFAULT '';
#EndIf

#IfNotTable agentforge_completed_write_proposal
CREATE TABLE `agentforge_completed_write_proposal` (
    `proposal_id` VARCHAR(191) NOT NULL,
    `write_target` VARCHAR(64) NOT NULL,
    `recorded_at` DATETIME NOT NULL,
    `source_docref_uuid` VARCHAR(64) DEFAULT NULL,
    PRIMARY KEY (`proposal_id`),
    KEY `idx_source_docref` (`source_docref_uuid`)
) ENGINE=InnoDB;
#EndIf

-- Provenance: when a propose-write originates from an `attach_and_extract`
-- document, the api stamps the source DocRef UUID onto the apply call so
-- the ledger can record it. Idempotent ALTER for installs that pre-date
-- the column.
#IfMissingColumn agentforge_completed_write_proposal source_docref_uuid
ALTER TABLE `agentforge_completed_write_proposal`
    ADD COLUMN `source_docref_uuid` VARCHAR(64) DEFAULT NULL,
    ADD KEY `idx_source_docref` (`source_docref_uuid`);
#EndIf
