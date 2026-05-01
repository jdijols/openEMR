<?php

/**
 * Port for SocialHistory tobacco insert (Gate 4 G4-03).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface PatientTobaccoHistoryWritePort
{
    /**
     * Adds a history_data row whose `tobacco` column uses HIS pipe encoding.
     */
    public function insertTobaccoForPatient(int $pid, string $tobaccoPipeValue): ConfirmedWriteOutcome;
}
