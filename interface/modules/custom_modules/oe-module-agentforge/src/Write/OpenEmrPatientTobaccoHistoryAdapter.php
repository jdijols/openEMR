<?php

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Services\SocialHistoryService;

final class OpenEmrPatientTobaccoHistoryAdapter implements PatientTobaccoHistoryWritePort
{
    public function insertTobaccoForPatient(int $pid, string $tobaccoPipeValue): ConfirmedWriteOutcome
    {
        if ($pid <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        }

        try {
            $svc = new SocialHistoryService();
            $svc->create(['pid' => $pid, 'tobacco' => $tobaccoPipeValue]);
        } catch (\InvalidArgumentException) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }
}
