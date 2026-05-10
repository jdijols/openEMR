<?php

/**
 * AgentForge synthetic appointment seed.
 *
 * @package OpenEMR
 * @link https://www.open-emr.org
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Services\AppointmentService;
use OpenEMR\Services\PatientService;
use OpenEMR\Validators\ProcessingResult;

if (php_sapi_name() !== 'cli') {
    fwrite(STDERR, "This script must be run from PHP CLI.\n");
    exit(1);
}

$fileRoot = dirname(__DIR__, 3);
$_GET['site'] = $_GET['site'] ?? 'default';
$ignoreAuth = true;
$sessionAllowWrite = true;

require_once $fileRoot . '/interface/globals.php';

final class AgentForgeAppointmentSeeder
{
    /**
     * Fixed four-day demo window. Each demo patient is scheduled exactly once across these days; dev/demo only.
     *
     * 2026-05-10 migration: window shifted +1 day from 2026-05-09..12
     * (Sat-Tue) to 2026-05-10..13 (Sun-Wed) for the demo-day reset, and
     * Sunday now carries the W2-cohort spotlight (was Saturday). The four
     * W2 cohort patients (Margaret Chen, James Whitaker, Sofia Reyes,
     * Robert Kowalski) still fill the first four 30-min new-patient slots
     * on the spotlight day. Sunday carries 11 appointments; Mon/Tue/Wed
     * carry 7 each (32 total, unchanged).
     *
     * 2026-05-07 migration: window shifted from 2026-05-10..13 (Sun-Wed)
     * to 2026-05-09..12 (Sat-Tue) and Saturday became the W2-cohort
     * spotlight day.
     *
     * G2-Final-71 (2026-05-06): demo window migrated forward from
     * 2026-05-01..04 to 2026-05-10..13 (Sun-Wed of submission week) so
     * graders opening the deployed app on submission day see fresh
     * appointments on the calendar instead of week-old slots.
     *
     * @var list<string>
     */
    private const DEMO_WEEKDAY_DATES = [
        '2026-05-10',
        '2026-05-11',
        '2026-05-12',
        '2026-05-13',
    ];

    private const EXPECTED_DEMO_PATIENT_COUNT = 32;
    private const APPOINTMENT_MARKER = '[AgentForge Appointment Seed]';
    private const SCHEDULED_PATIENT_PREFIX = 'AF-SCHEDULED-';
    private const FIRST_SCHEDULED_PATIENT_EXTERNAL_ID = 14;
    private const COHORT_PREFIX = 'AF-COHORT-';
    private const DEMO_MARKER_TABLE = 'agentforge_demo_patient_markers';
    private const DEMO_MARKER_KIND_SCHEDULED = 'scheduled';
    private const DEMO_MARKER_KIND_COHORT = 'cohort';
    // Legacy genericname1/genericval1 marker name used pre-2026-05-08; the
    // scheduled-patient cleanup query still falls back to this so a re-seed
    // against an older DB picks up rows that pre-date the marker table.
    private const LEGACY_SCHEDULED_MARKER_NAME = 'AgentForge Scheduled Patient ID';
    private const DEFAULT_GROUP = 'Default';
    private const EASY_DEV_BASE_URL = 'http://localhost:8300';

    private AppointmentService $appointmentService;
    private PatientService $patientService;

    /** @var array<string, array{id:int, username:string, display:string}> */
    private array $providers;

    /** @var array{id:int, name:string} */
    private array $facility;

    private int $systemUserId;

    /** @var array<string, int> */
    private array $categoryIds;

    /**
     * @param list<array<string, mixed>> $scheduledPatientSpecs
     */
    public function __construct(private readonly array $scheduledPatientSpecs, private readonly string $fileRoot)
    {
        $this->appointmentService = new AppointmentService();
        $this->patientService = new PatientService();
        $this->providers = $this->loadProviders();
        $this->facility = $this->loadFacility();
        $this->systemUserId = $this->loadSystemUserId();
        $this->categoryIds = $this->loadCategoryIds();
        $this->seedSession();
    }

    public function run(): void
    {
        $this->assertBaseline();
        $this->ensureDemoMarkerTable();
        $this->normalizeStockDemoPatients();
        $this->clearExistingSeed();

        $scheduledPatients = $this->createScheduledPatients();
        $stockPatients = $this->loadStockPatients();
        $cohortPatients = $this->loadCohortPatients();

        // Split cohort by source. W1 cohort patients (AF-COHORT-001..010, source
        // 'cohort') are established follow-ups that fill 'established' template
        // slots. W2 cohort patients (AF-COHORT-011..014, source 'new') are the
        // multimodal-orchestrator extractor/retriever test cohort and must all
        // land on day 0 (Saturday) at 30 min each. They are placed at the front
        // of the new-patient pool so the day-0 template's first four 'new' slots
        // pick them up in order (Chen, Whitaker, Reyes, Kowalski).
        $w1CohortPatients = array_values(array_filter($cohortPatients, static fn(array $p): bool => $p['source'] === 'cohort'));
        $w2CohortPatients = array_values(array_filter($cohortPatients, static fn(array $p): bool => $p['source'] === 'new'));

        $establishedPatients = array_merge($stockPatients, $w1CohortPatients);
        $newPatients = array_merge($w2CohortPatients, $scheduledPatients);
        $demoPatients = array_merge($establishedPatients, $newPatients);
        $this->assignDemoPatientsToAppointmentProvider($demoPatients);

        if ($establishedPatients === []) {
            throw new RuntimeException('Need at least one stock or AgentForge cohort patient for established-patient appointments.');
        }

        $this->assertDemoPatientRoster($demoPatients);
        $appointments = $this->seedAppointments($establishedPatients, $newPatients);
        $this->assertAppointmentCoverage($appointments, $demoPatients);
        $this->writeManifest($appointments, $stockPatients, $cohortPatients, $scheduledPatients);
        $this->printSummary($appointments, $stockPatients, $cohortPatients, $scheduledPatients);
        $this->printSanityQueries();
    }

    private function assertBaseline(): void
    {
        if (count($this->providers) < 1) {
            throw new RuntimeException('Need Donna Lee or the physician user to be active and authorized before seeding AgentForge appointments.');
        }

        if ($this->facility['id'] <= 0) {
            throw new RuntimeException('No facility row found. Run dev-reset-install-demodata before seeding appointments.');
        }

        foreach (['established_patient', 'new_patient'] as $constantId) {
            if (empty($this->categoryIds[$constantId])) {
                throw new RuntimeException("Missing active calendar category {$constantId}.");
            }
        }
    }

    /**
     * @return array<string, array{id:int, username:string, display:string}>
     */
    private function loadProviders(): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT id, username, fname, lname
             FROM users
             WHERE authorized = 1 AND active = 1
             AND ((fname = ? AND lname = ?) OR username = ?)
             ORDER BY CASE WHEN fname = ? AND lname = ? THEN 1 ELSE 2 END,
             CASE username
                WHEN 'physician' THEN 1
                ELSE 4
             END,
             id
             LIMIT 1",
            ['Donna', 'Lee', 'physician', 'Donna', 'Lee']
        );

        $providers = [];
        $keys = ['A'];
        foreach ($rows as $index => $row) {
            $providers[$keys[$index]] = [
                'id' => (int)$row['id'],
                'username' => (string)$row['username'],
                'display' => trim((string)($row['fname'] ?? '') . ' ' . (string)($row['lname'] ?? '')) ?: (string)$row['username'],
            ];
        }

        return $providers;
    }

    /**
     * @return array{id:int, name:string}
     */
    private function loadFacility(): array
    {
        $row = QueryUtils::fetchRecords(
            "SELECT id, name
             FROM facility
             ORDER BY primary_business_entity DESC, service_location DESC, id
             LIMIT 1"
        )[0] ?? null;

        return [
            'id' => (int)($row['id'] ?? 0),
            'name' => (string)($row['name'] ?? ''),
        ];
    }

    private function loadSystemUserId(): int
    {
        $systemUserId = QueryUtils::fetchSingleValue(
            "SELECT id FROM users WHERE username = ? ORDER BY id LIMIT 1",
            'id',
            ['oe-system']
        );

        if (!empty($systemUserId)) {
            return (int)$systemUserId;
        }

        return (int)QueryUtils::fetchSingleValue(
            "SELECT id FROM users WHERE username = ? ORDER BY id LIMIT 1",
            'id',
            ['admin']
        );
    }

    /**
     * @return array<string, int>
     */
    private function loadCategoryIds(): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT pc_catid, pc_constant_id
             FROM openemr_postcalendar_categories
             WHERE pc_active = 1 AND pc_constant_id IN (?, ?)",
            ['established_patient', 'new_patient']
        );

        $categoryIds = [];
        foreach ($rows as $row) {
            $categoryIds[(string)$row['pc_constant_id']] = (int)$row['pc_catid'];
        }

        return $categoryIds;
    }

    private function seedSession(): void
    {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $session->set('authUserID', $this->systemUserId);
        $session->set('authUser', 'oe-system');
        $session->set('userauthorized', 1);
        $session->set('groupname', self::DEFAULT_GROUP);
        $session->set('site_id', $_GET['site'] ?? 'default');
    }

    private function clearExistingSeed(): void
    {
        QueryUtils::sqlStatementThrowException(
            "DELETE FROM openemr_postcalendar_events WHERE pc_hometext LIKE ?",
            [self::APPOINTMENT_MARKER . '%']
        );

        // Identify scheduled patients via the demo-marker table; also pick up
        // any legacy rows that still carry the marker in genericname1/val1 so
        // the first re-seed after this migration cleans both surfaces.
        $scheduledPatientPids = QueryUtils::fetchTableColumn(
            "SELECT pid
             FROM patient_data
             WHERE pid IN (SELECT pid FROM " . self::DEMO_MARKER_TABLE . " WHERE marker_kind = ?)
                OR (genericname1 = ? AND genericval1 LIKE ?)",
            'pid',
            [
                self::DEMO_MARKER_KIND_SCHEDULED,
                self::LEGACY_SCHEDULED_MARKER_NAME,
                self::SCHEDULED_PATIENT_PREFIX . '%',
            ]
        );

        $pids = array_map(static fn(int|string $pid): int => (int)$pid, $scheduledPatientPids);
        if ($pids === []) {
            return;
        }

        QueryUtils::sqlStatementThrowException(
            $this->inSql("DELETE FROM openemr_postcalendar_events WHERE pc_pid IN (%s)", $pids),
            $pids
        );
        QueryUtils::sqlStatementThrowException(
            $this->inSql("DELETE FROM patient_access_onsite WHERE pid IN (%s)", $pids),
            $pids
        );
        QueryUtils::sqlStatementThrowException(
            $this->inSql("DELETE FROM " . self::DEMO_MARKER_TABLE . " WHERE pid IN (%s)", $pids),
            $pids
        );
        QueryUtils::sqlStatementThrowException(
            $this->inSql("DELETE FROM patient_data WHERE pid IN (%s)", $pids),
            $pids
        );
    }

    private function normalizeStockDemoPatients(): void
    {
        foreach ($this->stockPatientDemographics() as $patient) {
            QueryUtils::sqlStatementThrowException(
                "UPDATE patient_data
                 SET pubpid = ?, DOB = ?, phone_home = ?, ss = ?
                 WHERE pid = ? AND fname = ? AND lname = ?",
                [
                    $patient['pubpid'],
                    $patient['DOB'],
                    $patient['phone_home'],
                    $patient['ss'],
                    $patient['pid'],
                    $patient['fname'],
                    $patient['lname'],
                ]
            );
        }
    }

    /**
     * @return list<array{pid:int, pubpid:string, fname:string, lname:string, DOB:string, phone_home:string, ss:string}>
     */
    private function stockPatientDemographics(): array
    {
        return [
            [
                'pid' => 1,
                'pubpid' => '0001',
                'fname' => 'Phil',
                'lname' => 'Belford',
                'DOB' => '1972-02-09',
                'phone_home' => '(619) 555-0001',
                'ss' => '900-45-0001',
            ],
            [
                'pid' => 2,
                'pubpid' => '0002',
                'fname' => 'Susan',
                'lname' => 'Underwood',
                'DOB' => '1967-02-08',
                'phone_home' => '(619) 555-0002',
                'ss' => '900-45-0002',
            ],
            [
                'pid' => 3,
                'pubpid' => '0003',
                'fname' => 'Wanda',
                'lname' => 'Moore',
                'DOB' => '2007-02-18',
                'phone_home' => '(619) 555-0003',
                'ss' => '900-45-0003',
            ],
        ];
    }

    /**
     * @return list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}>
     */
    private function createScheduledPatients(): array
    {
        $patients = [];
        foreach ($this->scheduledPatientSpecs as $index => $patientSpec) {
            $provider = $this->providers[$patientSpec['primary_provider']];
            $number = $index + 1;
            $marker = sprintf('%s%03d', self::SCHEDULED_PATIENT_PREFIX, $number);
            $externalId = sprintf('%04d', self::FIRST_SCHEDULED_PATIENT_EXTERNAL_ID + $index);
            $result = $this->patientService->insert([
                'pubpid' => $externalId,
                'fname' => $patientSpec['fname'],
                'lname' => $patientSpec['lname'],
                'mname' => $patientSpec['mname'] ?? '',
                'DOB' => $patientSpec['DOB'],
                'sex' => $patientSpec['sex'],
                'status' => $patientSpec['status'] ?? 'single',
                'language' => $patientSpec['language'] ?? 'english',
                'street' => $patientSpec['street'],
                'city' => $patientSpec['city'] ?? 'San Diego',
                'state' => $patientSpec['state'] ?? 'CA',
                'postal_code' => $patientSpec['postal_code'] ?? '92101',
                'phone_home' => $patientSpec['phone_home'] ?? sprintf('(619) 555-%04d', 3000 + $number),
                'phone_cell' => $patientSpec['phone_cell'] ?? '',
                'ss' => $patientSpec['ss'] ?? sprintf('900-46-%04d', 3000 + $number),
                'email' => $patientSpec['email'] ?? strtolower($patientSpec['fname'] . '.' . $patientSpec['lname']) . '@example.invalid',
                'providerID' => $provider['id'],
                'financial_review' => date('Y-m-d 00:00:00'),
                'hipaa_mail' => 'YES',
                'hipaa_voice' => 'YES',
                'hipaa_notice' => 'YES',
                'hipaa_message' => 'YES',
            ]);

            $this->assertProcessingResult($result, 'scheduled patient ' . $marker);
            $record = $result->getFirstDataResult();
            $pid = (int)$record['pid'];
            $this->insertDemoMarker($pid, self::DEMO_MARKER_KIND_SCHEDULED, $marker);
            $patients[] = [
                'pid' => $pid,
                'pubpid' => $externalId,
                'name' => $patientSpec['fname'] . ' ' . $patientSpec['lname'],
                'source' => 'new',
                'primary_provider' => $provider['display'],
            ];
        }

        return $patients;
    }

    /**
     * @return list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}>
     */
    private function loadStockPatients(): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT p.pid, p.pubpid, p.fname, p.lname, u.fname AS provider_fname, u.lname AS provider_lname
             FROM patient_data p
             LEFT JOIN users u ON u.id = p.providerID
             WHERE p.pid IN (1, 2, 3)
             ORDER BY p.pid"
        );

        return array_map(static function (array $row): array {
            return [
                'pid' => (int)$row['pid'],
                'pubpid' => (string)$row['pubpid'],
                'name' => trim((string)$row['fname'] . ' ' . (string)$row['lname']),
                'source' => 'stock',
                'primary_provider' => trim((string)($row['provider_fname'] ?? '') . ' ' . (string)($row['provider_lname'] ?? '')),
            ];
        }, $rows);
    }

    /**
     * @return list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}>
     */
    private function loadCohortPatients(): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT p.pid, p.pubpid, p.fname, p.lname, m.marker_label,
                    u.fname AS provider_fname, u.lname AS provider_lname
             FROM " . self::DEMO_MARKER_TABLE . " m
             JOIN patient_data p ON p.pid = m.pid
             LEFT JOIN users u ON u.id = p.providerID
             WHERE m.marker_kind = ?
             ORDER BY CAST(p.pubpid AS UNSIGNED), p.pid",
            [self::DEMO_MARKER_KIND_COHORT]
        );

        $prefixLen = strlen(self::COHORT_PREFIX);
        return array_map(static function (array $row) use ($prefixLen): array {
            // W2 cohort patients (AF-COHORT-011+) are walk-in new-patient
            // appointments per W2_ARCHITECTURE.md §10. W1 cohort patients
            // (AF-COHORT-001..010) remain established follow-ups.
            $cohortNumber = (int)substr((string)$row['marker_label'], $prefixLen);
            return [
                'pid' => (int)$row['pid'],
                'pubpid' => (string)$row['pubpid'],
                'name' => trim((string)$row['fname'] . ' ' . (string)$row['lname']),
                'source' => $cohortNumber >= 11 ? 'new' : 'cohort',
                'primary_provider' => trim((string)($row['provider_fname'] ?? '') . ' ' . (string)($row['provider_lname'] ?? '')),
            ];
        }, $rows);
    }

    /**
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $demoPatients
     */
    private function assignDemoPatientsToAppointmentProvider(array $demoPatients): void
    {
        $provider = $this->providers['A'];
        foreach ($demoPatients as $patient) {
            QueryUtils::sqlStatementThrowException(
                "UPDATE patient_data SET providerID = ? WHERE pid = ?",
                [(int)$provider['id'], (int)$patient['pid']]
            );
        }
    }

    /**
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $establishedPatients
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $newPatients
     * @return list<array<string, mixed>>
     */
    private function seedAppointments(array $establishedPatients, array $newPatients): array
    {
        $weekdays = self::DEMO_WEEKDAY_DATES;
        $templates = $this->scheduleTemplates();
        $establishedIndex = 0;
        $newIndex = 0;
        $patientSchedule = [];
        /** @var array<int, array<string, list<array{start:int, end:int}>>> */
        $providerSchedule = [];
        /** @var array<int, true> */
        $usedPidsGlobal = [];
        $appointments = [];
        $skippedSlots = 0;

        foreach ($weekdays as $dayIndex => $date) {
            $templateIndex = $dayIndex % count($templates);
            foreach ($this->providers as $providerKey => $provider) {
                foreach ($templates[$templateIndex][$providerKey] as $slotIndex => $slot) {
                    $startMinutes = $this->minutesSinceMidnight($slot['start']);
                    $endMinutes = $startMinutes + (int)($slot['duration'] / 60);
                    if ($this->calendarIntervalHasOverlap((int)$provider['id'], $date, $startMinutes, $endMinutes, $providerSchedule)) {
                        $skippedSlots++;
                        continue;
                    }

                    $pool = $slot['source'] === 'new' ? $newPatients : $establishedPatients;
                    $poolIndex = $slot['source'] === 'new' ? $newIndex : $establishedIndex;
                    $patient = $this->choosePatient(
                        $pool,
                        $poolIndex,
                        $date,
                        $slot['start'],
                        (int)$slot['duration'],
                        $patientSchedule,
                        $usedPidsGlobal
                    );

                    if ($slot['source'] === 'new') {
                        $newIndex = $poolIndex;
                    } else {
                        $establishedIndex = $poolIndex;
                    }

                    if ($patient === null) {
                        $skippedSlots++;
                        continue;
                    }

                    $title = $this->appointmentTitle((string)$slot['source'], (int)$slot['duration'], $dayIndex, $slotIndex);
                    $eid = $this->appointmentService->insert($patient['pid'], [
                        'pc_catid' => $slot['source'] === 'new' ? $this->categoryIds['new_patient'] : $this->categoryIds['established_patient'],
                        'pc_title' => $title,
                        'pc_duration' => (int)$slot['duration'],
                        'pc_hometext' => self::APPOINTMENT_MARKER . ' ' . $title,
                        'pc_apptstatus' => '-',
                        'pc_eventDate' => $date,
                        'pc_startTime' => $slot['start'],
                        'pc_facility' => $this->facility['id'],
                        'pc_billing_location' => $this->facility['id'],
                        'pc_aid' => $provider['id'],
                        'pc_website' => null,
                    ]);

                    $appointments[] = [
                        'eid' => (int)$eid,
                        'date' => $date,
                        'provider_key' => $providerKey,
                        'provider' => $provider['display'],
                        'start' => $slot['start'],
                        'end' => $this->endTime($slot['start'], (int)$slot['duration']),
                        'duration_minutes' => (int)($slot['duration'] / 60),
                        'category' => $slot['source'] === 'new' ? 'New Patient' : 'Established Patient',
                        'patient_source' => $patient['source'],
                        'pid' => $patient['pid'],
                        'pubpid' => $patient['pubpid'],
                        'patient' => $patient['name'],
                        'title' => $title,
                    ];
                    $providerSchedule[$provider['id']][$date][] = [
                        'start' => $startMinutes,
                        'end' => $endMinutes,
                    ];
                }
            }
        }

        $this->appendOverflowAppointmentsForUnusedPatients(
            $appointments,
            $establishedPatients,
            $newPatients,
            $usedPidsGlobal,
            $providerSchedule,
            $patientSchedule
        );

        if ($skippedSlots > 0) {
            echo "Note: skipped {$skippedSlots} template slot(s) — no unused patient available in pool, provider already booked, or patient time collision.\n";
        }

        return $appointments;
    }

    /**
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $demoPatients
     */
    private function assertDemoPatientRoster(array $demoPatients): void
    {
        $pids = array_map(static fn(array $patient): int => (int)$patient['pid'], $demoPatients);
        $uniquePids = array_values(array_unique($pids));
        if (count($uniquePids) !== self::EXPECTED_DEMO_PATIENT_COUNT) {
            throw new RuntimeException(sprintf(
                'Expected exactly %d AgentForge demo patients before scheduling, found %d.',
                self::EXPECTED_DEMO_PATIENT_COUNT,
                count($uniquePids)
            ));
        }
    }

    /**
     * @param list<array<string, mixed>> $appointments
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $demoPatients
     */
    private function assertAppointmentCoverage(array $appointments, array $demoPatients): void
    {
        $expectedPids = array_map(static fn(array $patient): int => (int)$patient['pid'], $demoPatients);
        sort($expectedPids);

        $appointmentPids = array_map(static fn(array $appointment): int => (int)$appointment['pid'], $appointments);
        $uniqueAppointmentPids = array_values(array_unique($appointmentPids));
        sort($uniqueAppointmentPids);

        if (count($appointments) !== self::EXPECTED_DEMO_PATIENT_COUNT) {
            throw new RuntimeException(sprintf(
                'Expected exactly %d AgentForge appointments across the four-day demo window, created %d.',
                self::EXPECTED_DEMO_PATIENT_COUNT,
                count($appointments)
            ));
        }

        if (count($appointmentPids) !== count($uniqueAppointmentPids)) {
            throw new RuntimeException('AgentForge appointment seed produced duplicate patient appointments.');
        }

        if ($uniqueAppointmentPids !== $expectedPids) {
            $missing = array_diff($expectedPids, $uniqueAppointmentPids);
            $unexpected = array_diff($uniqueAppointmentPids, $expectedPids);
            throw new RuntimeException(sprintf(
                'AgentForge appointment seed did not cover the exact demo roster. Missing pids: [%s]. Unexpected pids: [%s].',
                implode(', ', $missing),
                implode(', ', $unexpected)
            ));
        }
    }

    /**
     * Place any demo patient who did not receive a template slot into a short final-day overflow visit
     * so the cohort is fully represented on the calendar.
     *
     * @param list<array<string, mixed>> $appointments
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $establishedPatients
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $newPatients
     * @param array<int, true> $usedPidsGlobal
     * @param array<int, array<string, list<array{start:int, end:int}>>> $providerSchedule
     * @param array<int, array<string, list<array{start:int, end:int}>>> $patientSchedule
     */
    private function appendOverflowAppointmentsForUnusedPatients(
        array &$appointments,
        array $establishedPatients,
        array $newPatients,
        array &$usedPidsGlobal,
        array &$providerSchedule,
        array &$patientSchedule
    ): void {
        $byPid = [];
        foreach (array_merge($establishedPatients, $newPatients) as $patient) {
            $byPid[(int)$patient['pid']] = $patient;
        }

        $overflow = [];
        foreach ($byPid as $pid => $patient) {
            if (!isset($usedPidsGlobal[$pid])) {
                $overflow[$pid] = $patient;
            }
        }

        if ($overflow === []) {
            return;
        }

        $lastDay = self::DEMO_WEEKDAY_DATES[array_key_last(self::DEMO_WEEKDAY_DATES)];
        $times = [
            '15:45', '16:00', '16:15', '16:30', '16:45', '17:00', '17:15', '17:30', '17:45',
            '18:00', '18:15', '18:30',
        ];
        $dayIndex = count(self::DEMO_WEEKDAY_DATES) - 1;
        $slotCounter = 0;

        foreach ($overflow as $pid => $patient) {
            $slotSource = $patient['source'] === 'new' ? 'new' : 'established';
            $duration = 15 * 60;
            $placed = false;

            foreach ($times as $start) {
                $startMinutes = $this->minutesSinceMidnight($start);
                $endMinutes = $startMinutes + 15;
                foreach ($this->providers as $providerKey => $provider) {
                    if ($this->calendarIntervalHasOverlap((int)$provider['id'], $lastDay, $startMinutes, $endMinutes, $providerSchedule)) {
                        continue;
                    }

                    if ($this->patientHasOverlap($pid, $lastDay, $startMinutes, $endMinutes, $patientSchedule)) {
                        continue;
                    }

                    $title = $this->appointmentTitle($slotSource, $duration, $dayIndex, 900 + $slotCounter);
                    $slotCounter++;
                    $eid = $this->appointmentService->insert($pid, [
                        'pc_catid' => $slotSource === 'new' ? $this->categoryIds['new_patient'] : $this->categoryIds['established_patient'],
                        'pc_title' => $title,
                        'pc_duration' => $duration,
                        'pc_hometext' => self::APPOINTMENT_MARKER . ' ' . $title,
                        'pc_apptstatus' => '-',
                        'pc_eventDate' => $lastDay,
                        'pc_startTime' => $start,
                        'pc_facility' => $this->facility['id'],
                        'pc_billing_location' => $this->facility['id'],
                        'pc_aid' => $provider['id'],
                        'pc_website' => null,
                    ]);

                    $usedPidsGlobal[$pid] = true;
                    $providerSchedule[$provider['id']][$lastDay][] = [
                        'start' => $startMinutes,
                        'end' => $endMinutes,
                    ];
                    $patientSchedule[$pid][$lastDay][] = [
                        'start' => $startMinutes,
                        'end' => $endMinutes,
                    ];

                    $appointments[] = [
                        'eid' => (int)$eid,
                        'date' => $lastDay,
                        'provider_key' => $providerKey,
                        'provider' => $provider['display'],
                        'start' => $start,
                        'end' => $this->endTime($start, $duration),
                        'duration_minutes' => 15,
                        'category' => $slotSource === 'new' ? 'New Patient' : 'Established Patient',
                        'patient_source' => $patient['source'],
                        'pid' => $pid,
                        'pubpid' => (string)$patient['pubpid'],
                        'patient' => $patient['name'],
                        'title' => $title,
                    ];
                    $placed = true;
                    break 2;
                }
            }

            if (!$placed) {
                throw new RuntimeException("AgentForge appointments: could not place overflow slot for pid {$pid} ({$patient['name']}).");
            }
        }
    }

    private function scheduleTemplates(): array
    {
        // Day 0 (Saturday) is the W2-cohort spotlight day with 11 appointments:
        // a back-to-back morning block of four 30-min new-patient intakes (the
        // four W2 cohort patients in pool order), then a small mid-morning
        // established-patient cluster, then more new-patient slots through
        // lunch. Days 1-3 (Sun/Mon/Tue) are normal 7-appointment clinic days.
        return [
            // Day 0 — Saturday (11 slots): 8 new (4 W2 cohort + 4 scheduled), 3 established.
            [
                'A' => $this->block('08:00', [
                    ['new', 30],
                    ['new', 30],
                    ['new', 30],
                    ['new', 30],
                    ['established', 15],
                    ['established', 15],
                    ['new', 30],
                    ['new', 30],
                    ['established', 15],
                    ['new', 30],
                    ['new', 30],
                ]),
            ],
            // Day 1 — Sunday (7 slots): 4 new, 3 established.
            [
                'A' => $this->block('08:30', [
                    ['established', 15],
                    ['new', 30],
                    ['established', 15],
                    ['new', 30],
                    ['new', 30],
                    ['established', 15],
                    ['new', 30],
                ]),
            ],
            // Day 2 — Monday (7 slots): 4 new, 3 established.
            [
                'A' => $this->block('08:30', [
                    ['new', 30],
                    ['established', 15],
                    ['new', 30],
                    ['new', 30],
                    ['established', 15],
                    ['new', 30],
                    ['established', 15],
                ]),
            ],
            // Day 3 — Tuesday (7 slots): 3 new, 4 established.
            [
                'A' => $this->block('08:30', [
                    ['established', 15],
                    ['new', 30],
                    ['established', 15],
                    ['established', 15],
                    ['new', 30],
                    ['established', 15],
                    ['new', 30],
                ]),
            ],
        ];
    }

    /**
     * @param list<array{string, int}> $items
     * @return list<array{start:string, duration:int, source:string}>
     */
    private function block(string $startTime, array $items): array
    {
        $slots = [];
        $cursor = new DateTimeImmutable('2000-01-01 ' . $startTime);

        foreach ($items as $item) {
            [$source, $durationMinutes] = $item;
            $slots[] = [
                'start' => $cursor->format('H:i'),
                'duration' => $durationMinutes * 60,
                'source' => $source,
            ];
            $cursor = $cursor->modify('+' . $durationMinutes . ' minutes');
        }

        return $slots;
    }

    /**
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $pool
     * @param array<int, array<string, list<array{start:int, end:int}>>> $patientSchedule
     * @param array<int, true> $usedPidsGlobal
     * @return array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}|null
     */
    private function choosePatient(
        array $pool,
        int &$poolIndex,
        string $date,
        string $startTime,
        int $duration,
        array &$patientSchedule,
        array &$usedPidsGlobal
    ): ?array {
        if ($pool === []) {
            return null;
        }

        $startMinutes = $this->minutesSinceMidnight($startTime);
        $endMinutes = $startMinutes + (int)($duration / 60);
        $poolCount = count($pool);

        for ($attempt = 0; $attempt < $poolCount; $attempt++) {
            $candidateIndex = ($poolIndex + $attempt) % $poolCount;
            $patient = $pool[$candidateIndex];
            if (isset($usedPidsGlobal[(int)$patient['pid']])) {
                continue;
            }

            if ($this->patientHasOverlap((int)$patient['pid'], $date, $startMinutes, $endMinutes, $patientSchedule)) {
                continue;
            }

            $poolIndex = ($candidateIndex + 1) % $poolCount;
            $usedPidsGlobal[(int)$patient['pid']] = true;
            $patientSchedule[$patient['pid']][$date][] = [
                'start' => $startMinutes,
                'end' => $endMinutes,
            ];

            return $patient;
        }

        return null;
    }

    /**
     * @param array<int, array<string, list<array{start:int, end:int}>>> $schedule keyed by provider id, then date
     */
    private function calendarIntervalHasOverlap(int $calendarId, string $date, int $startMinutes, int $endMinutes, array $schedule): bool
    {
        foreach ($schedule[$calendarId][$date] ?? [] as $block) {
            if ($startMinutes < $block['end'] && $endMinutes > $block['start']) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<int, array<string, list<array{start:int, end:int}>>> $patientSchedule
     */
    private function patientHasOverlap(int $pid, string $date, int $startMinutes, int $endMinutes, array $patientSchedule): bool
    {
        foreach ($patientSchedule[$pid][$date] ?? [] as $appointment) {
            if ($startMinutes < $appointment['end'] && $endMinutes > $appointment['start']) {
                return true;
            }
        }

        return false;
    }

    private function appointmentTitle(string $source, int $duration, int $dayIndex, int $slotIndex): string
    {
        $newPatientTitles = [
            'New patient intake: transfer of care',
            'New patient visit: hypertension concern',
            'New patient visit: preventive care',
            'New patient intake: medication reconciliation',
            'New patient visit: fatigue evaluation',
            'New patient visit: diabetes risk counseling',
        ];
        $establishedTitles = [
            'Diabetes follow-up and refills',
            'Blood pressure check',
            'Medication follow-up',
            'Annual preventive visit',
            'Asthma action plan review',
            'ADHD medication follow-up',
            'Lab review and care plan',
            'Anticoagulation follow-up',
            'Geriatric medication review',
            'Postpartum primary-care follow-up',
            'Migraine follow-up',
            'Sports physical',
        ];
        $complexTitles = [
            'Complex chronic care follow-up',
            'Care gap closure visit',
            'Multiple medication review',
            'Diabetes and kidney monitoring',
        ];

        if ($source === 'new') {
            return $newPatientTitles[($dayIndex + $slotIndex) % count($newPatientTitles)];
        }

        if ($duration >= 1800) {
            return $complexTitles[($dayIndex + $slotIndex) % count($complexTitles)];
        }

        return $establishedTitles[($dayIndex + $slotIndex) % count($establishedTitles)];
    }

    /**
     * @param list<array<string, mixed>> $appointments
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $stockPatients
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $cohortPatients
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $scheduledPatients
     */
    private function writeManifest(array $appointments, array $stockPatients, array $cohortPatients, array $scheduledPatients): void
    {
        $path = $this->fileRoot . '/Documentation/AgentForge/cohort/appointments.md';
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create appointment manifest directory: ' . $dir);
        }

        $summary = $this->providerDateSummary($appointments);
        $lines = [
            '# AgentForge Synthetic Appointment Schedule',
            '',
            'Generated by `contrib/util/agentforge/seed_appointments.php` on ' . date('Y-m-d H:i:s T') . '.',
            '',
            'All appointments and scheduled-patient records are fabricated synthetic data for demo and evaluation use only.',
            '',
            '**Demo window:** **Saturday 2026-05-09 through Tuesday 2026-05-12** only. Saturday is the W2-cohort spotlight day (4 multimodal-orchestrator test patients in the first four 30-min slots, then 7 other appointments). Each of the 32 demo patients appears **exactly once** across the four-day Donna Lee schedule.',
            'Run `contrib/util/agentforge/seed_visit_intake.php` after this script to create same-day intake encounters.',
            '',
            '## Patient Sources',
            '',
            sprintf('- Stock demo patients used: %d', count($stockPatients)),
            sprintf('- AgentForge cohort patients used: %d', count($cohortPatients)),
            sprintf('- Appointment-only scheduled patients created: %d', count($scheduledPatients)),
            '',
            '## Provider-Day Summary',
            '',
            '| date | provider | appointments | first | last | new-patient slots |',
            '| --- | --- | ---: | --- | --- | ---: |',
        ];

        foreach ($summary as $row) {
            $lines[] = sprintf(
                '| %s | %s | %d | %s | %s | %d |',
                $row['date'],
                $row['provider'],
                $row['count'],
                $row['first'],
                substr($row['last'], 0, 5),
                $row['new_count']
            );
        }

        $lines[] = '';
        $lines[] = '## Appointment Detail';
        $lines[] = '';
        $lines[] = '| date | provider | time | patient | source | category | title |';
        $lines[] = '| --- | --- | --- | --- | --- | --- | --- |';

        foreach ($appointments as $appointment) {
            $chartUrl = self::EASY_DEV_BASE_URL . '/interface/patient_file/summary/demographics.php?set_pid=' . $appointment['pid'];
            $lines[] = sprintf(
                '| %s | %s | %s-%s | [%s](%s) | %s | %s | %s |',
                $appointment['date'],
                $appointment['provider'],
                $appointment['start'],
                substr((string)$appointment['end'], 0, 5),
                str_replace('|', '/', (string)$appointment['patient']),
                $chartUrl,
                $appointment['patient_source'],
                $appointment['category'],
                str_replace('|', '/', (string)$appointment['title'])
            );
        }

        $lines[] = '';
        $lines[] = '## Verification';
        $lines[] = '';
        $lines[] = '- Calendar: `' . self::EASY_DEV_BASE_URL . '/interface/main/calendar/index.php`.';
        $firstScheduledExternalId = sprintf('%04d', self::FIRST_SCHEDULED_PATIENT_EXTERNAL_ID);
        $lastScheduledExternalId = sprintf('%04d', self::FIRST_SCHEDULED_PATIENT_EXTERNAL_ID + count($scheduledPatients) - 1);
        $lines[] = '- Finder: `' . self::EASY_DEV_BASE_URL . '/interface/main/finder/dynamic_finder.php` then search by External ID `' . $firstScheduledExternalId . '` through `' . $lastScheduledExternalId . '`.';
        $lines[] = '';
        $lines[] = '```sql';
        $lines[] = 'SELECT pc_eventDate, pc_aid, COUNT(*)';
        $lines[] = 'FROM openemr_postcalendar_events';
        $lines[] = "WHERE pc_hometext LIKE '" . self::APPOINTMENT_MARKER . "%'";
        $lines[] = 'GROUP BY pc_eventDate, pc_aid';
        $lines[] = 'ORDER BY pc_eventDate, pc_aid;';
        $lines[] = '';
        $lines[] = 'SELECT pc_eventDate, pc_aid, pc_startTime, pc_endTime, pc_pid, pc_title';
        $lines[] = 'FROM openemr_postcalendar_events';
        $lines[] = "WHERE pc_hometext LIKE '" . self::APPOINTMENT_MARKER . "%'";
        $lines[] = 'ORDER BY pc_eventDate, pc_aid, pc_startTime;';
        $lines[] = '```';
        $lines[] = '';

        file_put_contents($path, implode("\n", $lines) . "\n");
    }

    /**
     * @param list<array<string, mixed>> $appointments
     * @return list<array{date:string, provider:string, count:int, first:string, last:string, new_count:int}>
     */
    private function providerDateSummary(array $appointments): array
    {
        $summary = [];
        foreach ($appointments as $appointment) {
            $key = $appointment['date'] . '|' . $appointment['provider'];
            $summary[$key] ??= [
                'date' => (string)$appointment['date'],
                'provider' => (string)$appointment['provider'],
                'count' => 0,
                'first' => (string)$appointment['start'],
                'last' => (string)$appointment['end'],
                'new_count' => 0,
            ];
            $summary[$key]['count']++;
            $summary[$key]['first'] = min($summary[$key]['first'], (string)$appointment['start']);
            $summary[$key]['last'] = max($summary[$key]['last'], (string)$appointment['end']);
            if ($appointment['patient_source'] === 'new') {
                $summary[$key]['new_count']++;
            }
        }

        return array_values($summary);
    }

    /**
     * @param list<array<string, mixed>> $appointments
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $stockPatients
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $cohortPatients
     * @param list<array{pid:int, pubpid:string, name:string, source:string, primary_provider:string}> $scheduledPatients
     */
    private function printSummary(array $appointments, array $stockPatients, array $cohortPatients, array $scheduledPatients): void
    {
        echo "\nAgentForge synthetic appointments seeded successfully.\n\n";
        printf("Providers: %d\n", count($this->providers));
        printf("Stock patients used: %d\n", count($stockPatients));
        printf("Cohort patients used: %d\n", count($cohortPatients));
        printf("Appointment-only patients created: %d\n", count($scheduledPatients));
        printf("Appointments created: %d\n\n", count($appointments));
        echo "Provider/day summary:\n";
        printf("%-12s %-18s %-6s %-6s %-6s %-4s\n", 'date', 'provider', 'count', 'first', 'last', 'new');
        foreach ($this->providerDateSummary($appointments) as $row) {
            printf(
                "%-12s %-18s %-6d %-6s %-6s %-4d\n",
                $row['date'],
                $row['provider'],
                $row['count'],
                $row['first'],
                substr($row['last'], 0, 5),
                $row['new_count']
            );
        }
        echo "\nManifest written to Documentation/AgentForge/cohort/appointments.md\n";
    }

    private function printSanityQueries(): void
    {
        echo "\nSanity queries:\n";
        echo "SELECT pc_eventDate, pc_aid, COUNT(*) FROM openemr_postcalendar_events WHERE pc_hometext LIKE '" . self::APPOINTMENT_MARKER . "%' GROUP BY pc_eventDate, pc_aid ORDER BY pc_eventDate, pc_aid;\n";
        echo "SELECT pc_eventDate, pc_aid, pc_startTime, pc_endTime, pc_pid, pc_title FROM openemr_postcalendar_events WHERE pc_hometext LIKE '" . self::APPOINTMENT_MARKER . "%' ORDER BY pc_eventDate, pc_aid, pc_startTime;\n";
    }

    private function endTime(string $startTime, int $duration): string
    {
        return (new DateTimeImmutable('2000-01-01 ' . $startTime))
            ->modify('+' . (int)($duration / 60) . ' minutes')
            ->format('H:i:s');
    }

    private function minutesSinceMidnight(string $time): int
    {
        [$hour, $minute] = array_map('intval', explode(':', $time));
        return ($hour * 60) + $minute;
    }

    private function assertProcessingResult(ProcessingResult $result, string $label): void
    {
        if (!$result->isValid() || !$result->hasData()) {
            throw new RuntimeException($label . ' failed: ' . json_encode([
                'validation' => $result->getValidationMessages(),
                'internal' => $result->getInternalErrors(),
            ], JSON_THROW_ON_ERROR));
        }
    }

    /**
     * @param list<int|string> $values
     */
    private function placeholders(array $values): string
    {
        return implode(',', array_fill(0, count($values), '?'));
    }

    /**
     * @param list<int|string> $values
     */
    private function inSql(string $template, array $values): string
    {
        return sprintf($template, $this->placeholders($values));
    }

    private function ensureDemoMarkerTable(): void
    {
        // Identifies AgentForge demo patients without polluting patient_data
        // user-facing fields. Stored separately so the demographics widget
        // shows a blank "User Defined" line, the way stock OpenEMR patients do.
        QueryUtils::sqlStatementThrowException(
            "CREATE TABLE IF NOT EXISTS " . self::DEMO_MARKER_TABLE . " (
                pid INT(11) NOT NULL PRIMARY KEY,
                marker_kind VARCHAR(20) NOT NULL,
                marker_label VARCHAR(50) NOT NULL,
                KEY idx_marker_kind (marker_kind),
                KEY idx_marker_label (marker_label)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
        );
    }

    private function insertDemoMarker(int $pid, string $kind, string $label): void
    {
        QueryUtils::sqlStatementThrowException(
            "INSERT INTO " . self::DEMO_MARKER_TABLE . " (pid, marker_kind, marker_label)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE marker_kind = VALUES(marker_kind), marker_label = VALUES(marker_label)",
            [$pid, $kind, $label]
        );
    }
}

/**
 * @return array<string, mixed>
 */
function af_scheduled_patient(string $provider, string $fname, string $lname, string $dob, string $sex, string $street): array
{
    return [
        'primary_provider' => $provider,
        'fname' => $fname,
        'lname' => $lname,
        'DOB' => $dob,
        'sex' => $sex,
        'street' => $street,
    ];
}

$scheduledPatients = [
    af_scheduled_patient('A', 'Avery', 'Wells', '1992-05-04', 'Female', '2040 Kalmia Street'),
    af_scheduled_patient('A', 'Jordan', 'Price', '1988-09-21', 'Male', '7719 Bayview Drive'),
    af_scheduled_patient('A', 'Camila', 'Nguyen', '1979-02-14', 'Female', '3610 Citrus Avenue'),
    af_scheduled_patient('A', 'Logan', 'Carter', '2006-12-03', 'Male', '9551 Mesa Brook Lane'),
    af_scheduled_patient('A', 'Priya', 'Shah', '1968-07-29', 'Female', '1428 Laurel Canyon Road'),
    af_scheduled_patient('A', 'Noah', 'Bennett', '1958-01-18', 'Male', '8172 Harbor Point'),
    af_scheduled_patient('A', 'Elena', 'Morales', '1999-03-09', 'Female', '4309 Juniper Terrace'),
    af_scheduled_patient('A', 'Miles', 'Reed', '1981-11-17', 'Male', '2636 Mission Park Way'),
    af_scheduled_patient('A', 'Talia', 'Brooks', '1975-06-25', 'Female', '6405 Palm Grove Court'),
    af_scheduled_patient('A', 'Owen', 'Foster', '2013-10-08', 'Male', '1297 Redwood Circle'),
    af_scheduled_patient('A', 'Mei', 'Chen', '1949-04-30', 'Female', '5308 Vista Meadow Drive'),
    af_scheduled_patient('A', 'Isaac', 'Turner', '1962-08-12', 'Male', '9074 Seabreeze Avenue'),
    af_scheduled_patient('A', 'Rina', 'Kapoor', '1986-02-02', 'Female', '7780 Mesa Verde Lane'),
    af_scheduled_patient('A', 'Caleb', 'Morgan', '1994-09-13', 'Male', '3180 Laurel Street'),
    af_scheduled_patient('A', 'Amara', 'Cole', '2002-05-22', 'Female', '6042 Harbor View Road'),
];

try {
    (new AgentForgeAppointmentSeeder($scheduledPatients, $fileRoot))->run();
} catch (Throwable $throwable) {
    fwrite(STDERR, "AgentForge appointment seed failed: " . $throwable->getMessage() . "\n");
    fwrite(STDERR, $throwable->getTraceAsString() . "\n");
    exit(1);
}
