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
        // G2-Early-27 — `ClinicalNotesService::createClinicalNotesParentForm()` calls the
        // global `addForm()` from `library/forms.inc.php`. The module HTTP entry's
        // `agentforge_require_globals()` does not pull this in by default, so the first
        // clinical-note write on a fresh new-patient encounter (where no `forms` row exists
        // yet) used to die with "Call to undefined function addForm()" — caught by
        // `\Throwable` in the Action layer and surfaced as a generic "write failed". The
        // require is the same shape used in AppointmentEncounterBinder for the same reason.
        $srcdir = $GLOBALS['srcdir'] ?? null;
        if (\is_string($srcdir) && \is_readable($srcdir . '/forms.inc.php')) {
            require_once $srcdir . '/forms.inc.php';
        }
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
