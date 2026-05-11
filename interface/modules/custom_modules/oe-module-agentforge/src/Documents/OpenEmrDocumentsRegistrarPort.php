<?php

/**
 * Persistence port for registering an AgentForge upload as a row in the
 * canonical OpenEMR `documents` table — so the file appears in the patient's
 * Documents tab alongside everything else, gets the same encryption-at-rest
 * + ACL story, and surfaces through FHIR DocumentReference.
 *
 * `register()` is best-effort by contract: implementations return null on
 * any failure rather than throwing. The agentforge_w2/ sidecar is the
 * canonical source the agent reads from; the OpenEMR row is a parallel
 * projection for the legacy chart UI + provenance. A failure here must
 * not break extraction.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

interface OpenEmrDocumentsRegistrarPort
{
    /**
     * Persist the upload to OpenEMR's `documents` table + filesystem store
     * under the Clinical Copilot category. Returns the new row's `id`, or
     * null when the registration could not be completed (already logged by
     * the implementation).
     */
    public function register(
        int $patientPid,
        string $filename,
        string $mimeType,
        string $fileBytes,
    ): ?int;

    /**
     * True if a `documents.id` row exists with `foreign_id = $patientPid`.
     * Used by the idempotency-hit path on document upload to verify that a
     * sidecar's previously-stored `oe_document_id` still resolves to a real
     * row — necessary because operator-driven workflows (full-DB re-clone
     * from local for demo data refresh) can wipe `documents` rows while the
     * `agentforge_w2/` sidecar JSONs survive on the filesystem volume,
     * leaving the sidecar's `oe_document_id` annotation stale. When this
     * returns false, the upload action re-registers to mint a fresh id.
     *
     * Patient-scoped to prevent cross-patient ID confusion in the unlikely
     * case of a documents row having been re-numbered on a foreign patient.
     */
    public function documentExistsForPatient(int $oeDocumentId, int $patientPid): bool;
}
