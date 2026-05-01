<?php

/**
 * Port for EncounterService vitals insert (PRD §4.7 — VitalsService via insertVital).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface EncounterVitalsWritePort
{
    /**
     * @param array<string, mixed> $vitalsInsertRow Keys for {@see \OpenEMR\Services\EncounterService::insertVital()} after validateVital.
     */
    public function insertVitalsForEncounter(int $pid, int $encounterNumericId, array $vitalsInsertRow): ConfirmedWriteOutcome;
}
