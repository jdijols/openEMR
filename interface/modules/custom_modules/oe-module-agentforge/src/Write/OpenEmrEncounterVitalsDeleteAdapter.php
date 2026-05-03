<?php

/**
 * Production adapter — soft-deletes a vitals row by UUID via QueryUtils.
 * The form_vitals row is matched by UUID + pid; encounter binding is verified
 * before the forms.activity flip so cross-encounter deletes are rejected.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Uuid\UuidRegistry;

final class OpenEmrEncounterVitalsDeleteAdapter implements EncounterVitalsDeletePort
{
    public function softDeleteVitalsByUuid(int $pid, int $encounterNumericId, string $vitalsUuidString): ConfirmedWriteOutcome
    {
        $hexUuid = '';
        try {
            $hexUuid = UuidRegistry::uuidToBytes($vitalsUuidString);
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('vitals not found');
        }

        if ($hexUuid === '') {
            return ConfirmedWriteOutcome::openemrRejected('vitals not found');
        }

        $rows = QueryUtils::fetchRecords(
            "SELECT id, eid FROM form_vitals WHERE uuid = ? AND pid = ? LIMIT 1",
            [$hexUuid, $pid],
        );

        if (!\is_array($rows) || \count($rows) === 0) {
            return ConfirmedWriteOutcome::openemrRejected('vitals not found');
        }

        $row = $rows[0];
        $formVitalsId = isset($row['id']) && \is_numeric($row['id']) ? (int) $row['id'] : 0;
        $rowEid = isset($row['eid']) && \is_numeric($row['eid']) ? (int) $row['eid'] : 0;

        if ($formVitalsId <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('vitals not found');
        }

        if ($rowEid !== $encounterNumericId) {
            return ConfirmedWriteOutcome::openemrRejected('encounter mismatch');
        }

        try {
            QueryUtils::sqlStatementThrowException(
                "UPDATE forms SET activity = 0 WHERE form_id = ? AND formdir = 'vitals' AND pid = ? AND encounter = ? LIMIT 1",
                [$formVitalsId, $pid, $encounterNumericId],
            );
            QueryUtils::sqlStatementThrowException(
                "UPDATE form_vitals SET activity = 0 WHERE id = ? AND pid = ? AND eid = ? LIMIT 1",
                [$formVitalsId, $pid, $encounterNumericId],
            );
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }
}
