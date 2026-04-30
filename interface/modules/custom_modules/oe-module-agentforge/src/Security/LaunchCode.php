<?php

/**
 * Mint and redeem short-lived, single-use launch codes (PRD §4.3.3, S5).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

final class LaunchCode
{
    public const TTL_SECONDS = 60;

    public function __construct(
        private readonly LaunchCodeStore $store,
        private readonly int $ttlSeconds = self::TTL_SECONDS,
    ) {
    }

    public function mint(int $userId, ?string $patientUuid, ?int $encounterId, \DateTimeImmutable $now): string
    {
        // 64-char hex — never embed in URLs (PRD §4.3)
        $code = bin2hex(random_bytes(32));
        $issuedAt = $now->format('Y-m-d H:i:s');
        $this->store->insert($code, $userId, $patientUuid, $encounterId, $issuedAt);

        return $code;
    }

    public function redeemOrNull(string $code, \DateTimeImmutable $now): ?LaunchCodePayload
    {
        $redeemedAt = $now->format('Y-m-d H:i:s');
        $updated = $this->store->tryMarkRedeemed($code, $redeemedAt, $redeemedAt, $this->ttlSeconds);
        if ($updated < 1) {
            return null;
        }

        $row = $this->store->fetchRow($code);
        if ($row === null) {
            return null;
        }

        $userId = (int) $row['user_id'];
        $patientUuid = isset($row['patient_uuid']) && $row['patient_uuid'] !== '' ? (string) $row['patient_uuid'] : null;
        $encounterId = isset($row['encounter_id']) && $row['encounter_id'] !== '' && $row['encounter_id'] !== null
            ? (int) $row['encounter_id'] : null;

        return new LaunchCodePayload($userId, $patientUuid, $encounterId);
    }
}
