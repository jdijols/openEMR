<?php

/**
 * AgentForge synthetic cohort seed.
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
use OpenEMR\Services\PatientService;
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

final class AgentForgeCohortSeeder
{
    private const PUBPID_PREFIX = 'AF-COHORT-';
    private const COHORT_MARKER_NAME = 'AgentForge Cohort ID';
    private const DEFAULT_GROUP = 'Default';
    private const EASY_DEV_BASE_URL = 'http://localhost:8300';

    private PatientService $patientService;
    private EncounterService $encounterService;
    private VitalsService $vitalsService;
    private ClinicalNotesService $clinicalNotesService;

    /** @var array<string, array{id:int, username:string, display:string}> */
    private array $providers;

    /** @var array{id:int, name:string} */
    private array $facility;

    private int $systemUserId;

    /**
     * @param list<array<string, mixed>> $cohort
     */
    public function __construct(private readonly array $cohort, private readonly string $fileRoot)
    {
        $this->patientService = new PatientService();
        $this->encounterService = new EncounterService();
        $this->vitalsService = new VitalsService();
        $this->clinicalNotesService = new ClinicalNotesService();
        $this->providers = $this->loadProviders();
        $this->facility = $this->loadFacility();
        $this->systemUserId = $this->loadSystemUserId();
        $this->seedSession();
    }

    public function run(): void
    {
        $this->assertDemoBaseline();
        $this->normalizeStockDemoPatients();
        $this->clearExistingCohort();

        $manifest = [];
        foreach ($this->cohort as $patientSpec) {
            $manifest[] = $this->seedPatient($patientSpec);
        }

        $this->writeRoster($manifest);
        $this->printRoster($manifest);
        $this->printSanityQueries();
    }

    private function assertDemoBaseline(): void
    {
        if (count($this->providers) < 3) {
            throw new RuntimeException('Need at least three active authorized users/providers before seeding AgentForge cohort.');
        }

        if ($this->facility['id'] <= 0) {
            throw new RuntimeException('No facility row found. Run dev-reset-install-demodata before seeding.');
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
             ORDER BY CASE username
                WHEN 'physician' THEN 1
                WHEN 'clinician' THEN 2
                WHEN 'admin' THEN 3
                ELSE 4
             END, id
             LIMIT 3"
        );

        $providers = [];
        $keys = ['A', 'B', 'C'];
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

    private function seedSession(): void
    {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $session->set('authUserID', $this->systemUserId);
        $session->set('authUser', 'oe-system');
        $session->set('userauthorized', 1);
        $session->set('groupname', self::DEFAULT_GROUP);
        $session->set('site_id', $_GET['site'] ?? 'default');
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

    private function clearExistingCohort(): void
    {
        $patients = QueryUtils::fetchRecords(
            "SELECT pid
             FROM patient_data
             WHERE pubpid LIKE ?
                OR (genericname1 = ? AND genericval1 LIKE ?)",
            [
                self::PUBPID_PREFIX . '%',
                self::COHORT_MARKER_NAME,
                self::PUBPID_PREFIX . '%',
            ]
        );

        $pids = array_map(static fn(array $row): int => (int)$row['pid'], $patients);
        if ($pids === []) {
            return;
        }

        $procedureOrderIds = QueryUtils::fetchTableColumn(
            $this->inSql("SELECT procedure_order_id FROM procedure_order WHERE patient_id IN (%s)", $pids),
            'procedure_order_id',
            $pids
        );

        if ($procedureOrderIds !== []) {
            $procedureReportIds = QueryUtils::fetchTableColumn(
                $this->inSql("SELECT procedure_report_id FROM procedure_report WHERE procedure_order_id IN (%s)", $procedureOrderIds),
                'procedure_report_id',
                $procedureOrderIds
            );
            if ($procedureReportIds !== []) {
                QueryUtils::sqlStatementThrowException(
                    $this->inSql("DELETE FROM procedure_result WHERE procedure_report_id IN (%s)", $procedureReportIds),
                    $procedureReportIds
                );
            }
            QueryUtils::sqlStatementThrowException(
                $this->inSql("DELETE FROM procedure_report WHERE procedure_order_id IN (%s)", $procedureOrderIds),
                $procedureOrderIds
            );
            QueryUtils::sqlStatementThrowException(
                $this->inSql("DELETE FROM procedure_order_code WHERE procedure_order_id IN (%s)", $procedureOrderIds),
                $procedureOrderIds
            );
            QueryUtils::sqlStatementThrowException(
                $this->inSql("DELETE FROM procedure_order WHERE procedure_order_id IN (%s)", $procedureOrderIds),
                $procedureOrderIds
            );
        }

        foreach ([
            'form_clinical_notes' => 'pid',
            'form_vitals' => 'pid',
            'forms' => 'pid',
            'form_encounter' => 'pid',
            'lists_medication' => null,
            'lists' => 'pid',
            'prescriptions' => 'patient_id',
            'immunizations' => 'patient_id',
            'history_data' => 'pid',
        ] as $table => $column) {
            if ($table === 'lists_medication') {
                QueryUtils::sqlStatementThrowException(
                    "DELETE lm FROM lists_medication lm
                     JOIN lists l ON l.id = lm.list_id
                     WHERE l.pid IN (" . $this->placeholders($pids) . ")",
                    $pids
                );
                continue;
            }

            QueryUtils::sqlStatementThrowException(
                $this->inSql("DELETE FROM {$table} WHERE {$column} IN (%s)", $pids),
                $pids
            );
        }

        QueryUtils::sqlStatementThrowException(
            $this->inSql("DELETE FROM patient_data WHERE pid IN (%s)", $pids),
            $pids
        );
    }

    /**
     * @param array<string, mixed> $patientSpec
     * @return array<string, mixed>
     */
    private function seedPatient(array $patientSpec): array
    {
        $primaryProvider = $this->providers[$patientSpec['primary_provider']];
        $patient = $this->createPatient($patientSpec, $primaryProvider);

        $this->insertHistory($patient['pid'], $patientSpec['history']);
        foreach ($patientSpec['allergies'] ?? [] as $allergy) {
            $this->insertListItem($patient['pid'], 'allergy', $allergy, null);
        }

        $encounterRows = [];
        foreach ($patientSpec['visits'] as $visit) {
            $provider = $this->providers[$visit['provider'] ?? $patientSpec['primary_provider']];
            $encounter = $this->createEncounter($patient, $visit, $provider);
            $encounterRows[] = $encounter;

            $this->createVitals($patient['pid'], $encounter['encounter'], $visit['vitals'], $visit['date']);
            $this->createClinicalNote($patient['pid'], $encounter['encounter'], $provider, $visit);

            foreach ($visit['problems'] ?? [] as $problem) {
                $this->insertListItem($patient['pid'], 'medical_problem', $problem, $visit['date']);
            }
            foreach ($visit['medications'] ?? [] as $medication) {
                $listId = $this->insertListItem($patient['pid'], 'medication', $medication, $visit['date']);
                $this->insertMedicationDetails($listId, $medication);
                $this->insertPrescription($patient['pid'], $encounter['encounter'], $provider, $medication, $visit['date']);
            }
            foreach ($visit['labs'] ?? [] as $lab) {
                $this->insertLab($patient['pid'], $encounter['encounter'], $provider, $lab, $visit['date']);
            }
            foreach ($visit['immunizations'] ?? [] as $immunization) {
                $this->insertImmunization($patient['pid'], $encounter['encounter'], $provider, $immunization, $visit['date']);
            }
        }

        return [
            'pubpid' => $this->externalIdFor($patientSpec),
            'cohort_id' => $patientSpec['pubpid'],
            'pid' => $patient['pid'],
            'name' => $patientSpec['fname'] . ' ' . $patientSpec['lname'],
            'dob' => $patientSpec['DOB'],
            'age' => $this->age((string)$patientSpec['DOB']),
            'primary_provider' => $primaryProvider['display'],
            'encounters' => count($encounterRows),
            'first_date' => $patientSpec['visits'][0]['date'],
            'last_date' => $patientSpec['visits'][array_key_last($patientSpec['visits'])]['date'],
            'theme' => $patientSpec['theme'],
        ];
    }

    /**
     * @param array<string, mixed> $patientSpec
     * @param array{id:int, username:string, display:string} $provider
     * @return array{pid:int, uuid:string}
     */
    private function createPatient(array $patientSpec, array $provider): array
    {
        $cohortNumber = $this->cohortNumber($patientSpec);
        $result = $this->patientService->insert([
            'pubpid' => $this->externalIdFor($patientSpec),
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
            'phone_home' => $patientSpec['phone_home'] ?? sprintf('(619) 555-%04d', 1000 + $cohortNumber),
            'phone_cell' => $patientSpec['phone_cell'] ?? '',
            'ss' => $patientSpec['ss'] ?? sprintf('900-45-%04d', 1000 + $cohortNumber),
            'email' => $patientSpec['email'] ?? strtolower($patientSpec['fname'] . '.' . $patientSpec['lname']) . '@example.invalid',
            'providerID' => $provider['id'],
            'genericname1' => self::COHORT_MARKER_NAME,
            'genericval1' => $patientSpec['pubpid'],
            'financial_review' => date('Y-m-d 00:00:00'),
            'hipaa_mail' => 'YES',
            'hipaa_voice' => 'YES',
            'hipaa_notice' => 'YES',
            'hipaa_message' => 'YES',
        ]);

        $this->assertProcessingResult($result, 'patient ' . $patientSpec['pubpid']);
        $record = $result->getFirstDataResult();

        return [
            'pid' => (int)$record['pid'],
            'uuid' => (string)$record['uuid'],
        ];
    }

    /**
     * @param array{pid:int, uuid:string} $patient
     * @param array<string, mixed> $visit
     * @param array{id:int, username:string, display:string} $provider
     * @return array<string, mixed>
     */
    private function createEncounter(array $patient, array $visit, array $provider): array
    {
        $dateTime = $visit['date'] . ' ' . ($visit['time'] ?? '09:00:00');
        $result = $this->encounterService->insertEncounter($patient['uuid'], [
            'date' => $dateTime,
            'reason' => $visit['reason'],
            'facility' => $this->facility['name'],
            'facility_id' => $this->facility['id'],
            'billing_facility' => $this->facility['id'],
            'pc_catid' => $visit['pc_catid'] ?? 5,
            'provider_id' => $provider['id'],
            'supervisor_id' => 0,
            'referring_provider_id' => 0,
            'ordering_provider_id' => $provider['id'],
            'user' => $provider['username'],
            'group' => self::DEFAULT_GROUP,
            'class_code' => 'AMB',
            'encounter_type_code' => $visit['type_code'] ?? 'AMB',
            'encounter_type_description' => $visit['type'] ?? 'Ambulatory visit',
        ]);

        $this->assertProcessingResult($result, 'encounter for pid ' . $patient['pid'] . ' on ' . $visit['date']);
        return $result->getFirstDataResult();
    }

    /**
     * @param array<string, mixed> $vitals
     */
    private function createVitals(int $pid, int $encounter, array $vitals, string $date): void
    {
        $payload = array_merge([
            'pid' => $pid,
            'eid' => $encounter,
            'authorized' => 1,
            'date' => $date . ' 09:15:00',
            'user' => 'oe-system',
            'activity' => 1,
        ], $vitals);

        $this->vitalsService->save($payload);
    }

    /**
     * @param array{id:int, username:string, display:string} $provider
     * @param array<string, mixed> $visit
     */
    private function createClinicalNote(int $pid, int $encounter, array $provider, array $visit): void
    {
        $formId = $this->clinicalNotesService->createClinicalNotesParentForm($pid, $encounter, 1);
        $this->clinicalNotesService->saveArray([
            'form_id' => $formId,
            'date' => $visit['date'],
            'pid' => $pid,
            'encounter' => $encounter,
            'user' => $provider['username'],
            'groupname' => self::DEFAULT_GROUP,
            'authorized' => 1,
            'activity' => 1,
            'code' => 'LOINC:11506-3',
            'codetext' => 'Progress note',
            'description' => str_replace('\n', "\n", (string)$visit['note']),
            'clinical_notes_type' => 'progress_note',
            'clinical_notes_category' => null,
            'note_related_to' => $visit['reason'],
        ]);
    }

    /**
     * @param array<string, mixed> $item
     */
    private function insertListItem(int $pid, string $type, array $item, ?string $date): int
    {
        $begdate = $item['begdate'] ?? $date;
        $enddate = $item['enddate'] ?? null;
        return QueryUtils::sqlInsert(
            "INSERT INTO lists
                (uuid, date, type, title, begdate, enddate, diagnosis, activity, comments, pid, user, groupname, reaction, severity_al)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $this->uuid('lists'),
                ($begdate ?? date('Y-m-d')) . ' 00:00:00',
                $type,
                $item['title'],
                $begdate ? $begdate . ' 00:00:00' : null,
                $enddate ? $enddate . ' 00:00:00' : null,
                $item['diagnosis'] ?? '',
                (int)($item['active'] ?? 1),
                $item['comments'] ?? '',
                $pid,
                'oe-system',
                self::DEFAULT_GROUP,
                $item['reaction'] ?? '',
                $item['severity'] ?? null,
            ]
        );
    }

    /**
     * @param array<string, mixed> $medication
     */
    private function insertMedicationDetails(int $listId, array $medication): void
    {
        QueryUtils::sqlInsert(
            "INSERT INTO lists_medication
                (list_id, drug_dosage_instructions, usage_category, usage_category_title, request_intent, request_intent_title)
             VALUES (?, ?, ?, ?, ?, ?)",
            [
                $listId,
                $medication['instructions'] ?? $medication['comments'] ?? '',
                'community',
                'Community',
                'order',
                'Order',
            ]
        );
    }

    /**
     * @param array{id:int, username:string, display:string} $provider
     * @param array<string, mixed> $medication
     */
    private function insertPrescription(int $pid, int $encounter, array $provider, array $medication, string $date): void
    {
        QueryUtils::sqlInsert(
            "INSERT INTO prescriptions
                (uuid, patient_id, date_added, date_modified, provider_id, encounter, start_date, drug, dosage, quantity,
                 refills, note, active, datetime, user, end_date, indication, drug_dosage_instructions, diagnosis,
                 created_by, updated_by, txDate, usage_category_title, request_intent_title)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $this->uuid('prescriptions'),
                $pid,
                $date . ' 09:30:00',
                $date . ' 09:30:00',
                $provider['id'],
                $encounter,
                $medication['begdate'] ?? $date,
                $medication['title'],
                $medication['dosage'] ?? '',
                $medication['quantity'] ?? '30',
                $medication['refills'] ?? 2,
                $medication['comments'] ?? '',
                (int)($medication['active'] ?? 1),
                $date . ' 09:30:00',
                $provider['username'],
                $medication['enddate'] ?? null,
                $medication['indication'] ?? $medication['diagnosis'] ?? '',
                $medication['instructions'] ?? $medication['comments'] ?? '',
                $medication['diagnosis'] ?? '',
                $this->systemUserId,
                $this->systemUserId,
                $date,
                'Community',
                'Order',
            ]
        );
    }

    /**
     * @param array<string, mixed> $lab
     * @param array{id:int, username:string, display:string} $provider
     */
    private function insertLab(int $pid, int $encounter, array $provider, array $lab, string $date): void
    {
        $orderId = QueryUtils::sqlInsert(
            "INSERT INTO procedure_order
                (uuid, provider_id, patient_id, encounter_id, date_collected, date_ordered, order_status,
                 activity, clinical_hx, order_diagnosis, procedure_order_type, order_intent)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'laboratory_test', 'order')",
            [
                $this->uuid('procedure_order'),
                $provider['id'],
                $pid,
                $encounter,
                $date . ' 10:00:00',
                $date . ' 09:45:00',
                'complete',
                $lab['clinical_hx'] ?? '',
                $lab['diagnosis'] ?? '',
            ]
        );

        QueryUtils::sqlInsert(
            "INSERT INTO procedure_order_code
                (procedure_order_id, procedure_order_seq, procedure_code, procedure_name, diagnoses, procedure_order_title, procedure_type)
             VALUES (?, 1, ?, ?, ?, ?, 'laboratory_test')",
            [
                $orderId,
                $lab['code'],
                $lab['name'],
                $lab['diagnosis'] ?? '',
                $lab['name'],
            ]
        );

        $reportId = QueryUtils::sqlInsert(
            "INSERT INTO procedure_report
                (uuid, procedure_order_id, procedure_order_seq, date_collected, date_report, source, report_status, review_status, report_notes)
             VALUES (?, ?, 1, ?, ?, ?, 'complete', 'reviewed', ?)",
            [
                $this->uuid('procedure_report'),
                $orderId,
                $date . ' 10:00:00',
                $date . ' 16:00:00',
                $provider['id'],
                $lab['notes'] ?? 'Synthetic lab result for AgentForge demo.',
            ]
        );

        QueryUtils::sqlInsert(
            "INSERT INTO procedure_result
                (uuid, procedure_report_id, result_data_type, result_code, result_text, date, facility, units, result, `range`, abnormal, comments, result_status)
             VALUES (?, ?, 'N', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'final')",
            [
                $this->uuid('procedure_result'),
                $reportId,
                $lab['code'],
                $lab['name'],
                $date . ' 16:00:00',
                $this->facility['name'],
                $lab['units'],
                (string)$lab['value'],
                $lab['range'] ?? '',
                $lab['abnormal'] ?? 'no',
                $lab['comments'] ?? '',
            ]
        );
    }

    /**
     * @param array<string, mixed> $immunization
     * @param array{id:int, username:string, display:string} $provider
     */
    private function insertImmunization(int $pid, int $encounter, array $provider, array $immunization, string $date): void
    {
        QueryUtils::sqlInsert(
            "INSERT INTO immunizations
                (uuid, patient_id, administered_date, cvx_code, administered_by_id, administered_by, note, create_date,
                 update_date, created_by, updated_by, amount_administered, amount_administered_unit, completion_status,
                 information_source, ordering_provider, encounter_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, 0.5, 'mL', 'completed', 'administered', ?, ?)",
            [
                $this->uuid('immunizations'),
                $pid,
                $date . ' 11:00:00',
                $immunization['cvx'],
                $provider['id'],
                $provider['display'],
                $immunization['name'],
                $date . ' 11:00:00',
                $this->systemUserId,
                $this->systemUserId,
                $provider['id'],
                $encounter,
            ]
        );
    }

    /**
     * @param array<string, mixed> $history
     */
    private function insertHistory(int $pid, array $history): void
    {
        QueryUtils::sqlInsert(
            "INSERT INTO history_data
                (uuid, date, pid, coffee, tobacco, alcohol, sleep_patterns, exercise_patterns, seatbelt_use,
                 counseling, recreational_drugs, additional_history, history_mother, history_father,
                 relatives_diabetes, relatives_high_blood_pressure, relatives_heart_problems, created_by)
             VALUES (?, NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                $this->uuid('history_data'),
                $pid,
                $history['coffee'] ?? '',
                $history['tobacco'] ?? '',
                $history['alcohol'] ?? '',
                $history['sleep_patterns'] ?? '',
                $history['exercise_patterns'] ?? '',
                $history['seatbelt_use'] ?? 'Always',
                $history['counseling'] ?? '',
                $history['recreational_drugs'] ?? '',
                $history['additional_history'] ?? '',
                $history['history_mother'] ?? '',
                $history['history_father'] ?? '',
                $history['relatives_diabetes'] ?? '',
                $history['relatives_high_blood_pressure'] ?? '',
                $history['relatives_heart_problems'] ?? '',
                $this->systemUserId,
            ]
        );
    }

    /**
     * @param list<array<string, mixed>> $manifest
     */
    private function writeRoster(array $manifest): void
    {
        $path = $this->fileRoot . '/Documentation/AgentForge/cohort/roster.md';
        $dir = dirname($path);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException('Unable to create roster directory: ' . $dir);
        }

        $lines = [
            '# AgentForge Synthetic Cohort Roster',
            '',
            'Generated by `contrib/util/agentforge/seed_cohort.php` on ' . date('Y-m-d H:i:s T') . '.',
            '',
            'All patients in this roster are fabricated synthetic records for demo and evaluation use only.',
            '',
            '| pubpid | pid | name | DOB | age | primary provider | encounters | date range | theme | chart |',
            '| --- | ---: | --- | --- | ---: | --- | ---: | --- | --- | --- |',
        ];

        foreach ($manifest as $row) {
            $chartUrl = self::EASY_DEV_BASE_URL . '/interface/patient_file/summary/demographics.php?set_pid=' . $row['pid'];
            $lines[] = sprintf(
                '| %s | %d | %s | %s | %d | %s | %d | %s to %s | %s | [open](%s) |',
                $row['pubpid'],
                $row['pid'],
                $row['name'],
                $row['dob'],
                $row['age'],
                $row['primary_provider'],
                $row['encounters'],
                $row['first_date'],
                $row['last_date'],
                str_replace('|', '/', $row['theme']),
                $chartUrl
            );
        }

        $lines[] = '';
        $lines[] = '## Verification';
        $lines[] = '';
        $lines[] = '- Finder: `' . self::EASY_DEV_BASE_URL . '/interface/main/finder/dynamic_finder.php` then search by name or External ID `0004` through `0013`.';
        $lines[] = '- Patient chart URL pattern: `' . self::EASY_DEV_BASE_URL . '/interface/patient_file/summary/demographics.php?set_pid={pid}`.';
        $lines[] = '- Encounter list URL pattern: `' . self::EASY_DEV_BASE_URL . '/interface/patient_file/history/encounters.php?set_pid={pid}`.';
        $lines[] = '';
        $lines[] = '## Sanity Queries';
        $lines[] = '';
        $lines[] = '```sql';
        $lines[] = "SELECT COUNT(*) AS patients FROM patient_data WHERE genericname1 = 'AgentForge Cohort ID' AND genericval1 LIKE 'AF-COHORT-%';";
        $lines[] = "SELECT pubpid, COUNT(e.encounter) AS visits, MIN(e.date), MAX(e.date)";
        $lines[] = '  FROM patient_data p LEFT JOIN form_encounter e USING (pid)';
        $lines[] = "  WHERE genericname1 = 'AgentForge Cohort ID' AND genericval1 LIKE 'AF-COHORT-%' GROUP BY pubpid ORDER BY CAST(pubpid AS UNSIGNED);";
        $lines[] = "SELECT type, COUNT(*) FROM lists l JOIN patient_data p USING (pid)";
        $lines[] = "  WHERE p.genericname1 = 'AgentForge Cohort ID' AND p.genericval1 LIKE 'AF-COHORT-%' GROUP BY type;";
        $lines[] = '```';
        $lines[] = '';
        $lines[] = '## Snapshot';
        $lines[] = '';
        $lines[] = 'After click-through verification:';
        $lines[] = '';
        $lines[] = '```bash';
        $lines[] = 'docker compose exec openemr /root/devtools backup agentforge-cohort-v1';
        $lines[] = '```';

        file_put_contents($path, implode("\n", $lines) . "\n");
    }

    /**
     * @param list<array<string, mixed>> $manifest
     */
    private function printRoster(array $manifest): void
    {
        echo "\nAgentForge synthetic cohort seeded successfully.\n\n";
        printf("%-15s %-6s %-22s %-12s %-5s %-18s %-10s %s\n", 'pubpid', 'pid', 'name', 'DOB', 'age', 'primary', 'visits', 'range');
        foreach ($manifest as $row) {
            printf(
                "%-15s %-6d %-22s %-12s %-5d %-18s %-10d %s to %s\n",
                $row['pubpid'],
                $row['pid'],
                $row['name'],
                $row['dob'],
                $row['age'],
                $row['primary_provider'],
                $row['encounters'],
                $row['first_date'],
                $row['last_date']
            );
        }
        echo "\nRoster written to Documentation/AgentForge/cohort/roster.md\n";
    }

    private function printSanityQueries(): void
    {
        echo "\nSanity queries:\n";
        echo "SELECT COUNT(*) AS patients FROM patient_data WHERE genericname1 = 'AgentForge Cohort ID' AND genericval1 LIKE 'AF-COHORT-%';\n";
        echo "SELECT pubpid, COUNT(e.encounter) AS visits, MIN(e.date), MAX(e.date) FROM patient_data p LEFT JOIN form_encounter e USING (pid) WHERE genericname1 = 'AgentForge Cohort ID' AND genericval1 LIKE 'AF-COHORT-%' GROUP BY pubpid ORDER BY CAST(pubpid AS UNSIGNED);\n";
        echo "SELECT type, COUNT(*) FROM lists l JOIN patient_data p USING (pid) WHERE p.genericname1 = 'AgentForge Cohort ID' AND p.genericval1 LIKE 'AF-COHORT-%' GROUP BY type;\n";
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

    private function uuid(string $table): string
    {
        return (new UuidRegistry(['table_name' => $table]))->createUuid();
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

    private function age(string $dob): int
    {
        return (int)(new DateTimeImmutable($dob))->diff(new DateTimeImmutable('today'))->y;
    }

    /**
     * @param array<string, mixed> $patientSpec
     */
    private function cohortNumber(array $patientSpec): int
    {
        return (int)str_replace(self::PUBPID_PREFIX, '', (string)$patientSpec['pubpid']);
    }

    /**
     * @param array<string, mixed> $patientSpec
     */
    private function externalIdFor(array $patientSpec): string
    {
        return sprintf('%04d', $this->cohortNumber($patientSpec) + 3);
    }
}

/**
 * @return array<string, mixed>
 */
function af_vitals(int $bps, int $bpd, int $pulse, float $weight, float $height, ?float $temperature = null): array
{
    $heightInches = $height;
    $bmi = ($weight / ($heightInches * $heightInches)) * 703;
    return [
        'bps' => $bps,
        'bpd' => $bpd,
        'pulse' => $pulse,
        'respiration' => 16,
        'weight' => round($weight, 1),
        'height' => round($height, 1),
        'BMI' => round($bmi, 1),
        'temperature' => $temperature ?? 98.4,
        'oxygen_saturation' => 98,
    ];
}

/**
 * @return array<string, mixed>
 */
function af_problem(string $title, string $diagnosis, string $comments, ?string $begdate = null): array
{
    return [
        'title' => $title,
        'diagnosis' => $diagnosis,
        'comments' => $comments,
        'begdate' => $begdate,
    ];
}

/**
 * @return array<string, mixed>
 */
function af_med(string $title, string $dosage, string $instructions, string $diagnosis, ?string $begdate = null, ?string $enddate = null, int $active = 1): array
{
    return [
        'title' => $title,
        'dosage' => $dosage,
        'instructions' => $instructions,
        'diagnosis' => $diagnosis,
        'comments' => $instructions,
        'begdate' => $begdate,
        'enddate' => $enddate,
        'active' => $active,
    ];
}

/**
 * @return array<string, mixed>
 */
function af_lab(string $code, string $name, string $value, string $units, string $range, string $abnormal = 'no', string $diagnosis = ''): array
{
    return [
        'code' => $code,
        'name' => $name,
        'value' => $value,
        'units' => $units,
        'range' => $range,
        'abnormal' => $abnormal,
        'diagnosis' => $diagnosis,
    ];
}

/**
 * @return array<string, mixed>
 */
function af_imm(string $cvx, string $name): array
{
    return [
        'cvx' => $cvx,
        'name' => $name,
    ];
}

/**
 * @param list<array<string, mixed>> $extraVisits
 * @return list<array<string, mixed>>
 */
function af_visits(array $extraVisits): array
{
    return $extraVisits;
}

$cohort = [
    [
        'pubpid' => 'AF-COHORT-001',
        'fname' => 'Olivia',
        'lname' => 'Tran',
        'DOB' => '2017-04-18',
        'sex' => 'Female',
        'street' => '4108 Juniper Street',
        'phone_cell' => '(619) 555-0101',
        'status' => 'child',
        'primary_provider' => 'A',
        'theme' => 'Pediatric continuity: annual well-child visits, vaccines, mild persistent asthma beginning at age five.',
        'history' => [
            'tobacco' => 'No household tobacco exposure.',
            'alcohol' => 'None.',
            'sleep_patterns' => 'Sleeps 9-10 hours on school nights.',
            'exercise_patterns' => 'Active in playground and weekend soccer.',
            'additional_history' => 'Born at term without complications. Parent reports seasonal cough in spring.',
            'history_mother' => 'Mother with allergic rhinitis.',
            'history_father' => 'Father well.',
        ],
        'allergies' => [
            ['title' => 'Amoxicillin', 'reaction' => 'rash', 'severity' => 'mild', 'comments' => 'Maculopapular rash at age 4.'],
        ],
        'visits' => af_visits([
            [
                'date' => '2018-05-08',
                'reason' => '12 month well-child visit',
                'type' => 'Well-child visit',
                'provider' => 'A',
                'vitals' => af_vitals(88, 54, 118, 22.8, 30.2),
                'note' => 'Subjective: Parent reports Olivia is cruising, using several words, eating table foods, and sleeping through most nights. No wheeze or chronic cough.\n\nObjective: Growth is tracking along expected percentiles. Exam is normal. Assessment/Plan: Healthy 12 month child. Anticipatory guidance reviewed, immunizations updated, follow up at 18 months.',
                'immunizations' => [af_imm('03', 'MMR'), af_imm('21', 'Varicella'), af_imm('83', 'Hepatitis A pediatric')],
            ],
            [
                'date' => '2019-10-15',
                'reason' => '2 year well-child visit',
                'type' => 'Well-child visit',
                'provider' => 'A',
                'vitals' => af_vitals(90, 56, 108, 28.4, 34.5),
                'note' => 'Subjective: Parent reports normal speech development and good activity. Mild eczema flares in winter.\n\nObjective: Growth steady, skin shows mild flexural eczema. Assessment/Plan: Well child with mild eczema. Skin care plan reviewed. Influenza vaccine given.',
                'problems' => [af_problem('Atopic dermatitis', 'ICD10:L20.9', 'Mild intermittent winter flares.', '2019-10-15')],
                'immunizations' => [af_imm('150', 'Influenza, injectable, quadrivalent')],
            ],
            [
                'date' => '2020-09-22',
                'reason' => '3 year well-child visit',
                'type' => 'Well-child visit',
                'provider' => 'A',
                'vitals' => af_vitals(92, 58, 102, 33.1, 37.1),
                'note' => 'Subjective: No developmental concerns. Parent notes cough after running outside during pollen season.\n\nObjective: Lungs clear today. Assessment/Plan: Well child. Monitor exertional cough and trial allergy avoidance. No controller medication started.',
            ],
            [
                'date' => '2021-09-28',
                'reason' => '4 year well-child visit',
                'type' => 'Well-child visit',
                'provider' => 'A',
                'vitals' => af_vitals(94, 60, 98, 38.6, 40.2),
                'note' => 'Subjective: Parent reports several spring cough episodes but no emergency visits. Good school readiness.\n\nObjective: Normal exam. Assessment/Plan: Well child. Vaccines updated. Discussed return if cough becomes nocturnal or recurrent.',
                'immunizations' => [af_imm('20', 'DTaP'), af_imm('10', 'IPV')],
            ],
            [
                'date' => '2022-11-03',
                'reason' => 'Cough and wheeze with soccer',
                'type' => 'Problem-focused visit',
                'provider' => 'A',
                'vitals' => af_vitals(96, 60, 104, 43.2, 43.5, 98.8),
                'note' => 'Subjective: Parent reports three months of cough after running and two nights per month waking with cough. No fever.\n\nObjective: Mild end-expiratory wheeze. Assessment/Plan: Mild persistent asthma suspected. Started low-dose inhaled corticosteroid and rescue albuterol. Asthma action plan reviewed.',
                'problems' => [af_problem('Mild persistent asthma', 'ICD10:J45.30', 'Exercise and seasonal symptoms, no hospitalizations.', '2022-11-03')],
                'medications' => [
                    af_med('Fluticasone HFA 44 mcg inhaler', '2 puffs', 'Inhale 2 puffs twice daily with spacer.', 'ICD10:J45.30', '2022-11-03'),
                    af_med('Albuterol HFA 90 mcg inhaler', '2 puffs', 'Inhale 2 puffs every 4 hours as needed for wheeze.', 'ICD10:J45.30', '2022-11-03'),
                ],
            ],
            [
                'date' => '2023-10-17',
                'reason' => 'Asthma follow-up and flu vaccine',
                'type' => 'Follow-up visit',
                'provider' => 'A',
                'vitals' => af_vitals(98, 62, 92, 49.5, 46.8),
                'note' => 'Subjective: Parent reports fewer nighttime symptoms and albuterol use about once weekly during soccer. No missed school.\n\nObjective: Lungs clear. Assessment/Plan: Asthma controlled. Continue fluticasone through spring, rescue inhaler as needed. Influenza vaccine given.',
                'immunizations' => [af_imm('150', 'Influenza, injectable, quadrivalent')],
            ],
            [
                'date' => '2024-10-21',
                'reason' => '7 year well-child visit',
                'type' => 'Well-child visit',
                'provider' => 'A',
                'vitals' => af_vitals(100, 64, 88, 55.2, 49.1),
                'note' => 'Subjective: Doing well in school. Uses albuterol before soccer, no nighttime cough.\n\nObjective: Growth and exam normal. Assessment/Plan: Well child with controlled asthma. Continue current asthma action plan and annual flu vaccination.',
                'immunizations' => [af_imm('150', 'Influenza, injectable, quadrivalent')],
            ],
            [
                'date' => '2026-02-10',
                'reason' => 'Asthma medication check',
                'type' => 'Follow-up visit',
                'provider' => 'A',
                'vitals' => af_vitals(100, 62, 86, 61.4, 51.6),
                'note' => 'Subjective: Parent asks whether controller can be reduced. No symptoms for four months except one viral cold.\n\nObjective: Lungs clear, oxygen saturation normal. Assessment/Plan: Asthma well controlled. Continue low-dose controller through pollen season, reassess in summer.',
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-002',
        'fname' => 'Marcus',
        'lname' => 'Hill',
        'DOB' => '2010-08-07',
        'sex' => 'Male',
        'street' => '7752 Mesa Ridge Drive',
        'phone_cell' => '(619) 555-0102',
        'primary_provider' => 'A',
        'theme' => 'Adolescent sports physicals with ADHD diagnosis and medication titration.',
        'history' => [
            'coffee' => 'Occasional caffeinated soda.',
            'tobacco' => 'Never.',
            'alcohol' => 'None.',
            'sleep_patterns' => 'Variable sleep, worse during school stress.',
            'exercise_patterns' => 'Basketball and track.',
            'additional_history' => 'Parent reports long-standing school inattention.',
            'history_mother' => 'Mother with anxiety.',
        ],
        'allergies' => [],
        'visits' => af_visits([
            [
                'date' => '2021-08-18',
                'reason' => 'Sports physical',
                'type' => 'Preventive visit',
                'provider' => 'A',
                'vitals' => af_vitals(108, 66, 78, 96.0, 58.5),
                'note' => 'Subjective: Presents for sports clearance. No syncope, chest pain, or exertional dyspnea. Parent mentions distractibility at school but wants to monitor.\n\nObjective: Normal cardiac and musculoskeletal exam. Assessment/Plan: Cleared for sports. Vanderbilt forms offered if school concerns persist.',
            ],
            [
                'date' => '2022-11-09',
                'reason' => 'School inattention',
                'type' => 'Problem-focused visit',
                'provider' => 'A',
                'vitals' => af_vitals(110, 68, 82, 105.4, 61.1),
                'note' => 'Subjective: Teacher reports missing assignments and distractibility across classes. Parent Vanderbilt aligns with inattentive symptoms.\n\nObjective: Mood appropriate, no safety concerns. Assessment/Plan: ADHD inattentive type. Started methylphenidate ER low dose and scheduled close follow-up.',
                'problems' => [af_problem('Attention deficit hyperactivity disorder, predominantly inattentive type', 'ICD10:F90.0', 'Diagnosed by parent and teacher Vanderbilt forms.', '2022-11-09')],
                'medications' => [af_med('Methylphenidate ER 18 mg tablet', '18 mg', 'Take one tablet each school morning.', 'ICD10:F90.0', '2022-11-09', '2023-01-20', 0)],
            ],
            [
                'date' => '2023-01-20',
                'reason' => 'ADHD medication follow-up',
                'type' => 'Follow-up visit',
                'provider' => 'A',
                'vitals' => af_vitals(112, 70, 84, 107.2, 61.8),
                'note' => 'Subjective: Grades improved but medication wears off by final class. Appetite mildly reduced at lunch.\n\nObjective: Weight stable. Assessment/Plan: Increased methylphenidate ER to 27 mg. Reviewed sleep, appetite, and secure storage.',
                'medications' => [af_med('Methylphenidate ER 27 mg tablet', '27 mg', 'Take one tablet each school morning.', 'ICD10:F90.0', '2023-01-20')],
            ],
            [
                'date' => '2024-08-12',
                'reason' => 'Sports physical and ADHD review',
                'type' => 'Preventive visit',
                'provider' => 'A',
                'vitals' => af_vitals(114, 70, 76, 123.0, 66.0),
                'note' => 'Subjective: Playing basketball. ADHD symptoms controlled during school year, takes medication holidays during summer.\n\nObjective: Normal sports exam. Assessment/Plan: Cleared for sports. Continue methylphenidate ER 27 mg on school days.',
            ],
            [
                'date' => '2026-01-14',
                'reason' => 'ADHD follow-up and sleep concern',
                'type' => 'Follow-up visit',
                'provider' => 'A',
                'vitals' => af_vitals(116, 72, 78, 139.0, 69.2),
                'note' => 'Subjective: Focus remains good. Reports delayed sleep onset when homework runs late and occasional missed breakfast.\n\nObjective: Blood pressure and weight acceptable. Assessment/Plan: Continue current dose, emphasize breakfast and sleep routine. Follow up before next school year.',
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-003',
        'fname' => 'Maya',
        'lname' => 'Rivers',
        'DOB' => '2001-03-26',
        'sex' => 'Female',
        'street' => '1180 Laurel Avenue',
        'phone_cell' => '(619) 555-0103',
        'primary_provider' => 'C',
        'theme' => 'Young adult with sporadic visits, anxiety, contraception counseling, and hypothyroidism discovered on labs.',
        'history' => [
            'coffee' => 'One coffee daily.',
            'tobacco' => 'Never.',
            'alcohol' => '1-2 drinks monthly.',
            'sleep_patterns' => 'Interrupted during anxiety flares.',
            'exercise_patterns' => 'Yoga twice weekly.',
            'additional_history' => 'College student, limited visit history in this practice.',
            'history_mother' => 'Mother with hypothyroidism.',
        ],
        'allergies' => [],
        'visits' => af_visits([
            [
                'date' => '2020-07-02',
                'reason' => 'Contraception counseling',
                'type' => 'Preventive counseling',
                'provider' => 'C',
                'vitals' => af_vitals(108, 68, 72, 132.0, 64.0),
                'note' => 'Subjective: New patient requests contraception counseling. No migraine with aura, no tobacco use.\n\nObjective: Exam deferred by patient preference. Assessment/Plan: Reviewed contraception options and started combined oral contraceptive. Return precautions discussed.',
                'medications' => [af_med('Ethinyl estradiol/norgestimate tablet', '1 tablet', 'Take one tablet daily.', 'Contraception', '2020-07-02')],
            ],
            [
                'date' => '2023-04-18',
                'reason' => 'Anxiety and fatigue',
                'type' => 'Problem-focused visit',
                'provider' => 'B',
                'vitals' => af_vitals(112, 70, 76, 138.0, 64.0),
                'note' => 'Subjective: Reports several months of worry, fatigue, and low motivation. No suicidal ideation. Family history of thyroid disease.\n\nObjective: Affect anxious but organized. Assessment/Plan: Generalized anxiety symptoms. Ordered TSH and basic labs; counseling referral made.',
                'problems' => [af_problem('Generalized anxiety disorder', 'ICD10:F41.1', 'Counseling referral placed; no safety concerns.', '2023-04-18')],
                'labs' => [af_lab('3016-3', 'Thyrotropin [Units/volume] in Serum or Plasma', '6.8', 'uIU/mL', '0.4-4.5', 'high', 'ICD10:R53.83')],
            ],
            [
                'date' => '2023-05-10',
                'reason' => 'Lab review: elevated TSH',
                'type' => 'Follow-up visit',
                'provider' => 'C',
                'vitals' => af_vitals(110, 68, 74, 139.0, 64.0),
                'note' => 'Subjective: Fatigue persists. Anxiety slightly improved after first therapy visit.\n\nObjective: TSH elevated. Assessment/Plan: Started levothyroxine 25 mcg daily and planned repeat TSH in 8 weeks.',
                'problems' => [af_problem('Hypothyroidism', 'ICD10:E03.9', 'Elevated TSH with fatigue.', '2023-05-10')],
                'medications' => [af_med('Levothyroxine 25 mcg tablet', '25 mcg', 'Take one tablet every morning before food.', 'ICD10:E03.9', '2023-05-10')],
            ],
            [
                'date' => '2026-03-04',
                'reason' => 'Annual medication review',
                'type' => 'Preventive visit',
                'provider' => 'C',
                'vitals' => af_vitals(110, 70, 72, 136.0, 64.0),
                'note' => 'Subjective: Feels stable on levothyroxine and continues therapy as needed. No palpitations, weight change, or missed pills.\n\nObjective: Normal exam. Assessment/Plan: Continue levothyroxine, repeat TSH today, renew contraception after blood pressure review.',
                'labs' => [af_lab('3016-3', 'Thyrotropin [Units/volume] in Serum or Plasma', '2.4', 'uIU/mL', '0.4-4.5', 'no', 'ICD10:E03.9')],
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-004',
        'fname' => 'Sofia',
        'lname' => 'Alvarez',
        'DOB' => '1995-11-02',
        'sex' => 'Female',
        'street' => '622 Palm Court',
        'phone_cell' => '(619) 555-0104',
        'primary_provider' => 'B',
        'theme' => 'Pregnancy and postpartum primary-care continuity with anemia and blood pressure surveillance.',
        'history' => [
            'coffee' => 'One cup coffee most mornings.',
            'tobacco' => 'Never.',
            'alcohol' => 'None during pregnancy; rare before.',
            'sleep_patterns' => 'Interrupted postpartum sleep.',
            'exercise_patterns' => 'Walking 20 minutes most days.',
            'additional_history' => 'G1P1, postpartum care shared with obstetrics.',
        ],
        'allergies' => [],
        'visits' => af_visits([
            [
                'date' => '2023-02-07',
                'reason' => 'Positive pregnancy test and nausea',
                'type' => 'Problem-focused visit',
                'provider' => 'B',
                'vitals' => af_vitals(106, 66, 82, 151.0, 63.0),
                'note' => 'Subjective: Positive home pregnancy test, nausea without dehydration. Taking prenatal vitamin.\n\nObjective: Well appearing. Assessment/Plan: Early pregnancy. Confirmed pregnancy, reviewed nausea care, prenatal warning signs, and OB referral.',
                'problems' => [af_problem('Pregnancy', 'ICD10:Z34.90', 'Primary care support during pregnancy; OB referral placed.', '2023-02-07')],
                'medications' => [af_med('Prenatal vitamin', '1 tablet', 'Take one tablet daily.', 'ICD10:Z34.90', '2023-02-07')],
            ],
            [
                'date' => '2023-05-16',
                'reason' => 'Pregnancy follow-up: fatigue',
                'type' => 'Follow-up visit',
                'provider' => 'B',
                'vitals' => af_vitals(110, 68, 88, 158.0, 63.0),
                'note' => 'Subjective: Second trimester fatigue and mild constipation. No bleeding or severe pain.\n\nObjective: Blood pressure normal. Assessment/Plan: Ordered CBC and iron studies through primary care because fatigue is limiting work.',
                'labs' => [af_lab('718-7', 'Hemoglobin [Mass/volume] in Blood', '10.8', 'g/dL', '12.0-15.5', 'low', 'ICD10:O99.019')],
                'problems' => [af_problem('Anemia complicating pregnancy', 'ICD10:O99.019', 'Mild anemia in second trimester.', '2023-05-16')],
                'medications' => [af_med('Ferrous sulfate 325 mg tablet', '325 mg', 'Take one tablet every other day with vitamin C.', 'ICD10:O99.019', '2023-05-16')],
            ],
            [
                'date' => '2023-09-12',
                'reason' => 'Third trimester blood pressure check',
                'type' => 'Follow-up visit',
                'provider' => 'C',
                'vitals' => af_vitals(124, 78, 92, 174.0, 63.0),
                'note' => 'Subjective: OB asked for additional blood pressure check after borderline home reading. No headache, vision changes, or RUQ pain.\n\nObjective: Blood pressure acceptable in clinic. Assessment/Plan: Continue home BP log and OB follow-up. Reviewed preeclampsia warning signs.',
            ],
            [
                'date' => '2023-11-21',
                'reason' => 'Postpartum mood and blood pressure check',
                'type' => 'Postpartum follow-up',
                'provider' => 'B',
                'vitals' => af_vitals(118, 74, 80, 160.0, 63.0),
                'note' => 'Subjective: Six weeks postpartum. Sleep fragmented, tearful at times, bonding with baby, no self-harm thoughts.\n\nObjective: BP normal. Assessment/Plan: Postpartum adjustment symptoms. Close follow-up, support plan, and PHQ-9 tracking; no medication today.',
                'problems' => [af_problem('Postpartum adjustment symptoms', 'ICD10:O99.345', 'Tearfulness without safety concerns; monitoring closely.', '2023-11-21')],
            ],
            [
                'date' => '2024-02-20',
                'reason' => 'Postpartum mood follow-up',
                'type' => 'Follow-up visit',
                'provider' => 'B',
                'vitals' => af_vitals(112, 70, 74, 154.0, 63.0),
                'note' => 'Subjective: Mood improved with sleep schedule and family help. No panic symptoms. Breastfeeding going well.\n\nObjective: Brighter affect. Assessment/Plan: Postpartum symptoms improving. Continue counseling and routine care.',
            ],
            [
                'date' => '2025-03-18',
                'reason' => 'Annual preventive visit',
                'type' => 'Preventive visit',
                'provider' => 'B',
                'vitals' => af_vitals(110, 70, 72, 149.0, 63.0),
                'note' => 'Subjective: Feels well, regular menses returned. Requests contraception discussion.\n\nObjective: Normal exam. Assessment/Plan: Preventive visit. Reviewed contraception options and continued iron-rich diet after pregnancy anemia resolved.',
                'labs' => [af_lab('718-7', 'Hemoglobin [Mass/volume] in Blood', '12.7', 'g/dL', '12.0-15.5', 'no', 'ICD10:Z00.00')],
            ],
            [
                'date' => '2026-01-29',
                'reason' => 'Fatigue and sleep disruption',
                'type' => 'Problem-focused visit',
                'provider' => 'B',
                'vitals' => af_vitals(112, 72, 76, 151.0, 63.0),
                'note' => 'Subjective: Fatigue during busy work and parenting period. No depression relapse, heavy bleeding, or thyroid symptoms.\n\nObjective: Exam normal. Assessment/Plan: Fatigue likely sleep-related; ordered CBC and TSH to exclude anemia/thyroid recurrence.',
                'labs' => [af_lab('718-7', 'Hemoglobin [Mass/volume] in Blood', '12.4', 'g/dL', '12.0-15.5', 'no', 'ICD10:R53.83')],
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-005',
        'fname' => 'Ethan',
        'lname' => 'Brooks',
        'DOB' => '1983-06-12',
        'sex' => 'Male',
        'street' => '3358 Harbor Lane',
        'phone_cell' => '(619) 555-0105',
        'primary_provider' => 'A',
        'theme' => 'Healthy adult with annual physicals and hyperlipidemia treatment with lipid trend.',
        'history' => [
            'coffee' => 'Two coffees daily.',
            'tobacco' => 'Never.',
            'alcohol' => '2-4 drinks weekly.',
            'sleep_patterns' => 'Sleeps 7 hours nightly.',
            'exercise_patterns' => 'Runs 3 miles twice weekly.',
            'history_father' => 'Father had MI at 61.',
            'relatives_heart_problems' => 'Father myocardial infarction.',
        ],
        'allergies' => [],
        'visits' => af_visits([
            [
                'date' => '2021-03-22',
                'reason' => 'Annual physical',
                'type' => 'Preventive visit',
                'provider' => 'A',
                'vitals' => af_vitals(122, 78, 68, 186.0, 70.0),
                'note' => 'Subjective: Establishes annual care. Exercises intermittently. Family history of premature coronary disease.\n\nObjective: Exam normal. Assessment/Plan: Preventive visit; ordered lipid panel and metabolic screening.',
                'labs' => [af_lab('2089-1', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', '168', 'mg/dL', '<100', 'high', 'ICD10:Z00.00')],
            ],
            [
                'date' => '2022-03-24',
                'reason' => 'Annual physical and lipid follow-up',
                'type' => 'Preventive visit',
                'provider' => 'A',
                'vitals' => af_vitals(124, 80, 70, 188.0, 70.0),
                'note' => 'Subjective: Tried dietary changes but LDL remains high. No chest pain or dyspnea.\n\nObjective: Blood pressure borderline normal. Assessment/Plan: Hyperlipidemia with family history. Started moderate-intensity statin.',
                'problems' => [af_problem('Hyperlipidemia', 'ICD10:E78.5', 'Elevated LDL and family history of premature CAD.', '2022-03-24')],
                'medications' => [af_med('Atorvastatin 20 mg tablet', '20 mg', 'Take one tablet nightly.', 'ICD10:E78.5', '2022-03-24')],
                'labs' => [af_lab('2089-1', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', '161', 'mg/dL', '<100', 'high', 'ICD10:E78.5')],
            ],
            [
                'date' => '2023-03-27',
                'reason' => 'Annual physical',
                'type' => 'Preventive visit',
                'provider' => 'A',
                'vitals' => af_vitals(118, 76, 64, 181.0, 70.0),
                'note' => 'Subjective: Taking atorvastatin most nights. Increased running and reduced fried foods.\n\nObjective: Weight down. Assessment/Plan: Hyperlipidemia improving; continue statin and lifestyle.',
                'labs' => [af_lab('2089-1', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', '104', 'mg/dL', '<100', 'high', 'ICD10:E78.5')],
            ],
            [
                'date' => '2024-04-02',
                'reason' => 'Annual physical',
                'type' => 'Preventive visit',
                'provider' => 'A',
                'vitals' => af_vitals(116, 74, 62, 178.0, 70.0),
                'note' => 'Subjective: No statin side effects. Running regularly. No cardiopulmonary symptoms.\n\nObjective: Exam normal. Assessment/Plan: Continue atorvastatin, repeat lipid panel and liver enzymes.',
                'labs' => [af_lab('2089-1', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', '92', 'mg/dL', '<100', 'no', 'ICD10:E78.5')],
            ],
            [
                'date' => '2026-02-25',
                'reason' => 'Annual physical after missed year',
                'type' => 'Preventive visit',
                'provider' => 'A',
                'vitals' => af_vitals(120, 76, 66, 183.0, 70.0),
                'note' => 'Subjective: Missed 2025 visit due to travel. Continues statin with occasional missed doses.\n\nObjective: Exam normal. Assessment/Plan: Preventive care resumed. Refilled atorvastatin, updated lipid panel, and reviewed adherence.',
                'labs' => [af_lab('2089-1', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', '112', 'mg/dL', '<100', 'high', 'ICD10:E78.5')],
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-006',
        'fname' => 'Nadia',
        'lname' => 'Patel',
        'DOB' => '1973-09-30',
        'sex' => 'Female',
        'street' => '2910 Cactus Way',
        'phone_cell' => '(619) 555-0106',
        'primary_provider' => 'A',
        'theme' => 'Type 2 diabetes with quarterly follow-up, A1c trend, medication escalation, kidney screening, and eye referral.',
        'history' => [
            'coffee' => 'Tea daily.',
            'tobacco' => 'Never.',
            'alcohol' => 'Rare.',
            'sleep_patterns' => '6-7 hours nightly.',
            'exercise_patterns' => 'Walking after dinner three nights weekly.',
            'history_mother' => 'Mother with type 2 diabetes.',
            'relatives_diabetes' => 'Mother and maternal aunt.',
        ],
        'allergies' => [
            ['title' => 'Sulfonamide antibiotics', 'reaction' => 'hives', 'severity' => 'moderate', 'comments' => 'Reported hives in early adulthood.'],
        ],
        'visits' => af_visits([
            [
                'date' => '2022-01-18',
                'reason' => 'New diabetes diagnosis',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(132, 82, 78, 188.0, 63.5),
                'note' => 'Subjective: Fatigue and increased thirst. Labs from screening show elevated A1c.\n\nObjective: BMI elevated. Assessment/Plan: New type 2 diabetes. Started metformin, nutrition referral, and home glucose education.',
                'problems' => [af_problem('Type 2 diabetes mellitus without complication', 'ICD10:E11.9', 'Diagnosed by A1c 8.7%.', '2022-01-18')],
                'medications' => [af_med('Metformin 500 mg tablet', '500 mg', 'Take one tablet twice daily with meals.', 'ICD10:E11.9', '2022-01-18')],
                'labs' => [af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '8.7', '%', '<5.7', 'high', 'ICD10:E11.9')],
            ],
            [
                'date' => '2022-04-19',
                'reason' => 'Diabetes follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(128, 80, 76, 184.0, 63.5),
                'note' => 'Subjective: Tolerating metformin after initial GI upset. Walking more consistently.\n\nObjective: Weight down. Assessment/Plan: Diabetes improving but above goal. Continue metformin and lifestyle changes.',
                'labs' => [af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '7.9', '%', '<5.7', 'high', 'ICD10:E11.9')],
            ],
            [
                'date' => '2022-10-11',
                'reason' => 'Diabetes and kidney screening',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(130, 82, 78, 186.0, 63.5),
                'note' => 'Subjective: Diet slipped during caregiving stress. No hypoglycemia.\n\nObjective: BP mildly elevated. Assessment/Plan: A1c up. Increased metformin dose and ordered urine microalbumin.',
                'medications' => [af_med('Metformin 1000 mg tablet', '1000 mg', 'Take one tablet twice daily with meals.', 'ICD10:E11.9', '2022-10-11')],
                'labs' => [
                    af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '8.2', '%', '<5.7', 'high', 'ICD10:E11.9'),
                    af_lab('14959-1', 'Microalbumin/Creatinine [Mass Ratio] in Urine', '18', 'mg/g', '<30', 'no', 'ICD10:E11.9'),
                ],
            ],
            [
                'date' => '2023-04-18',
                'reason' => 'Diabetes medication escalation',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(126, 78, 74, 181.0, 63.5),
                'note' => 'Subjective: Adherent to metformin but A1c remains above goal. Interested in weight-beneficial option.\n\nObjective: No neuropathy symptoms. Assessment/Plan: Added semaglutide weekly and referred for diabetic eye exam.',
                'medications' => [af_med('Semaglutide 0.25 mg injection', '0.25 mg', 'Inject 0.25 mg subcutaneously once weekly.', 'ICD10:E11.9', '2023-04-18', '2023-07-18', 0)],
                'labs' => [af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '8.0', '%', '<5.7', 'high', 'ICD10:E11.9')],
            ],
            [
                'date' => '2023-07-18',
                'reason' => 'Diabetes follow-up after semaglutide start',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(122, 76, 72, 174.0, 63.5),
                'note' => 'Subjective: Mild nausea improved. Home fasting glucose mostly 120s.\n\nObjective: Weight down. Assessment/Plan: Increase semaglutide to 0.5 mg weekly, continue metformin.',
                'medications' => [af_med('Semaglutide 0.5 mg injection', '0.5 mg', 'Inject 0.5 mg subcutaneously once weekly.', 'ICD10:E11.9', '2023-07-18')],
                'labs' => [af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '7.1', '%', '<5.7', 'high', 'ICD10:E11.9')],
            ],
            [
                'date' => '2024-01-23',
                'reason' => 'Diabetes six-month follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(120, 74, 70, 166.0, 63.5),
                'note' => 'Subjective: Feels well with improved energy. Eye exam completed without retinopathy.\n\nObjective: BP controlled. Assessment/Plan: Diabetes at goal. Continue current medications and annual kidney/eye screening.',
                'labs' => [
                    af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '6.7', '%', '<5.7', 'high', 'ICD10:E11.9'),
                    af_lab('14959-1', 'Microalbumin/Creatinine [Mass Ratio] in Urine', '21', 'mg/g', '<30', 'no', 'ICD10:E11.9'),
                ],
            ],
            [
                'date' => '2025-01-28',
                'reason' => 'Annual diabetes review',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(122, 76, 72, 168.0, 63.5),
                'note' => 'Subjective: Holiday diet less consistent but medications taken regularly. No hypoglycemia.\n\nObjective: Foot exam normal. Assessment/Plan: Slight A1c increase, continue current regimen and reinforce nutrition plan.',
                'labs' => [af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '7.0', '%', '<5.7', 'high', 'ICD10:E11.9')],
            ],
            [
                'date' => '2026-02-03',
                'reason' => 'Diabetes follow-up and refills',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(118, 72, 70, 164.0, 63.5),
                'note' => 'Subjective: Good adherence. Fasting readings mostly 95-115. Requests medication refills before travel.\n\nObjective: BP and weight improved. Assessment/Plan: Diabetes controlled. Refilled metformin and semaglutide, ordered annual microalbumin.',
                'labs' => [
                    af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '6.5', '%', '<5.7', 'high', 'ICD10:E11.9'),
                    af_lab('14959-1', 'Microalbumin/Creatinine [Mass Ratio] in Urine', '14', 'mg/g', '<30', 'no', 'ICD10:E11.9'),
                ],
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-007',
        'fname' => 'Raymond',
        'lname' => 'Cooper',
        'DOB' => '1965-02-21',
        'sex' => 'Male',
        'street' => '9004 Mission Gorge Road',
        'phone_cell' => '(619) 555-0107',
        'primary_provider' => 'A',
        'theme' => 'Complex adult splitter across all three providers: hypertension, diabetes, OSA, and new CKD-3.',
        'history' => [
            'coffee' => 'Three coffees daily.',
            'tobacco' => 'Former smoker, quit 2016, 20 pack-years.',
            'alcohol' => '6 beers weekly.',
            'sleep_patterns' => 'Uses CPAP inconsistently.',
            'exercise_patterns' => 'Sedentary work; walks on weekends.',
            'history_father' => 'Father with hypertension and stroke.',
            'relatives_high_blood_pressure' => 'Father and brother.',
            'relatives_diabetes' => 'Brother.',
        ],
        'allergies' => [
            ['title' => 'Lisinopril', 'reaction' => 'cough', 'severity' => 'moderate', 'comments' => 'ACE-inhibitor cough in 2021.'],
        ],
        'visits' => af_visits([
            [
                'date' => '2020-06-10',
                'reason' => 'Elevated blood pressure',
                'type' => 'Problem-focused visit',
                'provider' => 'A',
                'vitals' => af_vitals(152, 94, 78, 238.0, 71.0),
                'note' => 'Subjective: Reports repeated high pharmacy blood pressure readings. No chest pain or neurologic symptoms.\n\nObjective: BP elevated. Assessment/Plan: New hypertension. Started lisinopril and home BP log.',
                'problems' => [af_problem('Essential hypertension', 'ICD10:I10', 'Diagnosed after repeated elevated readings.', '2020-06-10')],
                'medications' => [af_med('Lisinopril 10 mg tablet', '10 mg', 'Take one tablet daily.', 'ICD10:I10', '2020-06-10', '2021-02-17', 0)],
            ],
            [
                'date' => '2021-02-17',
                'reason' => 'Medication cough and BP follow-up',
                'type' => 'Follow-up visit',
                'provider' => 'B',
                'vitals' => af_vitals(146, 90, 76, 241.0, 71.0),
                'note' => 'Subjective: Dry cough began after lisinopril and disrupts sleep. Home BP still high.\n\nObjective: Lungs clear. Assessment/Plan: ACE-inhibitor cough. Stopped lisinopril and started losartan.',
                'medications' => [af_med('Losartan 50 mg tablet', '50 mg', 'Take one tablet daily.', 'ICD10:I10', '2021-02-17')],
            ],
            [
                'date' => '2021-10-06',
                'reason' => 'Snoring and daytime sleepiness',
                'type' => 'Problem-focused visit',
                'provider' => 'C',
                'vitals' => af_vitals(140, 86, 80, 245.0, 71.0),
                'note' => 'Subjective: Partner reports loud snoring and witnessed apneas. Daytime fatigue while driving.\n\nObjective: Neck circumference elevated. Assessment/Plan: Suspected obstructive sleep apnea. Sleep study ordered.',
                'problems' => [af_problem('Obstructive sleep apnea', 'ICD10:G47.33', 'Sleep study ordered after witnessed apneas.', '2021-10-06')],
            ],
            [
                'date' => '2022-05-25',
                'reason' => 'Diabetes screening abnormal',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(136, 84, 76, 242.0, 71.0),
                'note' => 'Subjective: Follow-up after screening labs. Reports weight gain and high-carb diet.\n\nObjective: A1c diagnostic for diabetes. Assessment/Plan: New type 2 diabetes. Started metformin and nutrition counseling.',
                'problems' => [af_problem('Type 2 diabetes mellitus without complication', 'ICD10:E11.9', 'Diagnosed by A1c 7.6%.', '2022-05-25')],
                'medications' => [af_med('Metformin 500 mg tablet', '500 mg', 'Take one tablet twice daily with meals.', 'ICD10:E11.9', '2022-05-25')],
                'labs' => [af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '7.6', '%', '<5.7', 'high', 'ICD10:E11.9')],
            ],
            [
                'date' => '2023-03-08',
                'reason' => 'Chronic care follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(132, 82, 72, 234.0, 71.0),
                'note' => 'Subjective: Better diet and CPAP use about four nights weekly. No hypoglycemia.\n\nObjective: BP improved but not at goal. Assessment/Plan: Increased losartan to 100 mg, continue metformin, recheck labs.',
                'medications' => [af_med('Losartan 100 mg tablet', '100 mg', 'Take one tablet daily.', 'ICD10:I10', '2023-03-08')],
                'labs' => [af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '7.0', '%', '<5.7', 'high', 'ICD10:E11.9')],
            ],
            [
                'date' => '2024-01-17',
                'reason' => 'Kidney function review',
                'type' => 'Chronic care visit',
                'provider' => 'C',
                'vitals' => af_vitals(130, 78, 70, 229.0, 71.0),
                'note' => 'Subjective: No edema or urinary symptoms. Taking NSAIDs for knee pain several times weekly.\n\nObjective: eGFR lower than prior. Assessment/Plan: CKD stage 3a likely from hypertension/diabetes risk. Avoid NSAIDs, optimize BP and diabetes control.',
                'problems' => [af_problem('Chronic kidney disease, stage 3a', 'ICD10:N18.31', 'eGFR persistently in stage 3a range.', '2024-01-17')],
                'labs' => [af_lab('62238-1', 'Glomerular filtration rate/1.73 sq M.predicted', '52', 'mL/min/1.73m2', '>60', 'low', 'ICD10:N18.31')],
            ],
            [
                'date' => '2025-06-04',
                'reason' => 'Chronic care after missed winter visit',
                'type' => 'Chronic care visit',
                'provider' => 'A',
                'vitals' => af_vitals(138, 84, 74, 236.0, 71.0),
                'note' => 'Subjective: Missed winter follow-up during family caregiving. CPAP use poor and home BP elevated.\n\nObjective: BP above goal. Assessment/Plan: Reinforced follow-up cadence, added amlodipine, repeat kidney labs.',
                'medications' => [af_med('Amlodipine 5 mg tablet', '5 mg', 'Take one tablet daily.', 'ICD10:I10', '2025-06-04')],
                'labs' => [
                    af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '7.4', '%', '<5.7', 'high', 'ICD10:E11.9'),
                    af_lab('62238-1', 'Glomerular filtration rate/1.73 sq M.predicted', '49', 'mL/min/1.73m2', '>60', 'low', 'ICD10:N18.31'),
                ],
            ],
            [
                'date' => '2026-02-18',
                'reason' => 'BP, diabetes, and CKD follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(126, 76, 70, 226.0, 71.0),
                'note' => 'Subjective: Improved medication adherence and CPAP use. Walking after dinner most days.\n\nObjective: BP now at goal. Assessment/Plan: Continue losartan, amlodipine, metformin. CKD stable; avoid NSAIDs and repeat labs in six months.',
                'labs' => [
                    af_lab('4548-4', 'Hemoglobin A1c/Hemoglobin.total in Blood', '6.9', '%', '<5.7', 'high', 'ICD10:E11.9'),
                    af_lab('62238-1', 'Glomerular filtration rate/1.73 sq M.predicted', '51', 'mL/min/1.73m2', '>60', 'low', 'ICD10:N18.31'),
                ],
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-008',
        'fname' => 'Elaine',
        'lname' => 'Whitaker',
        'DOB' => '1953-12-05',
        'sex' => 'Female',
        'street' => '44 Vista Terrace',
        'phone_cell' => '(619) 555-0108',
        'primary_provider' => 'C',
        'theme' => 'Geriatric continuity with polypharmacy, falls risk, and an 18-month care gap.',
        'history' => [
            'coffee' => 'One decaf coffee daily.',
            'tobacco' => 'Former smoker, quit 1994.',
            'alcohol' => 'Wine socially, less than weekly.',
            'sleep_patterns' => 'Wakes twice nightly.',
            'exercise_patterns' => 'Senior center balance class weekly.',
            'history_mother' => 'Mother with osteoporosis.',
            'relatives_heart_problems' => 'Father with CHF.',
        ],
        'allergies' => [
            ['title' => 'Codeine', 'reaction' => 'nausea', 'severity' => 'mild', 'comments' => 'Severe nausea with codeine.'],
        ],
        'visits' => af_visits([
            [
                'date' => '2020-04-14',
                'reason' => 'Medicare wellness visit',
                'type' => 'Preventive visit',
                'provider' => 'C',
                'vitals' => af_vitals(132, 76, 72, 156.0, 62.0),
                'note' => 'Subjective: Independent in ADLs. Reports occasional knee pain but no falls.\n\nObjective: Gait steady. Assessment/Plan: Wellness visit, calcium/vitamin D counseling, fall-prevention handout.',
                'problems' => [af_problem('Osteopenia', 'ICD10:M85.80', 'Prior DEXA shows osteopenia.', '2020-04-14')],
                'medications' => [af_med('Calcium carbonate/vitamin D tablet', '600 mg/400 IU', 'Take one tablet twice daily.', 'ICD10:M85.80', '2020-04-14')],
            ],
            [
                'date' => '2021-10-12',
                'reason' => 'Blood pressure and medication review',
                'type' => 'Chronic care visit',
                'provider' => 'C',
                'vitals' => af_vitals(144, 82, 74, 158.0, 62.0),
                'note' => 'Subjective: Home BP often 140s. No chest pain. Takes ibuprofen for knee pain.\n\nObjective: BP elevated. Assessment/Plan: Diagnosed hypertension, started amlodipine, advised limiting NSAID use.',
                'problems' => [af_problem('Essential hypertension', 'ICD10:I10', 'Persistently elevated home and clinic BP.', '2021-10-12')],
                'medications' => [af_med('Amlodipine 5 mg tablet', '5 mg', 'Take one tablet daily.', 'ICD10:I10', '2021-10-12')],
            ],
            [
                'date' => '2022-05-03',
                'reason' => 'Fall at home',
                'type' => 'Problem-focused visit',
                'provider' => 'C',
                'vitals' => af_vitals(136, 78, 76, 155.0, 62.0),
                'note' => 'Subjective: Tripped on rug and bruised hip. No head injury or loss of consciousness.\n\nObjective: Hip range of motion preserved, gait cautious. Assessment/Plan: Mechanical fall. Removed throw rugs, referred to balance PT, reviewed home safety.',
                'problems' => [af_problem('History of fall', 'ICD10:Z91.81', 'Mechanical fall without fracture.', '2022-05-03')],
            ],
            [
                'date' => '2023-01-10',
                'reason' => 'Medication review and dizziness',
                'type' => 'Chronic care visit',
                'provider' => 'C',
                'vitals' => af_vitals(118, 68, 70, 151.0, 62.0),
                'note' => 'Subjective: Reports lightheadedness after standing quickly. No syncope.\n\nObjective: BP lower than prior. Assessment/Plan: Possible medication-related orthostasis. Reduced amlodipine to 2.5 mg and advised hydration.',
                'medications' => [af_med('Amlodipine 2.5 mg tablet', '2.5 mg', 'Take one tablet daily.', 'ICD10:I10', '2023-01-10')],
            ],
            [
                'date' => '2024-08-20',
                'reason' => 'Return after care gap: fatigue and falls concern',
                'type' => 'Chronic care visit',
                'provider' => 'C',
                'vitals' => af_vitals(138, 78, 76, 150.0, 62.0),
                'note' => 'Subjective: Returns after 18-month gap caring for sister. One near-fall and increased fatigue.\n\nObjective: Gait slightly slowed, no focal deficits. Assessment/Plan: Recheck labs, renew PT balance referral, reconcile medications.',
                'labs' => [af_lab('718-7', 'Hemoglobin [Mass/volume] in Blood', '11.9', 'g/dL', '12.0-15.5', 'low', 'ICD10:R53.83')],
            ],
            [
                'date' => '2026-01-12',
                'reason' => 'Geriatric follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'C',
                'vitals' => af_vitals(130, 74, 72, 149.0, 62.0),
                'note' => 'Subjective: No falls since PT. Uses pill organizer. Fatigue improved.\n\nObjective: Timed up-and-go improved. Assessment/Plan: Continue amlodipine 2.5 mg, balance class, and annual wellness follow-up.',
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-009',
        'fname' => 'Harold',
        'lname' => 'Jensen',
        'DOB' => '1945-07-19',
        'sex' => 'Male',
        'street' => '1269 Seabreeze Circle',
        'phone_cell' => '(619) 555-0109',
        'primary_provider' => 'B',
        'theme' => 'Geriatric complex patient with atrial fibrillation, warfarin/INR monitoring, CKD, BPH, and cognitive screening after a snowbird gap.',
        'history' => [
            'coffee' => 'One coffee daily.',
            'tobacco' => 'Former smoker, quit 1988.',
            'alcohol' => 'One drink most evenings.',
            'sleep_patterns' => 'Nocturia two to three times nightly.',
            'exercise_patterns' => 'Walks mall twice weekly.',
            'history_father' => 'Father with stroke.',
            'relatives_stroke' => 'Father.',
        ],
        'allergies' => [
            ['title' => 'Aspirin', 'reaction' => 'GI bleeding', 'severity' => 'severe', 'comments' => 'Avoid aspirin after remote GI bleed.'],
        ],
        'visits' => af_visits([
            [
                'date' => '2019-11-05',
                'reason' => 'New atrial fibrillation follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(134, 76, 88, 184.0, 68.0),
                'note' => 'Subjective: Seen in urgent care for palpitations and diagnosed with atrial fibrillation. No chest pain now.\n\nObjective: Irregularly irregular rhythm. Assessment/Plan: Atrial fibrillation. Warfarin started with INR monitoring, cardiology referral.',
                'problems' => [af_problem('Paroxysmal atrial fibrillation', 'ICD10:I48.0', 'Diagnosed after urgent care ECG.', '2019-11-05')],
                'medications' => [af_med('Warfarin 5 mg tablet', '5 mg', 'Take one tablet nightly or as directed by INR.', 'ICD10:I48.0', '2019-11-05')],
                'labs' => [af_lab('6301-6', 'INR in Platelet poor plasma by Coagulation assay', '1.6', 'ratio', '2.0-3.0', 'low', 'ICD10:I48.0')],
            ],
            [
                'date' => '2020-01-09',
                'reason' => 'INR and anticoagulation follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(128, 74, 76, 182.0, 68.0),
                'note' => 'Subjective: No bleeding. Taking warfarin nightly. Diet includes variable greens.\n\nObjective: INR therapeutic. Assessment/Plan: Continue current warfarin dose, reviewed consistent vitamin K intake.',
                'labs' => [af_lab('6301-6', 'INR in Platelet poor plasma by Coagulation assay', '2.4', 'ratio', '2.0-3.0', 'no', 'ICD10:I48.0')],
            ],
            [
                'date' => '2021-06-15',
                'reason' => 'BPH and nocturia',
                'type' => 'Problem-focused visit',
                'provider' => 'B',
                'vitals' => af_vitals(130, 76, 74, 180.0, 68.0),
                'note' => 'Subjective: Nocturia three times nightly, weak stream, no dysuria or fever.\n\nObjective: Abdomen benign. Assessment/Plan: BPH symptoms. Started tamsulosin and reviewed orthostasis precautions.',
                'problems' => [af_problem('Benign prostatic hyperplasia with lower urinary tract symptoms', 'ICD10:N40.1', 'Nocturia and weak stream.', '2021-06-15')],
                'medications' => [af_med('Tamsulosin 0.4 mg capsule', '0.4 mg', 'Take one capsule nightly.', 'ICD10:N40.1', '2021-06-15')],
            ],
            [
                'date' => '2022-04-12',
                'reason' => 'CKD monitoring',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(132, 78, 72, 178.0, 68.0),
                'note' => 'Subjective: No urinary changes beyond stable nocturia. Avoids NSAIDs.\n\nObjective: BP acceptable. Assessment/Plan: CKD stage 3 stable, monitor renal function and medication dosing.',
                'problems' => [af_problem('Chronic kidney disease, stage 3b', 'ICD10:N18.32', 'Stable reduced eGFR.', '2022-04-12')],
                'labs' => [
                    af_lab('62238-1', 'Glomerular filtration rate/1.73 sq M.predicted', '42', 'mL/min/1.73m2', '>60', 'low', 'ICD10:N18.32'),
                    af_lab('6301-6', 'INR in Platelet poor plasma by Coagulation assay', '2.8', 'ratio', '2.0-3.0', 'no', 'ICD10:I48.0'),
                ],
            ],
            [
                'date' => '2024-08-06',
                'reason' => 'Return after two-year snowbird gap',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(136, 80, 78, 174.0, 68.0),
                'note' => 'Subjective: Spent two winters out of state and missed INR checks locally. Reports no major bleeding but occasional bruising.\n\nObjective: Irregular rhythm controlled. Assessment/Plan: Re-establish anticoagulation monitoring, repeat kidney labs, update medication list.',
                'labs' => [
                    af_lab('6301-6', 'INR in Platelet poor plasma by Coagulation assay', '3.4', 'ratio', '2.0-3.0', 'high', 'ICD10:I48.0'),
                    af_lab('62238-1', 'Glomerular filtration rate/1.73 sq M.predicted', '39', 'mL/min/1.73m2', '>60', 'low', 'ICD10:N18.32'),
                ],
            ],
            [
                'date' => '2025-01-14',
                'reason' => 'Memory screening and INR',
                'type' => 'Chronic care visit',
                'provider' => 'C',
                'vitals' => af_vitals(130, 76, 72, 171.0, 68.0),
                'note' => 'Subjective: Daughter reports missed bills and repeating questions. Patient still drives locally.\n\nObjective: Mini-cog abnormal. Assessment/Plan: Mild cognitive impairment suspected. Ordered reversible-cause labs and discussed driving safety review.',
                'problems' => [af_problem('Mild cognitive impairment', 'ICD10:G31.84', 'Abnormal mini-cog with family concern.', '2025-01-14')],
                'labs' => [af_lab('6301-6', 'INR in Platelet poor plasma by Coagulation assay', '2.6', 'ratio', '2.0-3.0', 'no', 'ICD10:I48.0')],
            ],
            [
                'date' => '2025-07-08',
                'reason' => 'Anticoagulation and CKD follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(128, 72, 70, 169.0, 68.0),
                'note' => 'Subjective: Daughter helps with pillbox. No bleeding or falls.\n\nObjective: Stable exam. Assessment/Plan: INR therapeutic, CKD stable, continue medication support with family.',
                'labs' => [
                    af_lab('6301-6', 'INR in Platelet poor plasma by Coagulation assay', '2.2', 'ratio', '2.0-3.0', 'no', 'ICD10:I48.0'),
                    af_lab('62238-1', 'Glomerular filtration rate/1.73 sq M.predicted', '40', 'mL/min/1.73m2', '>60', 'low', 'ICD10:N18.32'),
                ],
            ],
            [
                'date' => '2026-02-24',
                'reason' => 'Complex geriatric follow-up',
                'type' => 'Chronic care visit',
                'provider' => 'B',
                'vitals' => af_vitals(126, 74, 70, 168.0, 68.0),
                'note' => 'Subjective: No bleeding. Daughter attends visit and reports fewer missed meds with pillbox.\n\nObjective: Irregular rhythm rate controlled. Assessment/Plan: Continue warfarin with monthly INR, tamsulosin, and CKD monitoring. Cognitive follow-up in six months.',
                'labs' => [af_lab('6301-6', 'INR in Platelet poor plasma by Coagulation assay', '2.5', 'ratio', '2.0-3.0', 'no', 'ICD10:I48.0')],
            ],
        ]),
    ],
    [
        'pubpid' => 'AF-COHORT-010',
        'fname' => 'Grace',
        'lname' => 'Kim',
        'DOB' => '1980-01-14',
        'sex' => 'Female',
        'street' => '5083 Redwood Street',
        'phone_cell' => '(619) 555-0110',
        'primary_provider' => 'C',
        'theme' => 'New transfer with only two in-practice visits; useful for missing-history and outside-record limitations.',
        'history' => [
            'coffee' => 'One coffee daily.',
            'tobacco' => 'Never.',
            'alcohol' => '1-2 glasses wine weekly.',
            'sleep_patterns' => 'Sleeps 7 hours nightly.',
            'exercise_patterns' => 'Pilates weekly.',
            'additional_history' => 'Moved from Seattle in 2025. Outside records pending.',
            'history_mother' => 'Mother with breast cancer at 62.',
        ],
        'allergies' => [
            ['title' => 'Penicillin', 'reaction' => 'hives', 'severity' => 'moderate', 'comments' => 'Childhood urticaria.'],
        ],
        'visits' => af_visits([
            [
                'date' => '2025-09-16',
                'reason' => 'New patient transfer visit',
                'type' => 'New patient visit',
                'provider' => 'C',
                'vitals' => af_vitals(116, 72, 70, 142.0, 65.0),
                'note' => 'Subjective: New transfer from Seattle. Reports history of migraines and allergic rhinitis. Outside records requested but not yet received.\n\nObjective: Normal exam. Assessment/Plan: Established care, reconciled self-reported medication list, ordered baseline labs due to limited available records.',
                'problems' => [
                    af_problem('Migraine without aura', 'ICD10:G43.009', 'Self-reported from prior care, outside records pending.', '2025-09-16'),
                    af_problem('Allergic rhinitis', 'ICD10:J30.9', 'Seasonal symptoms controlled with intranasal steroid.', '2025-09-16'),
                ],
                'medications' => [
                    af_med('Sumatriptan 50 mg tablet', '50 mg', 'Take one tablet at migraine onset; may repeat once in 2 hours.', 'ICD10:G43.009', '2025-09-16'),
                    af_med('Fluticasone nasal spray', '1 spray', 'Use one spray in each nostril daily during allergy season.', 'ICD10:J30.9', '2025-09-16'),
                ],
                'labs' => [af_lab('2089-1', 'Cholesterol in LDL [Mass/volume] in Serum or Plasma', '118', 'mg/dL', '<100', 'high', 'ICD10:Z00.00')],
            ],
            [
                'date' => '2026-03-11',
                'reason' => 'Follow-up after transfer records request',
                'type' => 'Follow-up visit',
                'provider' => 'C',
                'vitals' => af_vitals(114, 70, 68, 141.0, 65.0),
                'note' => 'Subjective: Outside records still incomplete. Migraines occur about once monthly and respond to sumatriptan. Allergy symptoms controlled.\n\nObjective: Neurologic exam normal. Assessment/Plan: Continue current migraine plan. Chart limitation documented: no longitudinal lab or imaging records from prior practice available yet.',
            ],
        ]),
    ],
];

try {
    (new AgentForgeCohortSeeder($cohort, $fileRoot))->run();
} catch (Throwable $throwable) {
    fwrite(STDERR, "AgentForge cohort seed failed: " . $throwable->getMessage() . "\n");
    fwrite(STDERR, $throwable->getTraceAsString() . "\n");
    exit(1);
}
