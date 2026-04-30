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
}
