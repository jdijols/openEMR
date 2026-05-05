<?php

/**
 * W2 G2-MVP-20 — DocumentUploadAction: orchestrates the W2 file ingestion.
 *
 * Validates the bound active-chart UUID, computes idempotency on
 * `(patient_uuid, sha256)`, mints a FHIR DocumentReference UUID, persists the
 * source bytes, and writes a PHI-safe audit row (`action='doc_upload'`).
 *
 * Cross-patient binding (S1, S15) is enforced by ChartContextGate at the HTTP
 * entry; this Action additionally rejects any payload whose binding context
 * does not match the canonical bound UUID, so isolated tests can exercise the
 * boundary without an HTTP loop.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class DocumentUploadAction
{
    public const AUDIT_ACTION = 'doc_upload';

    public function __construct(
        private readonly DocumentUploadPort $port,
        private readonly DocumentAuditSink $audit,
    ) {
    }

    /**
     * Execute the upload. Returns a DocumentUploadResult on success (with
     * `wasReUpload=true` if S13 idempotency hit the existing row).
     *
     * @throws CrossPatientBindingException if claimed != canonical (S1, S15).
     */
    public function execute(
        string $authUser,
        string $authProvider,
        int $patientId,
        string $patientUuidCanonical,
        string $patientUuidClaimed,
        string $correlationId,
        DocumentUploadPayload $payload,
    ): DocumentUploadResult {
        if ($patientUuidClaimed !== $patientUuidCanonical) {
            $this->audit->recordDocUpload(
                $authUser,
                $authProvider,
                $patientId > 0 ? $patientId : null,
                $correlationId,
                false,
                ['reason' => 'active_chart_mismatch', 'doc_type' => $payload->docType],
            );
            throw new CrossPatientBindingException();
        }

        $existing = $this->port->findExistingDocRef($patientUuidCanonical, $payload->sha256);
        if ($existing !== null) {
            $this->audit->recordDocUpload(
                $authUser,
                $authProvider,
                $patientId > 0 ? $patientId : null,
                $correlationId,
                true,
                $payload->toAuditPayload($existing, true),
            );
            return DocumentUploadResult::existing($existing);
        }

        $docrefUuid = $this->port->mintAndPersistDocument($patientUuidCanonical, $payload);
        $this->audit->recordDocUpload(
            $authUser,
            $authProvider,
            $patientId > 0 ? $patientId : null,
            $correlationId,
            true,
            $payload->toAuditPayload($docrefUuid, false),
        );

        return DocumentUploadResult::created($docrefUuid);
    }
}
