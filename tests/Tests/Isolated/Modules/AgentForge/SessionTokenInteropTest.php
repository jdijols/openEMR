<?php

/**
 * Confirms PHP verifier accepts tokens from the test issuer (HMAC contract aligns with agentforge-api).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/SessionTokenVerifier.php';
require_once __DIR__ . '/SessionTokenIssuerFixture.php';

use OpenEMR\Modules\AgentForge\Security\SessionTokenVerifier;
use PHPUnit\Framework\TestCase;

final class SessionTokenInteropTest extends TestCase
{
    public function testVerifierAcceptsFixtureMint(): void
    {
        $secret = '0123456789abcdef0123456789abcdef';
        $now = time();
        $token = SessionTokenIssuerFixture::mint($secret, [
            'user_id' => 99,
            'patient_uuid' => 'uuid-1',
            'encounter_id' => 5,
            'iat' => $now - 5,
            'exp' => $now + 1000,
        ]);

        $verifier = new SessionTokenVerifier($secret);
        $claims = $verifier->verify($token);
        self::assertNotNull($claims);
        self::assertSame(99, $claims['user_id']);
        self::assertSame('uuid-1', $claims['patient_uuid']);
        self::assertSame(5, $claims['encounter_id']);
    }

    public function testVerifierStillAcceptsLegacyTokenWithoutFacilityTz(): void
    {
        // Post-deploy P2: facility_tz was added to the JWT after Gates 3-5 shipped.
        // Tokens minted before that fix must still verify (backward compatibility) —
        // verifier returns null facility_tz for them.
        $secret = '0123456789abcdef0123456789abcdef';
        $now = time();
        $token = SessionTokenIssuerFixture::mint($secret, [
            'user_id' => 7,
            'patient_uuid' => 'uuid-legacy',
            'encounter_id' => null,
            'iat' => $now - 5,
            'exp' => $now + 1000,
        ]);

        $verifier = new SessionTokenVerifier($secret);
        $claims = $verifier->verify($token);
        self::assertNotNull($claims);
        self::assertNull($claims['facility_tz']);
    }

    public function testVerifierRoundTripsFacilityTzClaim(): void
    {
        // Post-deploy P2 fix: facility tz captured from OpenEMR `gbl_time_zone`
        // at handshake must round-trip through the JWT so the agent can format
        // `server_today` in the operator's local clock.
        $secret = '0123456789abcdef0123456789abcdef';
        $now = time();
        $token = SessionTokenIssuerFixture::mint($secret, [
            'user_id' => 12,
            'patient_uuid' => 'uuid-tz',
            'encounter_id' => 42,
            'iat' => $now - 5,
            'exp' => $now + 1000,
            'facility_tz' => 'America/New_York',
        ]);

        $verifier = new SessionTokenVerifier($secret);
        $claims = $verifier->verify($token);
        self::assertNotNull($claims);
        self::assertSame('America/New_York', $claims['facility_tz']);
    }

    public function testVerifierRejectsMalformedFacilityTzClaim(): void
    {
        // Defensive: a non-string facility_tz should fail validation rather
        // than silently degrade to UTC at the agent. Uses mintFromRawPayload()
        // so the test can construct a structurally-malformed token without
        // tripping PHPStan on the typed mint() signature.
        $secret = '0123456789abcdef0123456789abcdef';
        $now = time();
        $token = SessionTokenIssuerFixture::mintFromRawPayload($secret, [
            'user_id' => 12,
            'patient_uuid' => 'uuid-bad-tz',
            'encounter_id' => null,
            'iat' => $now - 5,
            'exp' => $now + 1000,
            'facility_tz' => 12345,
        ]);

        $verifier = new SessionTokenVerifier($secret);
        self::assertNull($verifier->verify($token));
    }
}
