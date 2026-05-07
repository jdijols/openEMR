<?php

/**
 * W2 G2-MVP-23 — document bytes proxy. GET by DocRef UUID, returns the raw
 * file bytes with the original Content-Type. Refuses cross-patient access
 * (S15) before any byte read.
 *
 * Required query params: docref_uuid, session_token, patient_uuid
 *   (canonical bound chart UUID).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    agentforge_emit_json(405, ['error' => 'method_not_allowed']);
}

use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Documents\CrossPatientDocumentAccessException;
use OpenEMR\Modules\AgentForge\Documents\DocumentBytesAction;
use OpenEMR\Modules\AgentForge\Documents\DocumentNotFoundException;
use OpenEMR\Modules\AgentForge\Documents\OpenEmrDocumentRepository;

$correlationId = agentforge_incoming_correlation_id();

$docrefUuid = isset($_GET['docref_uuid']) && is_string($_GET['docref_uuid']) ? trim((string) $_GET['docref_uuid']) : '';
$sessionToken = isset($_GET['session_token']) && is_string($_GET['session_token']) ? trim((string) $_GET['session_token']) : '';
$patientUuid = isset($_GET['patient_uuid']) && is_string($_GET['patient_uuid']) ? trim((string) $_GET['patient_uuid']) : '';

if ($docrefUuid === '' || $sessionToken === '' || $patientUuid === '') {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

try {
    $ctx = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
} catch (ChartContextAuthorizationException $e) {
    agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

if (!AclMap::userPassesAgentForgeReadGate($ctx['auth_user'])) {
    agentforge_emit_json(403, ['error' => 'acl_denied', 'correlation_id' => $correlationId]);
}

$storageRoot = \dirname(__DIR__, 6) . '/sites/default/documents/agentforge_w2';
$repository = new OpenEmrDocumentRepository($storageRoot);
$action = new DocumentBytesAction($repository);

try {
    $result = $action->execute($docrefUuid, $ctx['patient_uuid_canonical'] ?? $patientUuid);
} catch (CrossPatientDocumentAccessException) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'doc_bytes_fetch',
        'document',
        $correlationId,
        false,
        ['reason' => 'cross_patient_document_access'],
    );
    agentforge_emit_json(403, ['error' => 'cross_patient_document_access', 'correlation_id' => $correlationId]);
} catch (DocumentNotFoundException) {
    agentforge_emit_json(404, ['error' => 'document_not_found', 'correlation_id' => $correlationId]);
} catch (\Throwable) {
    agentforge_emit_json(500, ['error' => 'doc_bytes_failed', 'correlation_id' => $correlationId]);
}

http_response_code(200);
header('Content-Type: ' . $result->mimeType);
header('Content-Length: ' . $result->fileSize);
header('Cache-Control: private, no-store');
header('X-Correlation-Id: ' . $correlationId);
echo $result->bytes;
exit;
