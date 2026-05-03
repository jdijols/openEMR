<?php

/**
 * Gate 1 — Admin/super follows OpenEMR's normal authorization model; no copilot-only block.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class NoParallelPrivilegePlaneTest extends TestCase
{
    public function testModuleDoesNotContainAdminOnlyLaunchBlock(): void
    {
        $moduleDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge';
        $files = [
            $moduleDir . '/public/launch.php',
            $moduleDir . '/public/panel.php',
            $moduleDir . '/public/handshake_redeem.php',
        ];

        foreach ($files as $file) {
            $src = file_get_contents($file);
            self::assertNotFalse($src, $file);
            self::assertStringNotContainsString('AdminGuard', $src, $file);
            self::assertStringNotContainsString('admin_user_blocked', $src, $file);
        }
    }

    public function testRailLaunchUsesExistingChartReadAcl(): void
    {
        $moduleDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge';
        $aclMap = file_get_contents($moduleDir . '/src/Acl/AclMap.php');
        self::assertNotFalse($aclMap);
        self::assertStringContainsString("CHART_READ_SECTION = 'patients'", $aclMap);
        self::assertStringContainsString("CHART_READ_VALUE = 'demo'", $aclMap);
        self::assertStringContainsString("USE_COPILOT = 'use'", $aclMap);
    }
}
