<?php

/**
 * Gate 3 (G3-12 static slice) — rail active-chart sync must observe OpenEMR's top-level patient model.
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class RailContainerStaticStructureTest extends TestCase
{
    public function testRailPidProbeReadsOpenEmrApplicationPatientModelBeforeDomFallback(): void
    {
        $template = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig';
        self::assertFileExists($template);

        $contents = file_get_contents($template);
        self::assertNotFalse($contents);

        self::assertStringContainsString('app_view_model.application_data.patient', $contents);
        self::assertStringContainsString('appPatient.pid()', $contents);
        self::assertStringContainsString('document.querySelector(\'input[name="pid"]\')', $contents);

        // G3-10: citation navigation must not replace the tabs chrome (no full window.top navigation).
        self::assertStringContainsString('navigateDemographicsInChrome', $contents);
        self::assertStringContainsString('loadCurrentPatient', $contents);
        self::assertStringContainsString('navigateEncounterInChrome', $contents);
        self::assertStringContainsString('topWin.RTop.location', $contents);
        self::assertStringNotContainsString('window.top.location.href', $contents);

        // chart_section citations route to Issues / History / Documents URLs (Gate 3 G3-10).
        self::assertStringContainsString("hint.kind === 'chart_section'", $contents);
        self::assertStringContainsString('navigateChartSectionFromHint', $contents);
        self::assertStringContainsString('stats_full.php?active=all&category=allergy', $contents);

        // Gate 3 G3-11 — auto case presentation: when a chart binds, ping CUI to render presentation.
        self::assertStringContainsString('AGENTFORGE_PRESENT_PATIENT', $contents);
        self::assertStringContainsString('schedulePresentPatientPing', $contents);

        // Embedded column: pid arrival ensures the panel iframe is loaded (replaces overlay openRail()).
        self::assertStringContainsString('ensurePanelLoaded', $contents);
        self::assertStringContainsString("if (readPidProbe() !== '')", $contents);

        // Embedded column: rail lives as a sibling of #framesDisplay inside #mainFrames_div, not as fixed overlay.
        self::assertStringContainsString('mainFrames_div', $contents);
        self::assertStringContainsString('framesDisplay', $contents);
        self::assertStringNotContainsString('position: fixed', $contents);

        // Toggle is a user-driven collapse with sessionStorage persistence (host origin, not the iframe).
        self::assertStringContainsString('setCollapsed', $contents);
        self::assertStringContainsString('agentforge.rail.collapsed', $contents);
        self::assertStringContainsString('agentforge.rail.width', $contents);
    }
}
