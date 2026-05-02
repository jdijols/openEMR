<?php

/**
 * Pins `panel.php` + `agentforge_common.php` wiring for the CUI header
 * line built from active-chart demographics (PRD: show patient in rail title).
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class PanelCopilotTitleStaticStructureTest extends TestCase
{
    private const PANEL_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php';

    private const COMMON_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/agentforge_common.php';

    public function testPanelEmbedsCopilotTitleDataAttributeOnHtmlRoot(): void
    {
        self::assertFileExists(self::PANEL_PATH);
        $contents = (string) file_get_contents(self::PANEL_PATH);

        self::assertStringContainsString('agentforge_patient_copilot_header_title', $contents);
        self::assertStringContainsString('data-patient-copilot-title="\' . $copilotTitleAttr . \'"', $contents);
    }

    public function testCommonDefinesHeaderTitleBuilder(): void
    {
        self::assertFileExists(self::COMMON_PATH);
        $contents = (string) file_get_contents(self::COMMON_PATH);

        self::assertStringContainsString('function agentforge_patient_copilot_header_title(int $pid): ?string', $contents);
    }
}
