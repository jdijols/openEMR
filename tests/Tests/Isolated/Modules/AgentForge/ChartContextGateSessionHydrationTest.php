<?php

/**
 * Gate 4 G4-10 — trusted-agent S2S identity must be mirrored into the OpenEMR session wrapper so
 * core services that fall back to $session->get('authUser') (notably AclMain::aclCheckCore default-arg
 * path inside EncounterService::updateEncounter sensitivities ACL) see the verified clinician.
 *
 * Without this hydration, EncounterService::updateEncounter returns the literal string
 * "You are not authorized to see this encounter." which surfaced to operators as the misleading
 * audit row `failure_reason=encounter not found` for hours before being root-caused.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Session\SessionInterface;

require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/ChartContextGate.php';

final class ChartContextGateSessionHydrationTest extends TestCase
{
    public function testHydrateAgentSessionWritesCanonicalIdentityKeys(): void
    {
        $store = [];
        $session = $this->createMock(SessionInterface::class);
        $session->method('set')->willReturnCallback(
            static function (string $key, mixed $value) use (&$store): void {
                $store[$key] = $value;
            }
        );

        ChartContextGate::hydrateAgentSession($session, 'admin', 1, 'Default');

        self::assertSame('admin', $store['authUser'] ?? null, 'authUser must be hydrated for AclMain default-arg path');
        self::assertSame(1, $store['authUserID'] ?? null, 'authUserID must be hydrated for downstream user lookups');
        self::assertSame('Default', $store['authProvider'] ?? null, 'authProvider must be hydrated for group-aware ACL paths');
    }

    public function testHydrateAgentSessionInvokesSetExactlyOncePerKey(): void
    {
        $session = $this->createMock(SessionInterface::class);
        $session->expects(self::exactly(3))
            ->method('set')
            ->willReturnCallback(
                static function (string $key): void {
                    self::assertContains($key, ['authUser', 'authUserID', 'authProvider']);
                }
            );

        ChartContextGate::hydrateAgentSession($session, 'reynolds', 7, 'Physicians');
    }

    public function testTrustedAgentCallSiteUsesHydrationHelper(): void
    {
        // Belt-and-suspenders: the source of authorizeTrustedAgentCall must invoke hydrateAgentSession
        // so future refactors don't silently drop the session bridge and reintroduce the encounter-not-found bug.
        $source = (string) file_get_contents(
            __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/ChartContextGate.php'
        );
        self::assertStringContainsString(
            'hydrateAgentSession(',
            $source,
            'authorizeTrustedAgentCall must mirror the verified S2S identity into the OpenEMR session wrapper'
        );
    }
}
