<?php

/**
 * Gate 0 — PHP anchors + JSON manifest stay aligned (see agentforge/contracts/module-http-paths.json)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use OpenEMR\Modules\AgentForge\Http\ModuleHttpContract;
use PHPUnit\Framework\TestCase;

$httpDir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Http/';
foreach (glob($httpDir . 'Read*.php') ?: [] as $file) {
    require_once $file;
}
foreach (glob($httpDir . 'Write*.php') ?: [] as $file) {
    require_once $file;
}
foreach (glob($httpDir . 'Upload*.php') ?: [] as $file) {
    require_once $file;
}
require_once $httpDir . 'ModuleHttpContract.php';

final class ModuleHttpContractTest extends TestCase
{
    public function testJsonManifestMatchesPhpAnchors(): void
    {
        $fromJson = ModuleHttpContract::pathsFromManifest();
        $fromPhp = ModuleHttpContract::pathsFromPhpAnchors();
        $this->assertSame($fromJson, $fromPhp);
        $this->assertCount(15, $fromPhp);
    }
}
