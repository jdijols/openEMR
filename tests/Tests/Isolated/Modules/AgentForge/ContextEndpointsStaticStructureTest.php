<?php

/**
 * Gate 3 (G3-01 static slice) — context PHP endpoints must remain service-backed (no naked SELECT *) and ingress via Chart helper.
 *
 * Full 401/403/200 PHPUnit HTTP scenarios require a bootstrapped DB + session; tracked as manual/docker smoke alongside G3-11.
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class ContextEndpointsStaticStructureTest extends TestCase
{
    /** @return list<string> */
    private function contextPhpFiles(): array
    {
        $dir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/context';
        self::assertDirectoryExists($dir);
        /** @var list<string> */
        return glob($dir . '/*.php') ?: [];
    }

    public function testContextPhpScriptsAvoidLiteralSelectStar(): void
    {
        foreach ($this->contextPhpFiles() as $file) {
            $base = basename($file);
            $contents = file_get_contents($file);
            self::assertNotFalse($contents, $base);
            self::assertStringNotContainsStringIgnoringCase(
                'select *',
                $contents,
                $base . ' must not SELECT * (AUDIT Performance-7 / PRD §4.4).'
            );
        }
    }

    public function testContextPhpScriptsAuthorizeViaSharedIngressExceptLegacyIdentityAllergiesStillUseGatePattern(): void
    {
        foreach ($this->contextPhpFiles() as $file) {
            $base = basename($file);
            if ($base === 'identity.php' || $base === 'allergies.php') {
                self::assertStringContainsString('ChartContextGate::authorizeFromGlobals', (string) file_get_contents($file), $base);
            } else {
                self::assertStringContainsString('agentforge_context_service_ingress', (string) file_get_contents($file), $base);
            }
        }
    }
}
