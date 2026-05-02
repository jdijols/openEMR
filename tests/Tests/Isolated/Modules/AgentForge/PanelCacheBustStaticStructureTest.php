<?php

/**
 * Post-deploy follow-up to the brief-consistency PR1 — `panel.php` MUST
 * append a content-hash query string to the CUI bundle URLs (G6-16).
 *
 * Without this, browsers cache `agentforge-cui.js` indefinitely and any
 * CUI-side fix (e.g. PR1's auto-brief state machine) silently fails to
 * reach already-warmed tabs after a redeploy. The G6-16 task originally
 * claimed this was implemented; the 2026-05-01 brief regression revealed
 * the panel had been emitting bare URLs the whole time. This static
 * structure test pins the cache-bust shape so future edits do not
 * regress it again.
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class PanelCacheBustStaticStructureTest extends TestCase
{
    private const PANEL_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php';

    public function testPanelHashesTheJsBundleForCacheBust(): void
    {
        self::assertFileExists(self::PANEL_PATH);
        $contents = (string) file_get_contents(self::PANEL_PATH);

        self::assertStringContainsString("md5_file(\$bundleDir . '/agentforge-cui.js')", $contents);
    }

    public function testPanelHashesTheCssBundleForCacheBust(): void
    {
        $contents = (string) file_get_contents(self::PANEL_PATH);

        self::assertStringContainsString("md5_file(\$bundleDir . '/agentforge-cui-index.css')", $contents);
    }

    public function testJsScriptUrlAppendsHashQueryString(): void
    {
        $contents = (string) file_get_contents(self::PANEL_PATH);

        // The exact substring covers two regressions at once: the URL must
        // end in the JS filename, AND the hash must be appended via `?v=`.
        self::assertStringContainsString("agentforge-cui.js?v=' . \$jsVersion", $contents);
    }

    public function testCssLinkUrlAppendsHashQueryString(): void
    {
        $contents = (string) file_get_contents(self::PANEL_PATH);

        self::assertStringContainsString("agentforge-cui-index.css?v=' . \$cssVersion", $contents);
    }

    public function testHashLookupTolerateMissingBundleFile(): void
    {
        $contents = (string) file_get_contents(self::PANEL_PATH);

        // `@md5_file(...)` returns `false` if the bundle is missing on a
        // freshly-cloned dev box that has not run `npm run build` yet.
        // The fallback marker keeps the script tag well-formed so the 404
        // is surfaced with a recognisable URL rather than a parse error.
        self::assertStringContainsString("\$jsVersion = \\is_string(\$jsHash) ? \$jsHash : 'missing'", $contents);
        self::assertStringContainsString("\$cssVersion = \\is_string(\$cssHash) ? \$cssHash : 'missing'", $contents);
    }
}
