<?php

/**
 * W2 G2-MVP-20/25 — production DocumentAuditSink implementation that bridges
 * to the W1 `AgentAuditLogger::recordAgentEvent` static. Keeps the Action
 * + ObservationWriter free of static dependencies for testability while
 * the production wire path remains unified.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;

final class AgentAuditDocumentSink implements DocumentAuditSink
{
    public function recordDocUpload(
        string $authUser,
        string $authProvider,
        ?int $patientId,
        string $correlationId,
        bool $success,
        array $payload,
    ): void {
        $action = is_string($payload['action'] ?? null) ? (string) $payload['action'] : 'doc_upload';
        AgentAuditLogger::recordAgentEvent(
            $authUser,
            $authProvider,
            $patientId,
            $action,
            'document',
            $correlationId,
            $success,
            $payload,
            $success ? null : (string) ($payload['reason'] ?? 'doc_upload_failed'),
        );
    }
}
