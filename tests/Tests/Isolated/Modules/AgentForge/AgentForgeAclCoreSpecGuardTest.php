<?php

/**
 * Gate 1 G1-07 — no empty ACO spec in module public PHP (PRD §4.9).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class AgentForgeAclCoreSpecGuardTest extends TestCase
{
    public function testNoAclCheckCoreWithEmptySecondArgumentInPublicScripts(): void
    {
        $dir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public';
        $files = glob($dir . '/*.php') ?: [];
        foreach (glob($dir . '/*/*.php') ?: [] as $f) {
            $files[] = $f;
        }

        foreach ($files as $file) {
            if (str_contains((string) $file, 'agentforge_common.php')) {
                continue;
            }

            $src = file_get_contents((string) $file);
            self::assertNotFalse($src, $file);
            if (!str_contains($src, 'aclCheckCore')) {
                continue;
            }

            if (preg_match('/aclCheckCore\s*\([^)]*,\s*(\'\'|\"\"|null)\s*\)/', $src) === 1) {
                self::fail('Empty ACL spec in ' . $file);
            }
        }

        self::assertTrue(true);
    }
}
