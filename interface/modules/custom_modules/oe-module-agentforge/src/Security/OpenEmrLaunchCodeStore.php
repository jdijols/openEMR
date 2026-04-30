<?php

/**
 * OpenEMR QueryUtils-backed store (production).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

use OpenEMR\Common\Database\QueryUtils;

final class OpenEmrLaunchCodeStore implements LaunchCodeStore
{
    public function insert(string $code, int $userId, ?string $patientUuid, ?int $encounterId, string $issuedAtMysql): void
    {
        QueryUtils::sqlStatementThrowException(
            <<<SQL
            INSERT INTO `agentforge_launch_code` (`code`, `user_id`, `patient_uuid`, `encounter_id`, `issued_at`)
            VALUES (?, ?, ?, ?, ?)
            SQL,
            [$code, $userId, $patientUuid, $encounterId, $issuedAtMysql]
        );
    }

    public function fetchRow(string $code): ?array
    {
        $row = QueryUtils::fetchRecords(
            <<<SQL
            SELECT `user_id`, `patient_uuid`, `encounter_id`, `issued_at`, `redeemed_at`
            FROM `agentforge_launch_code` WHERE `code` = ? LIMIT 1
            SQL,
            [$code]
        );
        if (count($row) !== 1) {
            return null;
        }

        return $row[0];
    }

    public function tryMarkRedeemed(string $code, string $redeemedAtMysql, string $nowMysql, int $ttlSeconds): int
    {
        $sql = <<<SQL
            UPDATE `agentforge_launch_code`
            SET `redeemed_at` = ?
            WHERE `code` = ?
              AND `redeemed_at` IS NULL
              AND TIMESTAMPDIFF(SECOND, `issued_at`, ?) <= ?
            SQL;
        QueryUtils::sqlStatementThrowException($sql, [$redeemedAtMysql, $code, $nowMysql, $ttlSeconds]);

        $n = QueryUtils::affectedRows();

        return is_int($n) ? $n : 0;
    }
}
