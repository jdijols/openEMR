<?php

/**
 * G2-Early-24 — soft-delete port for FHIR DocumentReference + cascade Observations.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

interface DocumentDeletePort
{
    /**
     * Soft-delete a `DocumentReference` and cascade soft-delete to every linked Observation.
     * Idempotent: re-deleting an already-deleted DocRef is a no-op accept.
     *
     * Returns true on success (including the idempotent no-op case). Returns false if the
     * DocRef does not exist OR the patient binding mismatches (cross-patient delete is
     * rejected without leaking the existence of the other patient's row).
     *
     * @return array{ok: bool, observations_deleted: int}
     */
    public function softDeleteDocRefAndCascadeObservations(
        string $docrefUuid,
        string $expectedPatientUuidCanonical,
    ): array;
}
