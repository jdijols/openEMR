<?php

/**
 * W2 intake-bundle — port for medical problem (problem list) add against
 * `lists` (type='medical_problem'). Mirrors `PatientMedicationWritePort`; the
 * problem-list intake row uses the same canonical OpenEMR "Issues" surface
 * (lists table) the chart-shell UI writes against.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface PatientMedicalProblemWritePort
{
    /**
     * Insert a `lists` row of type='medical_problem' bound to the patient by pid.
     * Active rows mint with activity=1; inactive/resolved rows mint with
     * activity=0, and resolved additionally stamps enddate=NOW(). The row uses
     * a fresh v4 UUID (binary 16) so it appears in FHIR Condition reads.
     *
     * @param array{
     *   title: string,
     *   comments: ?string,
     *   begdate: ?string,
     *   status: 'active'|'inactive'|'resolved',
     * } $fields
     */
    public function insertMedicalProblemForPatient(int $patientPid, array $fields): ConfirmedWriteOutcome;
}
