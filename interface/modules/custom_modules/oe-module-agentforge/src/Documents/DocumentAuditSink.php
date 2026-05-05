<?php

/**
 * W2 G2-MVP-20 — narrow audit sink for document upload events.
 *
 * Tests inject a recording fake; production wires this to AgentAuditLogger.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

interface DocumentAuditSink
{
    /**
     * Record a `doc_upload` event. The action is responsible for ensuring the
     * payload contains no raw PHI (no patient name, MRN, DOB, raw bytes, full
     * hash). See {@see DocumentUploadPayload::toAuditPayload()} for the
     * approved metadata shape (S10, S11).
     *
     * @param array<string, mixed> $payload
     */
    public function recordDocUpload(
        string $authUser,
        string $authProvider,
        ?int $patientId,
        string $correlationId,
        bool $success,
        array $payload,
    ): void;
}
