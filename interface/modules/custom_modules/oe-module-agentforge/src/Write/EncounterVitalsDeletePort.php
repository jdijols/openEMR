<?php

/**
 * Port for soft-deleting (voiding) a single vitals form row by its UUID.
 * The implementation must:
 *   - look up the form_vitals row by UUID (binary form),
 *   - verify the row belongs to (pid, encounter_id),
 *   - flip forms.activity = 0 (HIPAA-defensible soft-delete preserving audit).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface EncounterVitalsDeletePort
{
    public function softDeleteVitalsByUuid(int $pid, int $encounterNumericId, string $vitalsUuidString): ConfirmedWriteOutcome;
}
