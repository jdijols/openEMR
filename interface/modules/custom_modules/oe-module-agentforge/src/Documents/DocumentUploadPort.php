<?php

/**
 * W2 G2-MVP-20 — persistence port for document uploads (DocumentReference + bytes row).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

interface DocumentUploadPort
{
    /**
     * Idempotency lookup. Returns the existing FHIR DocumentReference UUID if
     * `(patient_uuid, sha256)` already produced a row, else null. Backs S13.
     */
    public function findExistingDocRef(string $patientUuidCanonical, string $sha256): ?string;

    /**
     * Persist the source document bytes plus mint a fresh FHIR DocumentReference
     * row. Returns the minted DocRef UUID. Caller treats existence of a return
     * value as success; failures throw (let bubble to HTTP 500).
     */
    public function mintAndPersistDocument(
        string $patientUuidCanonical,
        DocumentUploadPayload $payload,
    ): string;

    /**
     * Annotate the previously-persisted DocRef sidecar with the OpenEMR
     * `documents.id` produced by the parallel registrar projection. Lets the
     * reclassify hook (and any later provenance lookup) translate a
     * docref_uuid back to an OpenEMR document_id without an extra index.
     *
     * Best-effort: a missing or unreadable sidecar is a no-op.
     */
    public function recordOpenEmrMapping(string $docrefUuid, int $oeDocumentId): void;

    /**
     * Look up the OpenEMR `documents.id` previously stamped on the sidecar by
     * {@see self::recordOpenEmrMapping()}. Returns null when the sidecar is
     * missing the mapping (registration failed, deleted DocRef, unknown
     * UUID). Used by the reclassify hook.
     */
    public function findOpenEmrDocumentId(string $docrefUuid): ?int;
}
