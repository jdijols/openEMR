<?php

/**
 * W2 G2-MVP-25 — persistence port for FHIR Observations derived from
 * extracted document facts. Idempotency key:
 * `(patient_uuid_canonical, docref_uuid, extraction_field_path)`.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

interface ObservationWritePort
{
    /**
     * Returns true if a row already exists for this idempotency key.
     */
    public function existsForKey(
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
    ): bool;

    /**
     * Insert a fresh Observation row keyed by
     * `(patient_uuid_canonical, docref_uuid, extraction_field_path)`.
     *
     * @param array<string, mixed> $payload
     */
    public function insert(
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
        array $payload,
    ): void;

    /**
     * Update the existing row for this idempotency key. Used by the upsert
     * path so re-extracting a document refreshes the values rather than
     * duplicating rows.
     *
     * @param array<string, mixed> $payload
     */
    public function update(
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
        array $payload,
    ): void;
}
