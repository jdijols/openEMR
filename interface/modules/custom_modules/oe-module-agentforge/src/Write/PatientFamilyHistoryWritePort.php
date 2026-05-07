<?php

/**
 * G2-Early-23 — port for adding family-history entries to the patient's `history_data` row.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface PatientFamilyHistoryWritePort
{
    /**
     * Append a family-history condition to the supplied `history_data` column for a patient.
     * Idempotent: if `condition` already appears in the existing column value, no-op accept.
     * Inserts a `history_data` row if none exists for the patient.
     *
     * @param non-empty-string $columnName One of the validated history_data column names
     *                                     (history_mother / history_father / etc.).
     */
    public function appendFamilyHistoryEntry(int $patientPid, string $columnName, string $condition): ConfirmedWriteOutcome;
}
