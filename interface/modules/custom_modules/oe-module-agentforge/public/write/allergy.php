<?php

/**
 * UC-B allergy confirmed write — PRD §4.7 → `lists` row via AllergyIntoleranceService (add/update only).
 *
 * Patient-scoped (no encounter binding). Deletes/resolves are unsupported at the validator (400 unsupported_write).
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

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Write\AllergyWriteAction;
use OpenEMR\Modules\AgentForge\Write\AllergyWritePayload;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use OpenEMR\Modules\AgentForge\Write\MysqlCompletedWriteProposalLedger;
use OpenEMR\Modules\AgentForge\Write\OpenEmrPatientAllergyAdapter;

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

[$payload, $payloadError] = AllergyWritePayload::parse(is_array($payloadRaw) ? $payloadRaw : null);
if ($payloadError === 'unsupported_payload') {
    try {
        $ctxProbe = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
        AgentAuditLogger::recordAgentEvent(
            $ctxProbe['auth_user'],
            $ctxProbe['auth_provider'],
            $ctxProbe['pid'] > 0 ? $ctxProbe['pid'] : null,
            'write_attempt',
            'allergy',
            $correlationId,
            false,
            ['reason' => 'unsupported_write'],
        );
    } catch (ChartContextAuthorizationException) {
    }

    agentforge_emit_json(400, ['error' => 'unsupported_write', 'correlation_id' => $correlationId]);
}

if ($payloadError === 'invalid_allergy_payload' || $payload === null) {
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
                'allergy',
                $correlationId,
                false,
                ['reason' => $e->errorCode],
            );
        }
    }

    agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

if (!AclMain::aclCheckCore(AclMap::MODULE_SECTION, AclMap::PROPOSE_WRITE, $ctx['auth_user'])) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'write_attempt',
        'allergy',
        $correlationId,
        false,
        ['reason' => 'acl_denied'],
    );
    agentforge_emit_json(403, ['error' => 'acl_denied', 'correlation_id' => $correlationId]);
}

$canonicalPatientUuid = strtolower($patientUuid);

$action = new AllergyWriteAction(
    new OpenEmrPatientAllergyAdapter(),
    new MysqlCompletedWriteProposalLedger(),
);

try {
    $result = $action->execute(
        $canonicalPatientUuid,
        $proposalId,
        $payload,
    );
} catch (DuplicateProposalExecutionException) {
    agentforge_emit_json(400, ['error' => 'duplicate_proposal', 'correlation_id' => $correlationId]);
}

if ($result->isAccepted()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'write_apply',
        'allergy',
        $correlationId,
        true,
        [],
    );

    agentforge_emit_json(200, [
        'accepted' => true,
        'audit_row_id' => $result->auditRowId,
        'correlation_id' => $correlationId,
    ]);
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $ctx['pid'] > 0 ? $ctx['pid'] : null,
    'write_rejected',
    'allergy',
    $correlationId,
    false,
    ['reason' => 'provider_error'],
);

agentforge_emit_json(200, [
    'accepted' => false,
    'reason' => $result->failureReason(),
    'correlation_id' => $correlationId,
]);
