<?php

/**
 * G2-Early-23 — production adapter for family history append against `history_data`.
 *
 * The history column names supplied by `FamilyHistoryAddPayload` are validated at parse
 * time, so this adapter accepts only a fixed allowlist as the SQL column. Idempotent:
 * existing column values are scanned for the condition string before appending.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Database\QueryUtils;

final class OpenEmrPatientFamilyHistoryAdapter implements PatientFamilyHistoryWritePort
{
    /** @var list<string> */
    private const ALLOWED_COLUMNS = [
        'history_mother',
        'history_father',
        'history_siblings',
        'history_offspring',
        'history_spouse',
    ];

    public function appendFamilyHistoryEntry(int $patientPid, string $columnName, string $condition): ConfirmedWriteOutcome
    {
        if ($patientPid <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        }

        if (!\in_array($columnName, self::ALLOWED_COLUMNS, true)) {
            return ConfirmedWriteOutcome::openemrRejected('unsupported_write');
        }

        $trimmedCondition = trim($condition);
        if ($trimmedCondition === '') {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        try {
            $row = QueryUtils::fetchRecords(
                "SELECT `id`, `{$columnName}` AS `current_value` FROM `history_data` WHERE `pid` = ? LIMIT 1",
                [$patientPid],
            );
        } catch (\Throwable $e) {
            error_log(sprintf(
                'agentforge.family_history_select_failed pid=%d column=%s exception=%s message=%s',
                $patientPid,
                $columnName,
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        if (!\is_array($row) || \count($row) === 0) {
            try {
                QueryUtils::sqlStatementThrowException(
                    "INSERT INTO `history_data` (`pid`, `date`, `{$columnName}`) VALUES (?, NOW(), ?)",
                    [$patientPid, $trimmedCondition],
                );
            } catch (\Throwable $e) {
                error_log(sprintf(
                    'agentforge.family_history_insert_failed pid=%d column=%s exception=%s message=%s',
                    $patientPid,
                    $columnName,
                    $e::class,
                    $e->getMessage(),
                ));
                return ConfirmedWriteOutcome::openemrRejected('write failed');
            }

            return ConfirmedWriteOutcome::accepted(0);
        }

        $current = isset($row[0]['current_value']) && \is_string($row[0]['current_value']) ? $row[0]['current_value'] : '';
        if ($current !== '' && self::containsCondition($current, $trimmedCondition)) {
            // Idempotent — already recorded; treat as accepted without a write.
            return ConfirmedWriteOutcome::accepted(0);
        }

        $next = $current === '' ? $trimmedCondition : $current . "\n" . $trimmedCondition;

        try {
            QueryUtils::sqlStatementThrowException(
                "UPDATE `history_data` SET `{$columnName}` = ? WHERE `pid` = ? LIMIT 1",
                [$next, $patientPid],
            );
        } catch (\Throwable $e) {
            error_log(sprintf(
                'agentforge.family_history_update_failed pid=%d column=%s exception=%s message=%s',
                $patientPid,
                $columnName,
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }

    private static function containsCondition(string $existing, string $candidate): bool
    {
        $needle = strtolower($candidate);
        foreach (preg_split("/[\\r\\n,;]+/", $existing) ?: [] as $line) {
            if (strtolower(trim($line)) === $needle) {
                return true;
            }
        }
        return false;
    }
}
