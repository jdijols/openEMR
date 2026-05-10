<?php

/**
 * W2 G2-MVP-21 — multipart upload entry for `attach_and_extract`.
 *
 * Accepts: multipart form (file=<binary>, patient_uuid=<canonical>,
 *   session_token=<oa-token>, doc_type=lab_pdf|intake_form,
 *   correlation_id=<opt>).
 * Returns: { docref_uuid, file_size, mime_type, sha256_prefix }.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);
agentforge_require_post();

use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Documents\AgentAuditDocumentSink;
use OpenEMR\Modules\AgentForge\Documents\CrossPatientBindingException;
use OpenEMR\Modules\AgentForge\Documents\DocumentUploadAction;
use OpenEMR\Modules\AgentForge\Documents\DocumentUploadPayload;
use OpenEMR\Modules\AgentForge\Documents\OpenEmrDocumentRepository;
use OpenEMR\Modules\AgentForge\Documents\OpenEmrDocumentsRegistrarAdapter;

$correlationId = agentforge_incoming_correlation_id();

$sessionToken = isset($_POST['session_token']) && is_string($_POST['session_token']) ? trim((string) $_POST['session_token']) : '';
$patientUuid = isset($_POST['patient_uuid']) && is_string($_POST['patient_uuid']) ? trim((string) $_POST['patient_uuid']) : '';
$docType = isset($_POST['doc_type']) && is_string($_POST['doc_type']) ? trim((string) $_POST['doc_type']) : '';

if ($sessionToken === '' || $patientUuid === '' || $docType === '') {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

$file = $_FILES['file'] ?? null;
if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

$tmpPath = (string) ($file['tmp_name'] ?? '');
if ($tmpPath === '' || !is_uploaded_file($tmpPath)) {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

$bytes = @file_get_contents($tmpPath);
if ($bytes === false || $bytes === '') {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

$mimeType = (string) ($file['type'] ?? 'application/octet-stream');
$originalFilename = isset($file['name']) && is_string($file['name']) ? trim((string) $file['name']) : '';
[$payload, $payloadError] = DocumentUploadPayload::parse([
    'doc_type' => $docType,
    'mime_type' => $mimeType,
    'file_bytes' => $bytes,
]);

if ($payloadError !== null || $payload === null) {
    agentforge_emit_json(400, ['error' => $payloadError ?? 'invalid_request', 'correlation_id' => $correlationId]);
}

try {
    $ctx = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
} catch (ChartContextAuthorizationException $e) {
    AgentAuditLogger::recordAgentEvent(
        'unknown',
        'Default',
        null,
        'doc_upload',
        'document',
        $correlationId,
        false,
        ['reason' => $e->errorCode],
    );
    agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

if (!AclMap::userPassesAgentForgeReadGate($ctx['auth_user'])) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'doc_upload',
        'document',
        $correlationId,
        false,
        ['reason' => 'acl_denied'],
    );
    agentforge_emit_json(403, ['error' => 'acl_denied', 'correlation_id' => $correlationId]);
}

$storageRoot = \dirname(__DIR__, 6) . '/sites/default/documents/agentforge_w2';
$repository = new OpenEmrDocumentRepository($storageRoot);
$audit = new AgentAuditDocumentSink();
$registrar = new OpenEmrDocumentsRegistrarAdapter();
$action = new DocumentUploadAction($repository, $audit, $registrar);

try {
    $result = $action->execute(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        (int) ($ctx['pid'] ?? 0),
        $ctx['patient_uuid_canonical'] ?? $patientUuid,
        $patientUuid,
        $correlationId,
        $payload,
        $originalFilename !== '' ? $originalFilename : null,
    );
} catch (CrossPatientBindingException) {
    agentforge_emit_json(403, ['error' => 'active_chart_mismatch', 'correlation_id' => $correlationId]);
} catch (\Throwable $t) {
    agentforge_emit_json(500, ['error' => 'doc_upload_failed', 'correlation_id' => $correlationId]);
}

$pidForResponse = (int) ($ctx['pid'] ?? 0);
agentforge_emit_json(200, [
    'docref_uuid' => $result->docrefUuid,
    'oe_document_id' => $result->oeDocumentId,
    'oe_patient_pid' => $pidForResponse > 0 ? $pidForResponse : null,
    'file_size' => $payload->fileSize,
    'mime_type' => $payload->mimeType,
    'sha256_prefix' => substr($payload->sha256, 0, 8),
    're_upload' => $result->wasReUpload,
    'correlation_id' => $correlationId,
]);
