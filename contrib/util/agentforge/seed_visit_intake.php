<?php

/**
 * AgentForge same-day visit intake seed: encounter + MA vitals + intake note + social history touch-up
 * for each synthetic calendar row from seed_appointments.php (fixed demo week).
 *
 * Dev/demo only. Run after seed_appointments.php.
 *
 * @package OpenEMR
 * @link https://www.open-emr.org
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Services\ClinicalNotesService;
use OpenEMR\Services\EncounterService;
use OpenEMR\Services\VitalsService;
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

final class AgentForgeVisitIntakeSeeder
{
    public const APPOINTMENT_MARKER = '[AgentForge Appointment Seed]';
    public const INTAKE_REASON_PREFIX = '[AgentForge Intake] ';

    /** @var list<string> */
    private const DEMO_WEEKDAY_DATES = [
        '2026-05-04',
        '2026-05-05',
    ];

    private const LEGACY_DELETE_START = '2026-04-29';
    private const LEGACY_DELETE_END = '2026-05-01';

    private const COHORT_MARKER_NAME = 'AgentForge Cohort ID';
    private const COHORT_PREFIX = 'AF-COHORT-';
    private const SCHEDULED_PATIENT_MARKER_NAME = 'AgentForge Scheduled Patient ID';
    private const SCHEDULED_PATIENT_PREFIX = 'AF-SCHEDULED-';
    private const DEFAULT_GROUP = 'Default';

    private EncounterService $encounterService;
    private VitalsService $vitalsService;
    private ClinicalNotesService $clinicalNotesService;

    /** @var array{id:int, name:string} */
    private array $facility;

    private int $systemUserId;

    public function __construct(private readonly string $fileRoot)
    {
        $this->encounterService = new EncounterService();
        $this->vitalsService = new VitalsService();
        $this->clinicalNotesService = new ClinicalNotesService();
        $this->vitalsService->setShouldConvertVitalMeasurementsFlag(false);
        $this->facility = $this->loadFacility();
        $this->systemUserId = $this->loadSystemUserId();
        $this->seedSession();
    }

    public function run(): void
    {
        UuidRegistry::createMissingUuidsForTables(['patient_data']);

        $demoPids = $this->loadDemoPatientIds();
        if ($demoPids === []) {
            throw new RuntimeException('No AgentForge demo patients found (stock, cohort, or scheduled).');
        }

        $this->purgeEncountersInDateRange($demoPids, self::LEGACY_DELETE_START, self::LEGACY_DELETE_END);
        $this->purgeAgentForgeIntakeEncounters($demoPids);

        $appts = $this->loadAgentForgeAppointments();
        $created = 0;
        foreach ($appts as $row) {
            $this->seedIntakeForAppointment($row, $demoPids);
            $created++;
        }

        echo "\nAgentForge visit intake seed complete.\n";
        printf("Appointments processed: %d\n\n", $created);
        echo "Sanity: SELECT encounter, pid, date, reason FROM form_encounter WHERE reason LIKE '[AgentForge Intake]%' ORDER BY date, pid LIMIT 20;\n";
    }

    /**
     * @return list<int>
     */
    private function loadDemoPatientIds(): array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT pid FROM patient_data
             WHERE pid IN (1, 2, 3)
                OR (genericname1 = ? AND genericval1 LIKE ?)
                OR (genericname1 = ? AND genericval1 LIKE ?)
             ORDER BY pid",
            [
                self::COHORT_MARKER_NAME,
                self::COHORT_PREFIX . '%',
                self::SCHEDULED_PATIENT_MARKER_NAME,
                self::SCHEDULED_PATIENT_PREFIX . '%',
            ]
        );

        $pids = [];
        foreach ($rows as $row) {
            $pids[] = (int)$row['pid'];
        }

        return array_values(array_unique($pids));
    }

    /**
     * @param list<int> $demoPids
     */
    private function purgeEncountersInDateRange(array $demoPids, string $startYmd, string $endYmd): void
    {
        if ($demoPids === []) {
            return;
        }

        $rows = QueryUtils::fetchRecords(
            "SELECT encounter, pid FROM form_encounter
             WHERE pid IN (" . $this->placeholders($demoPids) . ")
             AND DATE(`date`) >= ?
             AND DATE(`date`) <= ?",
            array_merge($demoPids, [$startYmd, $endYmd])
        );

        foreach ($rows as $row) {
            $this->deleteEncounterCascade((int)$row['encounter'], (int)$row['pid']);
        }

        if ($rows !== []) {
            printf("Removed %d encounter(s) dated %s–%s for demo patients.\n", count($rows), $startYmd, $endYmd);
        }
    }

    /**
     * @param list<int> $demoPids
     */
    private function purgeAgentForgeIntakeEncounters(array $demoPids): void
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT encounter, pid FROM form_encounter
             WHERE pid IN (" . $this->placeholders($demoPids) . ")
             AND reason LIKE ?",
            array_merge($demoPids, [self::INTAKE_REASON_PREFIX . '%'])
        );

        foreach ($rows as $row) {
            $this->deleteEncounterCascade((int)$row['encounter'], (int)$row['pid']);
        }

        if ($rows !== []) {
            printf("Removed %d prior AgentForge intake encounter(s).\n", count($rows));
        }
    }

    private function deleteEncounterCascade(int $encounterNum, int $pid): void
    {
        QueryUtils::sqlStatementThrowException(
            "DELETE FROM form_clinical_notes WHERE pid = ? AND encounter = ?",
            [$pid, (string)$encounterNum]
        );

        $formRows = QueryUtils::fetchRecords(
            "SELECT id, formdir, form_id FROM forms WHERE pid = ? AND encounter = ? AND deleted = 0",
            [$pid, $encounterNum]
        );

        foreach ($formRows as $fr) {
            $formdir = (string)$fr['formdir'];
            $formId = (int)$fr['form_id'];
            if ($formdir === 'vitals' && $formId > 0) {
                QueryUtils::sqlStatementThrowException("DELETE FROM form_vitals WHERE id = ?", [$formId]);
            }

            QueryUtils::sqlStatementThrowException("DELETE FROM forms WHERE id = ?", [(int)$fr['id']]);
        }

        QueryUtils::sqlStatementThrowException(
            "DELETE FROM form_encounter WHERE pid = ? AND encounter = ?",
            [$pid, $encounterNum]
        );
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function loadAgentForgeAppointments(): array
    {
        $datePlaceholders = $this->placeholders(self::DEMO_WEEKDAY_DATES);
        $bind = array_merge(
            [self::APPOINTMENT_MARKER . '%'],
            self::DEMO_WEEKDAY_DATES
        );

        return QueryUtils::fetchRecords(
            "SELECT pc_eid, pc_pid, pc_eventDate, pc_startTime, pc_title, pc_catid, pc_aid, pc_facility
             FROM openemr_postcalendar_events
             WHERE pc_hometext LIKE ?
             AND pc_eventDate IN (" . $datePlaceholders . ')
             ORDER BY pc_eventDate, pc_startTime, pc_eid',
            $bind
        );
    }

    /**
     * @param array<string, mixed> $appt
     * @param list<int> $demoPids
     */
    private function seedIntakeForAppointment(array $appt, array $demoPids): void
    {
        $pid = (int)$appt['pc_pid'];
        if (!in_array($pid, $demoPids, true)) {
            return;
        }

        $puuid = $this->patientUuidString($pid);
        if ($puuid === '') {
            throw new RuntimeException('Missing patient UUID for pid ' . $pid);
        }

        $providerId = (int)$appt['pc_aid'];
        $username = $this->loadUsernameForUserId($providerId);
        $eventDate = (string)$appt['pc_eventDate'];
        $startTime = trim((string)$appt['pc_startTime']);
        if (strlen($startTime) === 5) {
            $startTime .= ':00';
        }

        $dateTime = $eventDate . ' ' . $startTime;
        $chief = trim((string)$appt['pc_title']);
        $reason = self::INTAKE_REASON_PREFIX . $chief;

        $encounterResult = $this->encounterService->insertEncounter($puuid, [
            'date' => $dateTime,
            'reason' => $reason,
            'facility' => $this->facility['name'],
            'facility_id' => (int)$appt['pc_facility'] > 0 ? (int)$appt['pc_facility'] : $this->facility['id'],
            'billing_facility' => (int)$appt['pc_facility'] > 0 ? (int)$appt['pc_facility'] : $this->facility['id'],
            'pc_catid' => (int)($appt['pc_catid'] ?? 5),
            'provider_id' => $providerId,
            'supervisor_id' => 0,
            'referring_provider_id' => 0,
            'ordering_provider_id' => $providerId,
            'user' => $username,
            'group' => self::DEFAULT_GROUP,
            'class_code' => 'AMB',
            'encounter_type_code' => 'AMB',
            'encounter_type_description' => 'Ambulatory visit',
        ]);

        $this->assertProcessingResult($encounterResult, 'encounter for pid ' . $pid . ' on ' . $eventDate);
        $encRow = $encounterResult->getFirstDataResult();
        $eid = (int)($encRow['encounter'] ?? 0);
        if ($eid <= 0) {
            throw new RuntimeException('Encounter insert returned invalid eid for pid ' . $pid);
        }

        $vitalsPayload = $this->buildIntakeVitals($pid, $eventDate);
        $vitalsPayload['pid'] = $pid;
        $vitalsPayload['eid'] = $eid;
        $vitalsPayload['authorized'] = 1;
        $vitalsPayload['date'] = $eventDate . ' ' . $this->intakeVitalsTime($startTime);
        $vitalsPayload['user'] = $username;
        $vitalsPayload['activity'] = 1;
        $this->vitalsService->save($vitalsPayload);

        $this->createMaIntakeNote($pid, $eid, $username, $eventDate, $chief);
        $this->ensureSocialHistoryDemoSlice($pid);
    }

    private function intakeVitalsTime(string $hhmmss): string
    {
        try {
            $dt = new DateTimeImmutable('2000-01-01 ' . $hhmmss);
            return $dt->modify('-12 minutes')->format('H:i:s');
        } catch (\Throwable) {
            return '08:45:00';
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function buildIntakeVitals(int $pid, string $eventDate): array
    {
        $baseLine = QueryUtils::fetchRecords(
            "SELECT bps, bpd, pulse, weight, height, temperature, BMI, respiration, oxygen_saturation
             FROM form_vitals WHERE pid = ? ORDER BY `date` DESC, id DESC LIMIT 1",
            [$pid]
        );

        if ($baseLine !== []) {
            $row = $baseLine[0];
            $hRaw = (float)$row['height'];
            $wRaw = (float)$row['weight'];
            $base = [
                'bps' => max(1, (int)$row['bps']),
                'bpd' => max(1, (int)$row['bpd']),
                'pulse' => (float)$row['pulse'],
                'weight' => $wRaw > 0 ? $wRaw : 90.0,
                'height' => $hRaw > 0 ? $hRaw : 67.0,
                'temperature' => (float)$row['temperature'] > 0 ? (float)$row['temperature'] : 98.2,
                'respiration' => (float)($row['respiration'] ?? 16) > 0 ? (float)$row['respiration'] : 16,
                'oxygen_saturation' => (float)($row['oxygen_saturation'] ?? 98) > 0 ? (float)$row['oxygen_saturation'] : 98,
            ];
        } else {
            $base = [
                'bps' => 118,
                'bpd' => 76,
                'pulse' => 72.0,
                'weight' => 175.0,
                'height' => 69.0,
                'temperature' => 98.2,
                'respiration' => 16.0,
                'oxygen_saturation' => 98.0,
            ];
        }

        $h = crc32((string)$pid . '|' . $eventDate);
        $base['bps'] = max(88, min(160, $base['bps'] + (($h >> 3) % 7) - 3));
        $base['bpd'] = max(52, min(100, $base['bpd'] + (($h >> 7) % 5) - 2));
        $base['pulse'] = max(48.0, min(120.0, $base['pulse'] + (($h >> 11) % 9) - 4));
        $base['temperature'] = round(max(96.5, min(100.2, $base['temperature'] + (($h >> 15) % 5) * 0.1 - 0.2)), 1);
        $base['weight'] = round(max(80.0, $base['weight'] + (($h >> 19) % 5) * 0.2 - 0.4), 1);

        $heightInches = max(1.0, $base['height']);
        $bmi = ($base['weight'] / ($heightInches * $heightInches)) * 703;

        return [
            'bps' => $base['bps'],
            'bpd' => $base['bpd'],
            'pulse' => $base['pulse'],
            'respiration' => $base['respiration'],
            'weight' => $base['weight'],
            'height' => $base['height'],
            'BMI' => round($bmi, 1),
            'temperature' => $base['temperature'],
            'oxygen_saturation' => $base['oxygen_saturation'],
        ];
    }

    private function createMaIntakeNote(int $pid, int $encounterId, string $username, string $eventDate, string $chief): void
    {
        $noteBody = "MA intake (demo seed): Vitals obtained pre-provider. "
            . "Medication list reviewed with patient; agrees with active med list in chart. "
            . "Tobacco/alcohol screen updated. PHQ-2 screen negative today; patient denies suicidal ideation.\n"
            . "Reason for visit (schedule): " . $chief;

        $formId = $this->clinicalNotesService->createClinicalNotesParentForm($pid, $encounterId, 1);
        $this->clinicalNotesService->saveArray([
            'form_id' => $formId,
            'date' => $eventDate,
            'pid' => $pid,
            'encounter' => $encounterId,
            'user' => $username,
            'groupname' => self::DEFAULT_GROUP,
            'authorized' => 1,
            'activity' => 1,
            'code' => 'LOINC:51848-0',
            'codetext' => 'Nursing note',
            'description' => $noteBody,
            'clinical_notes_type' => 'nursing_note',
            'clinical_notes_category' => null,
            'note_related_to' => $chief,
        ]);
    }

    private function ensureSocialHistoryDemoSlice(int $pid): void
    {
        $h = crc32((string)$pid);
        $tobaccoOptions = [
            'Never smoker',
            'Former smoker; quit >5y',
            'Former smoker; quit 1-5y',
            'Current some days',
        ];
        $alcoholOptions = [
            'Occasional (1-2 drinks/wk)',
            'None',
            'Occasional social',
            '1 drink/night with dinner',
        ];
        $tobacco = $tobaccoOptions[$h % count($tobaccoOptions)];
        $alcohol = $alcoholOptions[($h >> 5) % count($alcoholOptions)];
        $counseling = (($h >> 9) % 4 === 0)
            ? 'PHQ-2 today: positive screen; patient to complete full PHQ-9 with provider.'
            : 'PHQ-2 today: negative.';

        $latestId = QueryUtils::fetchSingleValue(
            "SELECT id FROM history_data WHERE pid = ? ORDER BY id DESC LIMIT 1",
            'id',
            [$pid]
        );

        if (!empty($latestId)) {
            QueryUtils::sqlStatementThrowException(
                "UPDATE history_data SET tobacco = ?, alcohol = ?, counseling = ? WHERE id = ?",
                [$tobacco, $alcohol, $counseling, (int)$latestId]
            );

            return;
        }

        QueryUtils::sqlInsert(
            "INSERT INTO history_data
                (uuid, date, pid, coffee, tobacco, alcohol, sleep_patterns, exercise_patterns, seatbelt_use,
                 counseling, recreational_drugs, additional_history, history_mother, history_father,
                 relatives_diabetes, relatives_high_blood_pressure, relatives_heart_problems, created_by)
             VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (new UuidRegistry(['table_name' => 'history_data']))->createUuid(),
                $pid,
                '',
                $tobacco,
                $alcohol,
                '',
                'Variable with work schedule',
                'Always',
                $counseling,
                'Denies',
                '',
                '',
                '',
                '',
                '',
                '',
                $this->systemUserId,
            ]
        );
    }

    private function patientUuidString(int $pid): string
    {
        $row = QueryUtils::fetchRecords(
            'SELECT uuid FROM patient_data WHERE pid = ? LIMIT 1',
            [$pid]
        );
        if ($row === [] || !array_key_exists('uuid', $row[0]) || $row[0]['uuid'] === null || $row[0]['uuid'] === '') {
            return '';
        }

        $raw = $row[0]['uuid'];
        if (is_string($raw) && str_contains($raw, '-')) {
            return $raw;
        }

        return UuidRegistry::uuidToString($raw);
    }

    private function loadUsernameForUserId(int $userId): string
    {
        $row = QueryUtils::fetchRecords(
            "SELECT username FROM users WHERE id = ? AND active = 1 LIMIT 1",
            [$userId]
        );
        if ($row !== [] && !empty($row[0]['username'])) {
            return (string)$row[0]['username'];
        }

        return 'oe-system';
    }

    /**
     * @return array{id:int, name:string}
     */
    private function loadFacility(): array
    {
        $row = QueryUtils::fetchRecords(
            "SELECT id, name FROM facility ORDER BY primary_business_entity DESC, service_location DESC, id LIMIT 1"
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

    private function seedSession(): void
    {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $session->set('authUserID', $this->systemUserId);
        $session->set('authUser', 'oe-system');
        $session->set('userauthorized', 1);
        $session->set('groupname', self::DEFAULT_GROUP);
        $session->set('site_id', $_GET['site'] ?? 'default');
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
}

try {
    (new AgentForgeVisitIntakeSeeder($fileRoot))->run();
} catch (Throwable $throwable) {
    fwrite(STDERR, "AgentForge visit intake seed failed: " . $throwable->getMessage() . "\n");
    fwrite(STDERR, $throwable->getTraceAsString() . "\n");
    exit(1);
}
