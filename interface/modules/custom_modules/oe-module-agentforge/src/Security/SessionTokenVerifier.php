<?php

/**
 * HMAC session token binding (PRD §4.3 / §5.2) — verify agent-minted tokens on the module.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

final class SessionTokenVerifier
{
    public function __construct(private readonly string $secret)
    {
        if (strlen($this->secret) < 32) {
            throw new \InvalidArgumentException('SESSION_TOKEN_SECRET must be at least 32 bytes');
        }
    }

    /**
     * @return ?array{user_id:int, patient_uuid:?string, encounter_id:?int, iat:int, exp:int}
     */
    public function verify(string $token): ?array
    {
        $parts = explode('.', $token, 2);
        if (count($parts) !== 2) {
            return null;
        }

        [$payloadB64, $sig] = $parts;
        if ($payloadB64 === '' || $sig === '') {
            return null;
        }

        $expected = $this->b64UrlHmacSha256($payloadB64);
        if (strlen($expected) !== strlen($sig) || !hash_equals($expected, $sig)) {
            return null;
        }

        $json = $this->b64UrlDecode($payloadB64);
        if ($json === '') {
            return null;
        }

        try {
            $data = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return null;
        }

        if (!is_array($data)) {
            return null;
        }

        if (!isset($data['user_id'], $data['iat'], $data['exp']) || !is_int($data['user_id']) || !is_int($data['iat']) || !is_int($data['exp'])) {
            return null;
        }

        $patientUuid = array_key_exists('patient_uuid', $data) ? $data['patient_uuid'] : null;
        if ($patientUuid !== null && !is_string($patientUuid)) {
            return null;
        }

        $encounterId = array_key_exists('encounter_id', $data) ? $data['encounter_id'] : null;
        if ($encounterId !== null && !is_int($encounterId)) {
            return null;
        }

        $now = time();
        if ($now < $data['iat'] || $now > $data['exp']) {
            return null;
        }

        return [
            'user_id' => $data['user_id'],
            'patient_uuid' => $patientUuid,
            'encounter_id' => $encounterId,
            'iat' => $data['iat'],
            'exp' => $data['exp'],
        ];
    }

    private function b64UrlHmacSha256(string $payloadB64): string
    {
        $raw = hash_hmac('sha256', $payloadB64, $this->secret, true);

        return $this->rawToB64Url($raw);
    }

    private function rawToB64Url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    private function b64UrlDecode(string $b64): string
    {
        $pad = 4 - (strlen($b64) % 4);
        if ($pad < 4) {
            $b64 .= str_repeat('=', $pad);
        }

        $decoded = base64_decode(strtr($b64, '-_', '+/'), true);

        return $decoded === false ? '' : $decoded;
    }
}
