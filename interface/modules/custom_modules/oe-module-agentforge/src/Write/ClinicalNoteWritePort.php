<?php

/**
 * Narrow port for ClinicalNotesService-backed physician note writes — keeps the write action
 * testable in isolation from raw SQL.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface ClinicalNoteWritePort
{
    /**
     * Returns true when an encounter row with the given numeric ids exists for this patient.
     */
    public function encounterExists(int $pid, int $numericEncounterId): bool;

    /**
     * Append physician-dictated text to the canonical progress-note row for this encounter, creating
     * the parent Clinical Notes Form and the row itself when missing.
     *
     * @return array{created_row: bool, created_form: bool, note_id: int, form_id: int}
     */
    public function appendPhysicianNoteForEncounter(
        int $pid,
        int $numericEncounterId,
        string $username,
        string $groupname,
        string $text
    ): array;
}
