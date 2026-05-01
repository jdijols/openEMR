<?php

/**
 * Narrow port for EncounterService-backed chief complaint updates — keeps UC-B logic testable isolated.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Validators\ProcessingResult;

interface EncounterChiefComplaintPort
{
    /**
     * @return array<string, mixed>
     */
    public function getOneByPidEid(int $pid, int $encounterNumericId): array;

    /**
     * @param array<string, mixed> $patch
     *
     * @return ProcessingResult|string OpenEMR may return ProcessingResult or a sentinel string error.
     */
    public function updateEncounterReason(string $puuid, string $euuid, array $patch): ProcessingResult|string;
}
