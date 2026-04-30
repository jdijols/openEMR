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
}
