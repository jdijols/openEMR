<?php

/**
 * G2-Final-11 — port for partial demographics updates against `patient_data`.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface PatientDemographicsWritePort
{
    /**
     * Apply a non-empty validated partial-update patch to a patient_data row.
     *
     * @param array<non-empty-string, string> $columnPatch keys are validated by the payload parser.
     */
    public function updateDemographicsForPatient(int $patientPid, array $columnPatch): ConfirmedWriteOutcome;
}
