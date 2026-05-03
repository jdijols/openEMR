<?php

/**
 * Narrow port for clinical-note edit operations (update + soft-delete) — keeps the write
 * action testable in isolation from raw SQL.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface ClinicalNoteEditPort
{
    /**
     * Returns true when an active clinical note row with the given UUID exists for this patient and
     * is bound to the supplied encounter. Encounter binding prevents cross-encounter edits.
     */
    public function activeNoteBelongsToEncounter(int $pid, string $noteUuid, int $numericEncounterId): bool;

    /**
     * Soft-delete a clinical note (activity = 0). Returns true when the row was changed.
     */
    public function softDelete(int $pid, string $noteUuid): bool;

    /**
     * Replace a clinical note's description, recording the editing user. Returns true when a row
     * was updated.
     */
    public function replaceDescription(
        int $pid,
        string $noteUuid,
        string $newDescription,
        string $username,
        string $groupname
    ): bool;
}
