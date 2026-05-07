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

        // Gate 3 G3-11 — auto case presentation: the CUI now self-triggers the
        // brief on (handshake.status === 'ready' && patientUuid !== null), so
        // the host no longer fires AGENTFORGE_PRESENT_PATIENT postMessages.
        // See Documentation/AgentForge/process/journal/week-1/0501-T1500-brief-consistency-cache.md
        // for the four bugs that the postMessage-based handshake produced.
        self::assertStringNotContainsString('AGENTFORGE_PRESENT_PATIENT', $contents);
        self::assertStringNotContainsString('schedulePresentPatientPing', $contents);

        // Embedded column: pid arrival ensures the panel iframe is loaded (replaces overlay openRail()).
        self::assertStringContainsString('ensurePanelLoaded', $contents);

        // Embedded column: rail lives as a sibling of #framesDisplay inside #mainFrames_div, not as fixed overlay.
        // (The .agentforge-document-overlay rule legitimately uses position:fixed; assert specifically that
        // the rail itself does not.)
        self::assertStringContainsString('mainFrames_div', $contents);
        self::assertStringContainsString('framesDisplay', $contents);
        self::assertDoesNotMatchRegularExpression(
            '/\.agentforge-rail\s*\{[^}]*position:\s*fixed/s',
            $contents,
            'The .agentforge-rail rule must not use position: fixed (rail is a flex sibling, not an overlay).',
        );

        // Toggle is a user-driven collapse with sessionStorage persistence (host origin, not the iframe).
        self::assertStringContainsString('setCollapsed', $contents);
        self::assertStringContainsString('agentforge.rail.collapsed', $contents);
        self::assertStringContainsString('agentforge.rail.width', $contents);

        // Post-deploy P2 fix — also poll the active encounter id so the rail re-mints
        // the launch code (refreshing the JWT's encounter_id) when the operator saves
        // a new encounter mid-session. Without this, the agent kept refusing dictation
        // with "no recent encounter for today" even after the encounter was saved.
        self::assertStringContainsString('readEncounterProbe', $contents);
        self::assertStringContainsString('selectedEncounterID', $contents);
        self::assertStringContainsString('cur !== prevPid || curEnc !== prevEncounter', $contents);

        // Auto-bind the appointment-context encounter: panel.php binds/creates
        // the encounter before minting the launch code, then exposes the bound
        // id for the host shell to update OpenEMR's visible "Open Encounter".
        self::assertStringContainsString('syncBoundEncounterFromFrame', $contents);
        self::assertStringContainsString('data-bound-encounter-id', $contents);
        self::assertStringContainsString('new topWin.encounter_data', $contents);
        self::assertStringContainsString('appPatient.selectedEncounterID(encString)', $contents);
    }
}
