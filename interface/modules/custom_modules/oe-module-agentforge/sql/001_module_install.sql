-- Canonical DDL for documentation / PRD §3.2 (mirrors sql/table.sql for Module Manager).
-- AgentForge Gate 1 — see sql/table.sql (installed by OpenEMR custom module pipeline).

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
    PRIMARY KEY (`proposal_id`)
) ENGINE=InnoDB;
#EndIf
