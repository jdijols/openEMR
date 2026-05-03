<?php

/**
 * Production adapter — delegates clinical-note writes to ClinicalNotesService (no raw SQL here).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Services\ClinicalNotesService;

final class OpenEmrClinicalNoteAdapter implements ClinicalNoteWritePort
{
    public function __construct(
        private readonly ClinicalNotesService $clinicalNotesService,
    ) {
    }

    public function encounterExists(int $pid, int $numericEncounterId): bool
    {
        if ($pid <= 0 || $numericEncounterId <= 0) {
            return false;
        }

        $row = QueryUtils::fetchSingleValue(
            'SELECT encounter FROM `form_encounter` WHERE encounter = ? AND pid = ? LIMIT 1',
            'encounter',
            [$numericEncounterId, $pid]
        );

        return $row !== null && $row !== false && $row !== '';
    }

    /** @inheritDoc */
    public function appendPhysicianNoteForEncounter(
        int $pid,
        int $numericEncounterId,
        string $username,
        string $groupname,
        string $text
    ): array {
        return $this->clinicalNotesService->appendPhysicianNoteForEncounter(
            $pid,
            $numericEncounterId,
            $username,
            $groupname !== '' ? $groupname : 'Default',
            $text,
            1
        );
    }
}
