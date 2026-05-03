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

        // form_vitals has no encounter column of its own; encounter binding lives in
        // the forms table (forms.form_id == form_vitals.id, forms.formdir = 'vitals').
        // JOIN through forms to fetch the encounter id alongside the row, then verify
        // the binding before flipping activity.
        $rows = QueryUtils::fetchRecords(
            "SELECT fv.id AS id, f.encounter AS encounter "
            . "FROM form_vitals fv "
            . "JOIN forms f ON f.form_id = fv.id AND f.formdir = 'vitals' AND f.pid = fv.pid "
            . "WHERE fv.uuid = ? AND fv.pid = ? LIMIT 1",
            [$hexUuid, $pid],
        );

        if (!\is_array($rows) || \count($rows) === 0) {
            return ConfirmedWriteOutcome::openemrRejected('vitals not found');
        }

        $row = $rows[0];
        $formVitalsId = isset($row['id']) && \is_numeric($row['id']) ? (int) $row['id'] : 0;
        $rowEncounter = isset($row['encounter']) && \is_numeric($row['encounter']) ? (int) $row['encounter'] : 0;

        if ($formVitalsId <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('vitals not found');
        }

        if ($rowEncounter !== $encounterNumericId) {
            return ConfirmedWriteOutcome::openemrRejected('encounter mismatch');
        }

        try {
            // OpenEMR canonical soft-delete on the forms table is `deleted = 1`
            // (the table has no `activity` column — that lives on the form-specific
            // `form_vitals` table only). Core OpenEMR queries filter
            // `WHERE deleted = 0` consistently (see library/forms.inc.php).
            QueryUtils::sqlStatementThrowException(
                "UPDATE forms SET deleted = 1 WHERE form_id = ? AND formdir = 'vitals' AND pid = ? AND encounter = ? LIMIT 1",
                [$formVitalsId, $pid, $encounterNumericId],
            );
            // The JOIN above already verified the encounter binding; the form_vitals
            // row is keyed by (id, pid) — there is no `eid` column on this table.
            QueryUtils::sqlStatementThrowException(
                "UPDATE form_vitals SET activity = 0 WHERE id = ? AND pid = ? LIMIT 1",
                [$formVitalsId, $pid],
            );
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }
}
