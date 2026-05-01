<?php

/**
 * Production adapter — delegates to EncounterService (PRD §4.7, no clinical raw SQL).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Services\EncounterService;
use OpenEMR\Validators\ProcessingResult;

final class OpenEmrEncounterChiefComplaintAdapter implements EncounterChiefComplaintPort
{
    public function __construct(
        private readonly EncounterService $encounterService,
    ) {
    }

    public function getOneByPidEid(int $pid, int $encounterNumericId): array
    {
        /** @var array<string, mixed> */
        return $this->encounterService->getOneByPidEid($pid, $encounterNumericId);
    }

    /** @inheritDoc */
    public function updateEncounterReason(string $puuid, string $euuid, array $patch): ProcessingResult|string
    {
        $result = $this->encounterService->updateEncounter($puuid, $euuid, $patch);

        return $result;
    }
}
