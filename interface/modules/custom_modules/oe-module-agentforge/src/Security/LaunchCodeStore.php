<?php

/**
 * Persistence port for single-use launch codes (tests swap in PDO/SQLite).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

interface LaunchCodeStore
{
    public function insert(string $code, int $userId, ?string $patientUuid, ?int $encounterId, string $issuedAtMysql): void;

    /**
     * @return ?array{user_id:int|string, patient_uuid:?string, encounter_id:int|string|null, issued_at:string, redeemed_at:?string}
     */
    public function fetchRow(string $code): ?array;

    public function tryMarkRedeemed(string $code, string $redeemedAtMysql, string $nowMysql, int $ttlSeconds): int;
}
