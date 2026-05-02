<?php

/**
 * AgentForge appointment seed static drift guards.
 *
 * @package OpenEMR
 * @link https://www.open-emr.org
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class AgentForgeAppointmentSeedStructureTest extends TestCase
{
    private const APPOINTMENT_SEED_PATH =
        __DIR__ . '/../../../../../contrib/util/agentforge/seed_appointments.php';

    private const VISIT_INTAKE_SEED_PATH =
        __DIR__ . '/../../../../../contrib/util/agentforge/seed_visit_intake.php';

    public function testAppointmentSeedUsesDonnaLeeFourDayWindow(): void
    {
        $src = $this->readFile(self::APPOINTMENT_SEED_PATH);

        self::assertStringContainsString("'2026-05-01'", $src);
        self::assertStringContainsString("'2026-05-02'", $src);
        self::assertStringContainsString("'2026-05-03'", $src);
        self::assertStringContainsString("'2026-05-04'", $src);
        self::assertStringNotContainsString("'2026-05-05'", $src);
        self::assertStringContainsString("['Donna', 'Lee', 'physician', 'Donna', 'Lee']", $src);
        self::assertStringContainsString("\$keys = ['A'];", $src);
    }

    public function testScheduledPatientsAllMapToSingleProviderKey(): void
    {
        $src = $this->readFile(self::APPOINTMENT_SEED_PATH);

        self::assertStringContainsString("\$scheduledPatients = [", $src);
        self::assertStringNotContainsString("af_scheduled_patient('B'", $src);
        self::assertStringNotContainsString("af_scheduled_patient('C'", $src);
        self::assertSame(15, substr_count($src, "af_scheduled_patient('A'"));
        self::assertSame(15, substr_count($src, "['new', 30]"));
        self::assertSame(13, substr_count($src, "['established', 15]"));
    }

    public function testVisitIntakeUsesSameAppointmentWindow(): void
    {
        $src = $this->readFile(self::VISIT_INTAKE_SEED_PATH);

        self::assertStringContainsString("'2026-05-01'", $src);
        self::assertStringContainsString("'2026-05-02'", $src);
        self::assertStringContainsString("'2026-05-03'", $src);
        self::assertStringContainsString("'2026-05-04'", $src);
        self::assertStringNotContainsString("'2026-05-05'", $src);
        self::assertStringContainsString("private const LEGACY_DELETE_START = '2026-05-01';", $src);
        self::assertStringContainsString("private const LEGACY_DELETE_END = '2026-05-04';", $src);
    }

    private function readFile(string $path): string
    {
        self::assertFileExists($path);
        $src = file_get_contents($path);
        self::assertNotFalse($src, $path);

        return $src;
    }
}
