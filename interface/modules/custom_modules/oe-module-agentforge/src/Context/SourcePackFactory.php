<?php

/**
 * PRD §4.5.1 source_pack payloads for Context Service rows.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Context;

final class SourcePackFactory
{
    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function identity(\DateTimeImmutable $asOf, int $pid, string $patientUuid): array
    {
        return [
            'resource_family' => 'identity',
            'table' => 'patient_data',
            'row_id' => $pid,
            'uuid' => $patientUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'PatientService::getOne',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'demographics'],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function allergy(int $listRowId, string $allergyUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'allergy',
            'table' => 'lists',
            'row_id' => $listRowId,
            'uuid' => $allergyUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'AllergyIntoleranceService::getAll',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'allergies'],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function encounter(int $encounterId, string $encounterUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'encounter',
            'table' => 'form_encounter',
            'row_id' => $encounterId,
            'uuid' => $encounterUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'EncounterService::search',
            'navigation_hint' => [
                'kind' => 'encounter',
                'params' => ['encounter_id' => $encounterId],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function problem(int $listsRowId, string $listUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'problem',
            'table' => 'lists',
            'row_id' => $listsRowId,
            'uuid' => $listUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'PatientIssuesService::getActiveIssues',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'medical_problem'],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function medication(string $sourceTable, int $rowId, string $rowUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'medication',
            'table' => $sourceTable,
            'row_id' => $rowId,
            'uuid' => $rowUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'PrescriptionService::getAll',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'medications'],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function vital(int $vitalsFormRowId, string $vitalsUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'vital',
            'table' => 'form_vitals',
            'row_id' => $vitalsFormRowId,
            'uuid' => $vitalsUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'VitalsService::search',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'vitals'],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function lab(int $procedureResultId, string $labUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'lab',
            'table' => 'procedure_result',
            'row_id' => $procedureResultId,
            'uuid' => $labUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'ObservationLabService::getAll',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'labs'],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function note(int $documentId, string $documentUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'note',
            'table' => 'documents',
            'row_id' => $documentId,
            'uuid' => $documentUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'DocumentService::search',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'documents'],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function clinicalNote(int $noteRowId, string $noteUuid, int $encounterId, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'clinical_note',
            'table' => 'form_clinical_notes',
            'row_id' => $noteRowId,
            'uuid' => $noteUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'ClinicalNotesService::getActiveClinicalNotesForPatient',
            'navigation_hint' => [
                'kind' => 'encounter',
                'params' => ['encounter_id' => $encounterId],
            ],
        ];
    }

    /**
     * @return array{
     *   resource_family: string,
     *   table: string,
     *   row_id: int,
     *   uuid: string,
     *   as_of: string,
     *   retrieval_path: string,
     *   navigation_hint: array{kind: string, params: array<string, mixed>}
     * }
     */
    public static function socialHistory(int $historyDataId, string $historyUuid, \DateTimeImmutable $asOf): array
    {
        return [
            'resource_family' => 'social_history',
            'table' => 'history_data',
            'row_id' => $historyDataId,
            'uuid' => $historyUuid,
            'as_of' => $asOf->format(\DateTimeInterface::ATOM),
            'retrieval_path' => 'SocialHistoryService::search',
            'navigation_hint' => [
                'kind' => 'chart_section',
                'params' => ['section' => 'social_history'],
            ],
        ];
    }
}
