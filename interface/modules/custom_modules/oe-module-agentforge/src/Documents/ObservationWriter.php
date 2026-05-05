<?php

/**
 * W2 G2-MVP-25 — ObservationWriter service.
 *
 * Idempotent upsert for FHIR Observations derived from VLM-extracted document
 * facts. Idempotency key is `(patient_uuid_canonical, docref_uuid,
 * extraction_field_path)`; same key + same payload yields a single row whose
 * values get refreshed on re-extraction (sets `derivedFrom` to the source
 * DocumentReference for round-trip traceability per §10).
 *
 * Writes audit row `action='extraction_verified'` with PHI-safe payload
 * (S10, S11) — only the docref UUID, field path, and outcome flag.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class ObservationWriter
{
    public const AUDIT_ACTION = 'extraction_verified';

    public function __construct(
        private readonly ObservationWritePort $port,
        private readonly DocumentAuditSink $audit,
    ) {
    }

    /**
     * Upsert an Observation row. Returns true if a row was newly inserted,
     * false if an existing row was updated in place.
     *
     * @param array<string, mixed> $payload Extracted clinical fact (raw payload
     *   never enters the audit trail).
     */
    public function upsert(
        string $authUser,
        string $authProvider,
        int $patientId,
        string $patientUuidCanonical,
        string $docrefUuid,
        string $extractionFieldPath,
        string $correlationId,
        array $payload,
    ): bool {
        $exists = $this->port->existsForKey($patientUuidCanonical, $docrefUuid, $extractionFieldPath);

        if ($exists) {
            $this->port->update($patientUuidCanonical, $docrefUuid, $extractionFieldPath, $payload);
        } else {
            $this->port->insert($patientUuidCanonical, $docrefUuid, $extractionFieldPath, $payload);
        }

        $this->audit->recordDocUpload(
            $authUser,
            $authProvider,
            $patientId > 0 ? $patientId : null,
            $correlationId,
            true,
            [
                'action' => self::AUDIT_ACTION,
                'docref_uuid' => $docrefUuid,
                'field_path' => $extractionFieldPath,
                'inserted' => !$exists,
            ],
        );

        return !$exists;
    }
}
