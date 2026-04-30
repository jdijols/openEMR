<?php

/**
 * Gate 1 — Active chart binding (PRD §4.6.3, S1).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/ActiveChartBindingException.php';
require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/SessionTokenVerifier.php';
require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/ActiveChartBinding.php';
require_once __DIR__ . '/SessionTokenIssuerFixture.php';

use OpenEMR\Modules\AgentForge\Security\ActiveChartBinding;
use OpenEMR\Modules\AgentForge\Security\ActiveChartBindingException;
use OpenEMR\Modules\AgentForge\Security\SessionTokenVerifier;
use PHPUnit\Framework\TestCase;

final class ActiveChartBindingTest extends TestCase
{
    private const SECRET = '0123456789abcdef0123456789abcdef';

    private function makeToken(?string $patientUuid, int $userId = 9): string
    {
        $now = time();

        return SessionTokenIssuerFixture::mint(self::SECRET, [
            'user_id' => $userId,
            'patient_uuid' => $patientUuid,
            'encounter_id' => null,
            'iat' => $now - 10,
            'exp' => $now + 3600,
        ]);
    }

    public function testCrossPatientBlocked(): void
    {
        $binding = new ActiveChartBinding(new SessionTokenVerifier(self::SECRET));
        $token = $this->makeToken('abc-123');
        $this->expectException(ActiveChartBindingException::class);
        $this->expectExceptionMessage('active_chart_mismatch');
        $binding->assert($token, 'xyz-999', 'abc-123');
    }

    public function testPatientSwitchInvalidatesToken(): void
    {
        $binding = new ActiveChartBinding(new SessionTokenVerifier(self::SECRET));
        $token = $this->makeToken('abc-123');
        $this->expectException(ActiveChartBindingException::class);
        $binding->assert($token, 'def-456', 'def-456');
    }

    public function testInvalidToken(): void
    {
        $binding = new ActiveChartBinding(new SessionTokenVerifier(self::SECRET));
        $this->expectException(ActiveChartBindingException::class);
        $this->expectExceptionMessage('invalid_session');
        $binding->assert('not-a-token', 'abc-123', 'abc-123');
    }

    public function testAssertClaimsRejectsTokenPatientVersusRequestedPatient(): void
    {
        $binding = new ActiveChartBinding(new SessionTokenVerifier(self::SECRET));
        $now = time();
        $claims = [
            'user_id' => 1,
            'patient_uuid' => 'aaa',
            'encounter_id' => null,
            'iat' => $now - 10,
            'exp' => $now + 3600,
        ];
        $this->expectException(ActiveChartBindingException::class);
        $binding->assertClaims($claims, 'bbb', 'aaa');
    }

    public function testAssertClaimsRejectsWhenTokenHasNoPatientButRequestDoes(): void
    {
        $binding = new ActiveChartBinding(new SessionTokenVerifier(self::SECRET));
        $now = time();
        $claims = [
            'user_id' => 1,
            'patient_uuid' => null,
            'encounter_id' => null,
            'iat' => $now - 10,
            'exp' => $now + 3600,
        ];
        $this->expectException(ActiveChartBindingException::class);
        $binding->assertClaims($claims, 'some-uuid', null);
    }

    public function testAssertClaimsRejectsWhenRequestEmptyButTokenHasPatient(): void
    {
        $binding = new ActiveChartBinding(new SessionTokenVerifier(self::SECRET));
        $now = time();
        $claims = [
            'user_id' => 1,
            'patient_uuid' => 'aaa',
            'encounter_id' => null,
            'iat' => $now - 10,
            'exp' => $now + 3600,
        ];
        $this->expectException(ActiveChartBindingException::class);
        $binding->assertClaims($claims, '', null);
    }
}
