<?php

/**
 * Test-only token issuer matching agentforge-api `mintSessionToken` (Gate 1 interop).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

final class SessionTokenIssuerFixture
{
    /**
     * @param array{user_id:int, patient_uuid:?string, encounter_id:?int, iat:int, exp:int, facility_tz?:?string} $payload
     */
    public static function mint(string $secret, array $payload): string
    {
        $canonical = json_encode($payload, \JSON_THROW_ON_ERROR);
        $payloadB64 = self::base64UrlEncode($canonical);
        $sig = self::b64UrlHmacSha256($payloadB64, $secret);

        return $payloadB64 . '.' . $sig;
    }

    private static function base64UrlEncode(string $s): string
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    private static function b64UrlHmacSha256(string $payloadB64, string $secret): string
    {
        $raw = hash_hmac('sha256', $payloadB64, $secret, true);

        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
