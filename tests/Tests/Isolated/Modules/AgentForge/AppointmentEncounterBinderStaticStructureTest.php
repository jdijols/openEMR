<?php

/**
 * Static guards for AgentForge's automatic appointment encounter binding.
 *
 * @package OpenEMR
 * @link https://www.open-emr.org
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class AppointmentEncounterBinderStaticStructureTest extends TestCase
{
    private const BINDER_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Context/AppointmentEncounterBinder.php';

    private const PANEL_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/panel.php';

    private const LAUNCH_PATH =
        __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/launch.php';

    private const DEMOGRAPHICS_PATH =
        __DIR__ . '/../../../../../interface/patient_file/summary/demographics.php';

    private const CALENDAR_DAY_TEMPLATE =
        __DIR__ . '/../../../../../interface/main/calendar/modules/PostCalendar/pntemplates/default/views/day/ajax_template.html';

    private const PATIENT_TRACKER_PATH =
        __DIR__ . '/../../../../../interface/patient_tracker/patient_tracker.php';

    public function testBinderUsesNativeOpenEmrEncounterSessionSetter(): void
    {
        $src = $this->readFile(self::BINDER_PATH);

        self::assertStringContainsString('use OpenEMR\\Common\\Session\\EncounterSessionUtil;', $src);
        self::assertStringContainsString('EncounterSessionUtil::setEncounter((string) $encounterId);', $src);
    }

    public function testBinderResolutionOrderMatchesProductPolicy(): void
    {
        $src = $this->readFile(self::BINDER_PATH);

        self::assertLessThan(strpos($src, 'findTrackerLinkedEncounter'), strpos($src, 'findEncounterById($pid, $sessionEncounterId)'));
        self::assertLessThan(strpos($src, 'findLatestSameDayEncounter'), strpos($src, 'findTrackerLinkedEncounter'));
        self::assertLessThan(strpos($src, 'findLatestSameDayAppointment'), strpos($src, 'findLatestSameDayEncounter'));
        self::assertStringContainsString('ORDER BY pt.`appttime` DESC, pt.`id` DESC', $src);
        self::assertStringContainsString('ORDER BY fe.`date` DESC, fe.`encounter` DESC', $src);
        self::assertStringContainsString('ORDER BY `pc_startTime` DESC, `pc_eid` DESC', $src);
    }

    public function testBinderUsesAppointmentContextDateBeforeTodayFallback(): void
    {
        $src = $this->readFile(self::BINDER_PATH);

        self::assertStringContainsString('agentforge_appointment_context_pid', $src);
        self::assertStringContainsString('agentforge_appointment_context_eid', $src);
        self::assertStringContainsString('agentforge_appointment_context_date', $src);
        self::assertStringContainsString('findAppointmentById($pid, $appointmentId)', $src);
        self::assertStringContainsString('$targetDate = $appointmentDate ?? (new \\DateTimeImmutable(\'today\'))->format(\'Y-m-d\');', $src);
        self::assertStringContainsString('!$hasAppointmentContext || $sessionEncounter->encounterDate === $targetDate', $src);
        self::assertStringContainsString('pt.`eid` = ?', $src);
    }

    public function testBinderCreatesAndLinksEncounterFromSameDayAppointment(): void
    {
        $src = $this->readFile(self::BINDER_PATH);

        self::assertStringContainsString('todaysEncounterCheck', $src);
        self::assertStringContainsString('manage_tracker_status', $src);
        self::assertStringContainsString('`pc_eventDate` = ?', $src);
        self::assertStringContainsString('`pc_pid` = ?', $src);
    }

    public function testPanelAndLaunchBindBeforeMintingLaunchCode(): void
    {
        foreach ([self::PANEL_PATH, self::LAUNCH_PATH] as $path) {
            $src = $this->readFile($path);

            self::assertStringContainsString('use OpenEMR\\Modules\\AgentForge\\Context\\AppointmentEncounterBinder;', $src);
            self::assertStringContainsString('bindForCurrentPatient($pid)', $src);
            self::assertLessThan(strpos($src, 'new LaunchCode'), strpos($src, 'bindForCurrentPatient($pid)'));
        }
    }

    public function testChartNavigationStoresAppointmentContextForAgentForge(): void
    {
        $demographics = $this->readFile(self::DEMOGRAPHICS_PATH);
        $calendarDay = $this->readFile(self::CALENDAR_DAY_TEMPLATE);
        $patientTracker = $this->readFile(self::PATIENT_TRACKER_PATH);

        self::assertStringContainsString('af_appointment_id', $demographics);
        self::assertStringContainsString('af_appointment_date', $demographics);
        self::assertStringContainsString('SessionUtil::setSession(\'agentforge_appointment_context_pid\'', $demographics);
        self::assertStringContainsString('SessionUtil::unsetSession($agentForgeAppointmentContextKeys)', $demographics);

        self::assertStringContainsString('function goPid(pid, appointmentDate, appointmentId)', $calendarDay);
        self::assertStringContainsString('&af_appointment_date=', $calendarDay);
        self::assertStringContainsString('&af_appointment_id=', $calendarDay);

        self::assertStringContainsString('function topatient(newpid, enc, appointmentDate, appointmentId)', $patientTracker);
        self::assertStringContainsString('const apptContext = (appointmentDate ?', $patientTracker);
    }

    public function testPanelExposesBoundEncounterMetadataForHostChromeSync(): void
    {
        $src = $this->readFile(self::PANEL_PATH);

        self::assertStringContainsString('data-bound-encounter-id', $src);
        self::assertStringContainsString('data-bound-encounter-date', $src);
        self::assertStringContainsString('data-bound-encounter-category', $src);
        self::assertStringContainsString('data-bound-encounter-created', $src);
    }

    private function readFile(string $path): string
    {
        self::assertFileExists($path);
        $src = file_get_contents($path);
        self::assertNotFalse($src, $path);

        return $src;
    }
}
