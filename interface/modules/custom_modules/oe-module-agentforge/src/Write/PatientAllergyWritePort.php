<?php

/**
 * Gate 4 — Allergy write via {@see AllergyIntoleranceService}.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface PatientAllergyWritePort
{
    /** @param array<string, mixed> $fields Pass-through rows for {@see AllergyIntoleranceService::insert()}. */
    public function insertAllergy(string $patientUuidCanonical, array $fields): ConfirmedWriteOutcome;

    /**
     * @param array<string, mixed> $patch Non-empty validated patch (e.g. comments, severity_al).
     */
    public function updateAllergy(string $patientUuidCanonical, string $allergyUuidCanonical, array $patch): ConfirmedWriteOutcome;

    /**
     * G2-Early-22 — soft-delete an allergy `lists` row by setting `activity = 0`. The pid
     * scope is enforced before the update so cross-patient deletes are rejected.
     */
    public function softDeleteAllergyByUuid(int $patientPid, string $allergyUuidString): ConfirmedWriteOutcome;
}
