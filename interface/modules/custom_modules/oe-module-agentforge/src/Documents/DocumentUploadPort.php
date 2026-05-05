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
}
