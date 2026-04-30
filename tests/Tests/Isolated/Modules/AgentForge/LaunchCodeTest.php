<?php

/**
 * Gate 1 — Launch code mint/redeem (PRD §4.3.3, S5).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/LaunchCodeStore.php';
require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/LaunchCodePayload.php';
require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/PdoLaunchCodeStore.php';
require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Security/LaunchCode.php';

use OpenEMR\Modules\AgentForge\Security\LaunchCode;
use OpenEMR\Modules\AgentForge\Security\PdoLaunchCodeStore;
use PHPUnit\Framework\TestCase;

final class LaunchCodeTest extends TestCase
{
    public function testHappyPathRedeem(): void
    {
        $store = PdoLaunchCodeStore::createSqliteMemory();
        $svc = new LaunchCode($store);
        $now = new \DateTimeImmutable('2026-04-30 12:00:00');
        $code = $svc->mint(42, 'patient-uuid-one', 7, $now);
        self::assertSame(64, strlen($code));

        $payload = $svc->redeemOrNull($code, new \DateTimeImmutable('2026-04-30 12:00:30'));
        self::assertNotNull($payload);
        self::assertSame(42, $payload->userId);
        self::assertSame('patient-uuid-one', $payload->patientUuid);
        self::assertSame(7, $payload->encounterId);
    }

    public function testReplayReturnsNull(): void
    {
        $store = PdoLaunchCodeStore::createSqliteMemory();
        $svc = new LaunchCode($store);
        $now = new \DateTimeImmutable('2026-04-30 12:00:00');
        $code = $svc->mint(1, null, null, $now);
        self::assertNotNull($svc->redeemOrNull($code, $now));
        self::assertNull($svc->redeemOrNull($code, $now));
    }

    public function testExpiredReturnsNull(): void
    {
        $store = PdoLaunchCodeStore::createSqliteMemory();
        $svc = new LaunchCode($store);
        $issued = new \DateTimeImmutable('2026-04-30 12:00:00');
        $code = $svc->mint(1, null, null, $issued);
        self::assertNull($svc->redeemOrNull($code, new \DateTimeImmutable('2026-04-30 12:02:00')));
    }

    public function testMintedHtmlNeverUsesQueryString(): void
    {
        $code = 'a0b1c2';
        $html = '<!DOCTYPE html><html lang="en" data-launch-code="' . htmlspecialchars($code, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') . '">';
        self::assertStringNotContainsString('launch_code=', $html);
        self::assertStringNotContainsString('session_token=', $html);
    }
}
