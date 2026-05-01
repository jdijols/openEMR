<?php

/**
 * UC-B vitals confirmed write — PRD §4.7 / §4.7.4 via EncounterService::insertVital.
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
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;
use OpenEMR\Modules\AgentForge\Write\MysqlCompletedWriteProposalLedger;
use OpenEMR\Modules\AgentForge\Write\OpenEmrEncounterVitalsAdapter;
use OpenEMR\Modules\AgentForge\Write\VitalsWriteAction;
use OpenEMR\Modules\AgentForge\Write\VitalsWritePayload;
use OpenEMR\Services\EncounterService;
use OpenEMR\Services\PatientService;

$body = agentforge_json_input();
$sessionToken = isset($body['session_token']) && is_string($body['session_token']) ? trim($body['session_token']) : '';
$patientUuid = isset($body['patient_uuid']) && is_string($body['patient_uuid']) ? trim($body['patient_uuid']) : '';
$proposalId = isset($body['proposal_id']) && is_string($body['proposal_id']) ? trim($body['proposal_id']) : '';
$payloadRaw = $body['payload'] ?? null;
$proposalIdRaw = isset($body['proposal_id']);

$encounterNumeric = null;
if (array_key_exists('encounter_id', $body)) {
    $eidCandidate = $body['encounter_id'];
    if (is_int($eidCandidate)) {
        $encounterNumeric = $eidCandidate > 0 ? $eidCandidate : null;
    } elseif (is_string($eidCandidate) && is_numeric($eidCandidate)) {
        $eidParsed = (int) $eidCandidate;
        $encounterNumeric = $eidParsed > 0 ? $eidParsed : null;
    }
}

$correlationId = agentforge_incoming_correlation_id();

if ($sessionToken === '' || $patientUuid === '' || $proposalId === '' || !$proposalIdRaw || $encounterNumeric === null) {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

[$payload, $payloadError] = VitalsWritePayload::parse(is_array($payloadRaw) ? $payloadRaw : null);
if ($payloadError === 'unsupported_payload') {
    try {
        $ctxProbe = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
        AgentAuditLogger::recordAgentEvent(
            $ctxProbe['auth_user'],
            $ctxProbe['auth_provider'],
            $ctxProbe['pid'] > 0 ? $ctxProbe['pid'] : null,
            'write_attempt',
            'vitals',
            $correlationId,
            false,
            ['reason' => 'unsupported_write'],
        );
    } catch (ChartContextAuthorizationException) {
    }

    agentforge_emit_json(400, ['error' => 'unsupported_write', 'correlation_id' => $correlationId]);
}

if ($payloadError === 'invalid_vitals' || $payload === null) {
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
                'vitals',
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
        'vitals',
        $correlationId,
        false,
        ['reason' => 'acl_denied'],
    );
    agentforge_emit_json(403, ['error' => 'acl_denied', 'correlation_id' => $correlationId]);
}

$pid = $ctx['pid'];
if ($pid <= 0) {
    $probe = (new PatientService())->getOne($patientUuid);
    $first = $probe->getFirstDataResult();
    if (!is_array($first)) {
        agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
    }

    $rawPid = $first['pid'] ?? null;
    $pid = is_int($rawPid) ? $rawPid : (is_string($rawPid) && is_numeric($rawPid) ? (int) $rawPid : 0);
}

if ($pid <= 0) {
    agentforge_emit_json(403, ['error' => 'active_chart_mismatch', 'correlation_id' => $correlationId]);
}

$action = new VitalsWriteAction(
    new OpenEmrEncounterVitalsAdapter(new EncounterService()),
    new MysqlCompletedWriteProposalLedger()
);

try {
    $result = $action->execute(
        $pid,
        $encounterNumeric,
        $proposalId,
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $payload,
    );
} catch (DuplicateProposalExecutionException) {
    agentforge_emit_json(400, ['error' => 'duplicate_proposal', 'correlation_id' => $correlationId]);
}

if ($result->isAccepted()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'write_apply',
        'vitals',
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
    $pid,
    'write_rejected',
    'vitals',
    $correlationId,
    false,
    ['reason' => 'provider_error'],
);

agentforge_emit_json(200, [
    'accepted' => false,
    'reason' => $result->failureReason(),
    'correlation_id' => $correlationId,
]);
