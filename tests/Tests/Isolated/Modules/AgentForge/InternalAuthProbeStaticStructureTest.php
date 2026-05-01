<?php

/**
 * Post-deploy P1 hardening — internal-auth probe endpoint static structure.
 *
 * Verifies the `public/health/internal_auth.php` script exists and follows the
 * minimal contract the AgentForge API `/health` endpoint depends on:
 *   - emits 401 when the inbound `X-Internal-Auth` header does not match
 *     `OPENEMR_MODULE_SHARED_SECRET`
 *   - emits 200 when it matches
 *   - never bootstraps OpenEMR globals (env-only check; cheap enough to run
 *     on every API health poll)
 *
 * Full HTTP scenarios require a bootstrapped DB + session; tracked as manual
 * VPS smoke (`curl https://<host>/health` showing
 * `deps.openemr_module: "ok" | "secret_mismatch"`).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class InternalAuthProbeStaticStructureTest extends TestCase
{
    private const PROBE_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/health/internal_auth.php';

    public function testProbeFileExists(): void
    {
        self::assertFileExists(self::PROBE_PATH);
    }

    public function testProbeRequiresInternalAuthAndEmits401On404Mismatch(): void
    {
        $contents = (string) file_get_contents(self::PROBE_PATH);
        self::assertNotSame('', $contents);
        self::assertStringContainsString("require_once __DIR__ . '/../agentforge_common.php'", $contents);
        self::assertStringContainsString('agentforge_verify_internal_auth()', $contents);
        self::assertStringContainsString("agentforge_emit_json(401, ['error' => 'invalid_internal_auth'])", $contents);
        self::assertStringContainsString("agentforge_emit_json(200, ['ok' => true])", $contents);
    }

    public function testProbeRequiresPostMethodToBlockGetCacheCanary(): void
    {
        $contents = (string) file_get_contents(self::PROBE_PATH);
        self::assertStringContainsString('agentforge_require_post()', $contents);
    }

    public function testProbeDoesNotBootstrapOpenEmrGlobals(): void
    {
        // Probe must stay a env-only check — bootstrapping globals.php on every
        // /health poll would defeat its sub-millisecond purpose and pull DB
        // connection setup into a path that runs on a 10s health timer.
        $contents = (string) file_get_contents(self::PROBE_PATH);
        self::assertStringNotContainsString('agentforge_require_globals', $contents);
    }
}
