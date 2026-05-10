<?php

/**
 * Post-extraction reclassify hook. Service-to-service endpoint called by
 * agentforge-api after `attach_and_extract` resolves: moves the
 * AgentForge-uploaded document out of the "Clinical Copilot" inbox and
 * into a stock OpenEMR category that matches the parsed content
 * (Lab Report, Patient Information, ...). Filename heuristics never drive
 * this — the agent's parsed-content verdict does, which is far more
 * reliable when filenames are random or wrong.
 *
 * Auth posture: trusted-agent only. Requires the same shared-secret
 * `X-Internal-Auth` header agentforge-api sends to /document/bytes.php
 * + a session_token / patient_uuid pair so ChartContextGate's binding
 * check still applies. Best-effort: a missing OpenEMR mapping (e.g. the
 * upload-time projection failed) yields HTTP 200 + reclassified=false,
 * so a hung-up reclassify never breaks extraction.
 *
 * Accepts: POST {session_token, patient_uuid, docref_uuid, target_category}.
 * `target_category`: 'lab_report' | 'patient_information' | 'clinical_copilot'.
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

use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Documents\DocumentReclassifyPort;
use OpenEMR\Modules\AgentForge\Documents\OpenEmrDocumentReclassifyAdapter;
use OpenEMR\Modules\AgentForge\Documents\OpenEmrDocumentRepository;

$correlationId = agentforge_incoming_correlation_id();

if (!agentforge_verify_internal_auth()) {
    agentforge_emit_json(401, ['error' => 'unauthorized', 'correlation_id' => $correlationId]);
}

$body = agentforge_json_input();
$sessionToken = isset($body['session_token']) && is_string($body['session_token']) ? trim($body['session_token']) : '';
$patientUuid = isset($body['patient_uuid']) && is_string($body['patient_uuid']) ? trim($body['patient_uuid']) : '';
$docrefUuid = isset($body['docref_uuid']) && is_string($body['docref_uuid']) ? trim($body['docref_uuid']) : '';
$targetCategory = isset($body['target_category']) && is_string($body['target_category']) ? trim($body['target_category']) : '';

if ($sessionToken === '' || $patientUuid === '' || $docrefUuid === '' || $targetCategory === '') {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

if (!in_array($targetCategory, DocumentReclassifyPort::SUPPORTED_TARGETS, true)) {
    agentforge_emit_json(400, ['error' => 'unsupported_target', 'correlation_id' => $correlationId]);
}

try {
    $ctx = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
} catch (ChartContextAuthorizationException $e) {
    agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

$storageRoot = \dirname(__DIR__, 6) . '/sites/default/documents/agentforge_w2';
$repository = new OpenEmrDocumentRepository($storageRoot);
$reclassifier = new OpenEmrDocumentReclassifyAdapter($repository);

$categoryId = null;
try {
    $categoryId = $reclassifier->reclassify($docrefUuid, $targetCategory);
} catch (\Throwable $t) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'doc_reclassify',
        'document',
        $correlationId,
        false,
        ['reason' => 'reclassify_threw', 'target_category' => $targetCategory],
    );
    agentforge_emit_json(500, ['error' => 'reclassify_failed', 'correlation_id' => $correlationId]);
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $ctx['pid'] > 0 ? $ctx['pid'] : null,
    'doc_reclassify',
    'document',
    $correlationId,
    $categoryId !== null,
    [
        'target_category' => $targetCategory,
        'category_id' => $categoryId,
        'docref_uuid_prefix' => substr($docrefUuid, 0, 8),
    ],
);

agentforge_emit_json(200, [
    'reclassified' => $categoryId !== null,
    'target_category' => $targetCategory,
    'target_category_id' => $categoryId,
    'correlation_id' => $correlationId,
]);
