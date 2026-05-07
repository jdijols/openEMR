<?php

/**
 * G2-Early-20/21 — port for medication add + discontinue against `lists` (type='medication').
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface PatientMedicationWritePort
{
    /**
     * Insert a `lists` row of type 'medication' bound to the patient by pid. The row is
     * minted active (activity=1) with a fresh UUID. Caller supplies the optional schema-
     * driven fields; null values are not written, so a partial extraction doesn't clobber
     * existing chart data.
     *
     * @param array{
     *   title: string,
     *   comments: ?string,
     *   begdate: ?string,
     *   enddate: ?string,
     *   diagnosis: ?string,
     * } $fields
     */
    public function insertMedicationForPatient(int $patientPid, array $fields): ConfirmedWriteOutcome;

    /**
     * Soft-delete (discontinue) the `lists` medication row identified by UUID. Sets
     * activity=0 and stamps enddate=NOW(); preserves the row for audit. The pid scope is
     * verified before the update so cross-patient discontinues are rejected.
     */
    public function softDeleteMedicationByUuid(int $patientPid, string $medicationUuidString): ConfirmedWriteOutcome;
}
