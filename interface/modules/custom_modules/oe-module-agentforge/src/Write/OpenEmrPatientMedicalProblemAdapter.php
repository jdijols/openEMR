<?php

/**
 * W2 intake-bundle — production adapter for medical problem (problem list) add.
 *
 * Mirrors `OpenEmrPatientMedicationAdapter`: direct SQL via QueryUtils against
 * the `lists` table with `type='medical_problem'`, fresh v4 UUID as binary(16),
 * status maps to activity (+enddate when resolved). We deliberately avoid
 * `IssueService`/`ListService` here for the same reasons the medication adapter
 * does (no uuid write column, no insert path for our shape, demo cohort is
 * empty so the canonical path's downstream side-effects aren't worth the risk).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Database\QueryUtils;

final class OpenEmrPatientMedicalProblemAdapter implements PatientMedicalProblemWritePort
{
    /**
     * @param array{
     *   title: string,
     *   comments: ?string,
     *   begdate: ?string,
     *   status: 'active'|'inactive'|'resolved',
     * } $fields
     */
    public function insertMedicalProblemForPatient(int $patientPid, array $fields): ConfirmedWriteOutcome
    {
        if ($patientPid <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        }

        $title = trim($fields['title']);
        if ($title === '') {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        $begdate = isset($fields['begdate']) && \is_string($fields['begdate']) && $fields['begdate'] !== ''
            ? $fields['begdate'] : null;
        $comments = isset($fields['comments']) && \is_string($fields['comments']) && $fields['comments'] !== ''
            ? $fields['comments'] : null;

        $status = $fields['status'];
        $activity = $status === 'active' ? 1 : 0;
        $stampEndDate = $status === 'resolved';

        try {
            if ($begdate !== null && $stampEndDate) {
                QueryUtils::sqlStatementThrowException(
                    "INSERT INTO `lists` ("
                    . "`uuid`, `date`, `type`, `title`, `comments`, `begdate`, `enddate`, `activity`, `pid`"
                    . ") VALUES (?, NOW(), 'medical_problem', ?, ?, ?, NOW(), ?, ?)",
                    [self::mintUuidBytes(), $title, $comments, $begdate, $activity, $patientPid],
                );
            } elseif ($begdate !== null) {
                QueryUtils::sqlStatementThrowException(
                    "INSERT INTO `lists` ("
                    . "`uuid`, `date`, `type`, `title`, `comments`, `begdate`, `activity`, `pid`"
                    . ") VALUES (?, NOW(), 'medical_problem', ?, ?, ?, ?, ?)",
                    [self::mintUuidBytes(), $title, $comments, $begdate, $activity, $patientPid],
                );
            } elseif ($stampEndDate) {
                QueryUtils::sqlStatementThrowException(
                    "INSERT INTO `lists` ("
                    . "`uuid`, `date`, `type`, `title`, `comments`, `begdate`, `enddate`, `activity`, `pid`"
                    . ") VALUES (?, NOW(), 'medical_problem', ?, ?, NOW(), NOW(), ?, ?)",
                    [self::mintUuidBytes(), $title, $comments, $activity, $patientPid],
                );
            } else {
                QueryUtils::sqlStatementThrowException(
                    "INSERT INTO `lists` ("
                    . "`uuid`, `date`, `type`, `title`, `comments`, `begdate`, `activity`, `pid`"
                    . ") VALUES (?, NOW(), 'medical_problem', ?, ?, NOW(), ?, ?)",
                    [self::mintUuidBytes(), $title, $comments, $activity, $patientPid],
                );
            }
        } catch (\Throwable $e) {
            error_log(sprintf(
                'agentforge.problem_add_failed pid=%d exception=%s message=%s',
                $patientPid,
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }

    /**
     * v4 UUID as 16 raw bytes for `lists.uuid` (binary(16)). Same shape as
     * the medication adapter — version 4, RFC 4122 variant nibbles set.
     */
    private static function mintUuidBytes(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); // version 4
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); // RFC 4122 variant
        return $bytes;
    }
}
