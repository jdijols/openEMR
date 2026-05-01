<?php

/**
 * Post-deploy P2 hardening — handshake_redeem.php must capture facility tz.
 *
 * Verifies that the launch-code redeem endpoint reads OpenEMR's configured
 * `gbl_time_zone` global (with a `date_default_timezone_get()` fallback) and
 * includes a `facility_tz` field in its JSON response. The agentforge-api
 * minting flow then carries that value through the JWT so per-turn
 * `server_today` matches the operator's local clock instead of UTC.
 *
 * Without this, the model's encounter-binding rule (system_prompt.ts §14.3)
 * fires the "I don't see a saved encounter for today" refusal whenever an
 * encounter saved late in the operator's local day landed on the next UTC
 * date — exactly the post-deploy P2 reproducer.
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class HandshakeRedeemFacilityTzStaticStructureTest extends TestCase
{
    private const REDEEM_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/handshake_redeem.php';

    public function testHandshakeReadsGblTimeZoneFromGlobalsBag(): void
    {
        self::assertFileExists(self::REDEEM_PATH);
        $contents = (string) file_get_contents(self::REDEEM_PATH);

        self::assertStringContainsString('OEGlobalsBag::getInstance()->get(\'gbl_time_zone\')', $contents);
    }

    public function testHandshakeFallsBackToPhpDefaultTimezoneWhenGlobalUnset(): void
    {
        $contents = (string) file_get_contents(self::REDEEM_PATH);

        // The PHP default mirrors OpenEMR's own globals.inc.php fallback note;
        // never want to emit an empty string and have the agent crash on it.
        self::assertStringContainsString('date_default_timezone_get()', $contents);
    }

    public function testHandshakeEmitsFacilityTzInRedeemResponse(): void
    {
        $contents = (string) file_get_contents(self::REDEEM_PATH);

        self::assertStringContainsString("'facility_tz' =>", $contents);
    }
}
