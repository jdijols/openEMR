<?php

/**
 * G2-Early-24 — confirmed document soft-delete (cascades to linked observations).
 * write_target='document_delete'.
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

use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Documents\DocumentDeleteAction;
use OpenEMR\Modules\AgentForge\Documents\DocumentDeletePayload;
use OpenEMR\Modules\AgentForge\Documents\OpenEmrDocumentRepository;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use OpenEMR\Modules\AgentForge\Write\MysqlCompletedWriteProposalLedger;

$body = agentforge_json_input();
$sessionToken = isset($body['session_token']) && is_string($body['session_token']) ? trim($body['session_token']) : '';
$patientUuid = isset($body['patient_uuid']) && is_string($body['patient_uuid']) ? trim($body['patient_uuid']) : '';
$proposalId = isset($body['proposal_id']) && is_string($body['proposal_id']) ? trim($body['proposal_id']) : '';
$payloadRaw = $body['payload'] ?? null;
$proposalIdRaw = isset($body['proposal_id']);

$correlationId = agentforge_incoming_correlation_id();

if ($sessionToken === '' || $patientUuid === '' || $proposalId === '' || !$proposalIdRaw) {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

[$payload, $payloadError] = DocumentDeletePayload::parse(is_array($payloadRaw) ? $payloadRaw : null);
if ($payloadError === 'unsupported_payload') {
    try {
        $ctxProbe = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
        AgentAuditLogger::recordAgentEvent(
            $ctxProbe['auth_user'],
            $ctxProbe['auth_provider'],
            $ctxProbe['pid'] > 0 ? $ctxProbe['pid'] : null,
            'write_attempt',
            'document_delete',
            $correlationId,
            false,
            ['reason' => 'unsupported_write'],
            'unsupported_write',
        );
    } catch (ChartContextAuthorizationException) {
    }

    agentforge_emit_json(400, ['error' => 'unsupported_write', 'correlation_id' => $correlationId]);
}

if ($payloadError === 'missing_uuid' || $payload === null) {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

try {
    $ctx = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
} catch (ChartContextAuthorizationException $e) {
    if ($e->httpStatus === 403 && $e->errorCode === 'active_chart_mismatch') {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $rawAu = $session->get('authUser');
        $au = is_string($rawAu) ? $rawAu : '';
        if ($au !== '') {
            $rawProv = $session->get('authProvider');
            $prov = is_string($rawProv) && $rawProv !== '' ? $rawProv : 'Default';
            $rawPid = $session->get('pid');
            $p = is_int($rawPid) ? $rawPid : (is_string($rawPid) && is_numeric($rawPid) ? (int) $rawPid : 0);
            AgentAuditLogger::recordAgentEvent(
                $au,
                $prov,
                $p > 0 ? $p : null,
                'write_attempt',
                'document_delete',
                $correlationId,
                false,
                ['reason' => $e->errorCode],
                $e->errorCode,
            );
        }
    }

    agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

if (!AclMap::userPassesAgentForgeProposeWriteGate($ctx['auth_user'])) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'write_attempt',
        'document_delete',
        $correlationId,
        false,
        ['reason' => 'acl_denied'],
        'acl_denied',
    );
    agentforge_emit_json(403, ['error' => 'acl_denied', 'correlation_id' => $correlationId]);
}

$canonicalPatientUuid = strtolower($patientUuid);

$storageRoot = \dirname(__DIR__, 5) . '/sites/default/documents/agentforge_w2';
$action = new DocumentDeleteAction(
    new OpenEmrDocumentRepository($storageRoot),
    new MysqlCompletedWriteProposalLedger(),
);

try {
    $result = $action->execute($canonicalPatientUuid, $proposalId, $payload);
} catch (DuplicateProposalExecutionException) {
    agentforge_emit_json(400, ['error' => 'duplicate_proposal', 'correlation_id' => $correlationId]);
}

if ($result['accepted'] === true) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'write_apply',
        'document_delete',
        $correlationId,
        true,
        ['observations_deleted' => $result['observations_deleted']],
    );

    agentforge_emit_json(200, [
        'accepted' => true,
        'observations_deleted' => $result['observations_deleted'],
        'correlation_id' => $correlationId,
    ]);
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $ctx['pid'] > 0 ? $ctx['pid'] : null,
    'write_rejected',
    'document_delete',
    $correlationId,
    false,
    ['reason' => 'provider_error'],
    $result['reason'] ?? 'write failed',
);

agentforge_emit_json(200, [
    'accepted' => false,
    'reason' => $result['reason'] ?? 'write failed',
    'correlation_id' => $correlationId,
]);
