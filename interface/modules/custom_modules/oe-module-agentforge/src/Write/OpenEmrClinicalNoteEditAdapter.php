<?php

/**
 * Production adapter — delegates clinical-note edits to ClinicalNotesService (no raw SQL here).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Services\ClinicalNotesService;

final class OpenEmrClinicalNoteEditAdapter implements ClinicalNoteEditPort
{
    public function __construct(
        private readonly ClinicalNotesService $clinicalNotesService,
    ) {
    }

    public function activeNoteBelongsToEncounter(int $pid, string $noteUuid, int $numericEncounterId): bool
    {
        $note = $this->clinicalNotesService->findActiveNoteByUuid($pid, $noteUuid);
        if ($note === null) {
            return false;
        }

        $encId = isset($note['encounter']) && \is_numeric($note['encounter']) ? (int) $note['encounter'] : 0;

        return $encId === $numericEncounterId;
    }

    public function softDelete(int $pid, string $noteUuid): bool
    {
        return $this->clinicalNotesService->softDeleteNoteByUuid($pid, $noteUuid);
    }

    public function replaceDescription(
        int $pid,
        string $noteUuid,
        string $newDescription,
        string $username,
        string $groupname
    ): bool {
        return $this->clinicalNotesService->replaceNoteDescriptionByUuid(
            $pid,
            $noteUuid,
            $newDescription,
            $username,
            $groupname !== '' ? $groupname : 'Default'
        );
    }
}
