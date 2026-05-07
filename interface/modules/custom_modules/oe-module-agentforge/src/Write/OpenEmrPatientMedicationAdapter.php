<?php

/**
 * G2-Early-20/21 — production adapter for medication add + discontinue.
 *
 * Direct SQL via QueryUtils against the `lists` table. We deliberately do not depend on
 * `ListService` here because it (a) doesn't expose a `uuid` write column, (b) has no
 * soft-delete (the canonical `delete()` is a hard DELETE), and (c) has no insert path
 * for our `comments` field. The W2 demo cohort uses empty charts so reuse risk is
 * zero — we own the medication row inserts end-to-end.
 *
 * UUID minting uses the same `random_bytes`-based v4 path that `OpenEmrDocumentRepository`
 * uses — avoids the UuidRegistry registration round-trip (the demo doesn't query the
 * registry, only `lists.uuid` directly). The `lists.uuid` column is `binary(16) UNIQUE`,
 * so collisions on a 122-bit random space are negligible.
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

final class OpenEmrPatientMedicationAdapter implements PatientMedicationWritePort
{
    /**
     * @param array{
     *   title: string,
     *   comments: ?string,
     *   begdate: ?string,
     *   enddate: ?string,
     *   diagnosis: ?string,
     * } $fields
     */
    public function insertMedicationForPatient(int $patientPid, array $fields): ConfirmedWriteOutcome
    {
        if ($patientPid <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        }

        $title = trim($fields['title']);
        if ($title === '') {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        // begdate / enddate land in DATETIME columns; null falls through to the literal
        // NOW() default for begdate (matches how the OpenEMR Medication form treats a
        // start date the user didn't fill — "today"). Explicit ISO YYYY-MM-DD beats NOW().
        $begdate = isset($fields['begdate']) && \is_string($fields['begdate']) && $fields['begdate'] !== ''
            ? $fields['begdate'] : null;
        $enddate = isset($fields['enddate']) && \is_string($fields['enddate']) && $fields['enddate'] !== ''
            ? $fields['enddate'] : null;
        $diagnosis = isset($fields['diagnosis']) && \is_string($fields['diagnosis']) && $fields['diagnosis'] !== ''
            ? $fields['diagnosis'] : null;

        try {
            if ($begdate !== null) {
                QueryUtils::sqlStatementThrowException(
                    "INSERT INTO `lists` ("
                    . "`uuid`, `date`, `type`, `title`, `comments`, `begdate`, `enddate`, `diagnosis`, `activity`, `pid`"
                    . ") VALUES (?, NOW(), 'medication', ?, ?, ?, ?, ?, 1, ?)",
                    [self::mintUuidBytes(), $title, $fields['comments'], $begdate, $enddate, $diagnosis, $patientPid],
                );
            } else {
                QueryUtils::sqlStatementThrowException(
                    "INSERT INTO `lists` ("
                    . "`uuid`, `date`, `type`, `title`, `comments`, `begdate`, `enddate`, `diagnosis`, `activity`, `pid`"
                    . ") VALUES (?, NOW(), 'medication', ?, ?, NOW(), ?, ?, 1, ?)",
                    [self::mintUuidBytes(), $title, $fields['comments'], $enddate, $diagnosis, $patientPid],
                );
            }
        } catch (\Throwable $e) {
            error_log(sprintf(
                'agentforge.medication_add_failed pid=%d exception=%s message=%s',
                $patientPid,
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }

    public function softDeleteMedicationByUuid(int $patientPid, string $medicationUuidString): ConfirmedWriteOutcome
    {
        if ($patientPid <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        }

        try {
            $hexUuid = UuidRegistry::uuidToBytes($medicationUuidString);
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('medication not found');
        }

        if ($hexUuid === '') {
            return ConfirmedWriteOutcome::openemrRejected('medication not found');
        }

        $rows = QueryUtils::fetchRecords(
            "SELECT `id` FROM `lists` WHERE `uuid` = ? AND `pid` = ? AND `type` = 'medication' LIMIT 1",
            [$hexUuid, $patientPid],
        );
        if (!\is_array($rows) || \count($rows) === 0) {
            return ConfirmedWriteOutcome::openemrRejected('medication not found');
        }

        try {
            QueryUtils::sqlStatementThrowException(
                "UPDATE `lists` SET `activity` = 0, `enddate` = NOW() "
                . "WHERE `uuid` = ? AND `pid` = ? AND `type` = 'medication' LIMIT 1",
                [$hexUuid, $patientPid],
            );
        } catch (\Throwable $e) {
            error_log(sprintf(
                'agentforge.medication_discontinue_failed pid=%d exception=%s message=%s',
                $patientPid,
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }

    /**
     * Mint a v4 UUID as 16 raw bytes for a `binary(16)` column. Mirrors
     * `OpenEmrDocumentRepository::mintUuid()` but returns binary instead of the hyphenated
     * string so the value can be bound directly into the `lists.uuid` parameter.
     */
    private static function mintUuidBytes(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); // version 4
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); // RFC 4122 variant
        return $bytes;
    }
}
