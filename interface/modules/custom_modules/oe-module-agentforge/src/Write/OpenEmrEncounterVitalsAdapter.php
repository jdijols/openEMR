<?php

/**
 * Production adapter — validateVital + insertVital on EncounterService.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Services\EncounterService;

final class OpenEmrEncounterVitalsAdapter implements EncounterVitalsWritePort
{
    public function __construct(
        private readonly EncounterService $encounterService,
    ) {
    }

    public function insertVitalsForEncounter(int $pid, int $encounterNumericId, array $vitalsInsertRow): ConfirmedWriteOutcome
    {
        $encRow = $this->encounterService->getOneByPidEid($pid, $encounterNumericId);
        if ($encRow === []) {
            return ConfirmedWriteOutcome::openemrRejected('encounter not found');
        }

        $validation = $this->encounterService->validateVital($vitalsInsertRow);
        if (is_object($validation) && method_exists($validation, 'isValid') && !$validation->isValid()) {
            return ConfirmedWriteOutcome::openemrRejected('vitals rejected');
        }

        try {
            $this->encounterService->insertVital($pid, $encounterNumericId, $vitalsInsertRow);
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }
}
