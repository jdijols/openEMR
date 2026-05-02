<?php

/**
 * AgentForge Clinical Co-Pilot — product ACL gate drift guard.
 *
 * Enforces PRD §4.9 layering: chart `patients/demo` floor plus module `agentforge/use`
 * entitlement; installer seeds default grants only to stock clinical groups (not front/back).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class AgentForgeAclProductGateStructureTest extends TestCase
{
    private const MODULE_AGENTFORGE_REL = '../../../../../interface/modules/custom_modules/oe-module-agentforge';

    public function testAclMapDefinesClinicalCopilotGate(): void
    {
        $path = __DIR__ . '/' . self::MODULE_AGENTFORGE_REL . '/src/Acl/AclMap.php';
        self::assertFileExists($path);
        $src = file_get_contents($path);
        self::assertNotFalse($src);
        self::assertStringContainsString("USE_COPILOT = 'use'", $src);
        self::assertStringContainsString('userPassesAgentForgeReadGate', $src);
        self::assertStringContainsString('userPassesAgentForgeProposeWriteGate', $src);
        self::assertStringContainsString("CHART_READ_SECTION = 'patients'", $src);
        self::assertStringContainsString("CHART_READ_VALUE = 'demo'", $src);
    }

    public function testInstallerDefaultsGrantOnlyClinicalStockGroups(): void
    {
        $path = __DIR__ . '/' . self::MODULE_AGENTFORGE_REL . '/src/Install/AgentForgeAclInstaller.php';
        self::assertFileExists($path);
        $src = file_get_contents($path);
        self::assertNotFalse($src);
        self::assertStringContainsString("['admin', 'doc', 'clin', 'breakglass']", $src);
        self::assertStringNotContainsString("['front'", $src);
        self::assertStringNotContainsString("['back'", $src);
        self::assertStringContainsString('$row[3]', $src);
        self::assertStringContainsString('function groupDisplayName', $src);
    }

    public function testPatientFacingEntrypointsInvokeReadProductGate(): void
    {
        $files = [
            __DIR__ . '/' . self::MODULE_AGENTFORGE_REL . '/public/launch.php',
            __DIR__ . '/' . self::MODULE_AGENTFORGE_REL . '/public/panel.php',
            __DIR__ . '/' . self::MODULE_AGENTFORGE_REL . '/src/Context/ChartContextGate.php',
            __DIR__ . '/' . self::MODULE_AGENTFORGE_REL . '/src/Bootstrap.php',
        ];
        foreach ($files as $file) {
            $src = file_get_contents($file);
            self::assertNotFalse($src, $file);
            self::assertStringContainsString('userPassesAgentForgeReadGate', $src, $file);
        }
    }

    public function testWriteEndpointsGateOnProposedWriteHelper(): void
    {
        $dir = __DIR__ . '/' . self::MODULE_AGENTFORGE_REL . '/public/write';
        foreach (glob($dir . '/*.php') ?: [] as $file) {
            $src = file_get_contents((string) $file);
            self::assertNotFalse($src, $file);
            self::assertStringContainsString(
                'userPassesAgentForgeProposeWriteGate',
                $src,
                (string) $file,
            );
        }
    }
}
