<?php

/**
 * Context Service — allergies (PRD §4.4, §4.5, §4.6, §4.8).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);
agentforge_require_post();

use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Context\SourcePackFactory;
use OpenEMR\Services\AllergyIntoleranceService;
use OpenEMR\Services\PatientService;

$body = \agentforge_json_input();
$sessionToken = isset($body['session_token']) && \is_string($body['session_token']) ? \trim($body['session_token']) : '';
$patientUuid = isset($body['patient_uuid']) && \is_string($body['patient_uuid']) ? \trim($body['patient_uuid']) : '';
if ($sessionToken === '' || $patientUuid === '') {
    \agentforge_emit_json(400, ['error' => 'invalid_request']);
}

$correlationId = \agentforge_incoming_correlation_id();

try {
    $ctx = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
} catch (ChartContextAuthorizationException $e) {
    if ($e->httpStatus === 403 && $e->errorCode === 'active_chart_mismatch') {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $rawAu = $session->get('authUser');
        $au = \is_string($rawAu) ? $rawAu : '';
        if ($au !== '') {
            $rawProv = $session->get('authProvider');
            $prov = \is_string($rawProv) && $rawProv !== '' ? $rawProv : 'Default';
            $rawPid = $session->get('pid');
            $p = \is_int($rawPid) ? $rawPid : (\is_string($rawPid) && \is_numeric($rawPid) ? (int) $rawPid : 0);
            AgentAuditLogger::recordAgentEvent(
                $au,
                $prov,
                $p > 0 ? $p : null,
                'context_read',
                'allergies',
                $correlationId,
                false,
                ['reason' => $e->errorCode]
            );
        }
    }

    \agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

$pid = $ctx['pid'];
if ($pid <= 0) {
    $probe = (new PatientService())->getOne($patientUuid);
    $first = $probe->getFirstDataResult();
    if (!\is_array($first)) {
        \agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
    }

    $rawPid = $first['pid'] ?? null;
    $pid = \is_int($rawPid) ? $rawPid : (\is_string($rawPid) && \is_numeric($rawPid) ? (int) $rawPid : 0);
}

if ($pid <= 0) {
    \agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$allergyService = new AllergyIntoleranceService();
$pr = $allergyService->getAll(['patient_id' => (string) $pid], true, $patientUuid);
if (!$pr->isValid()) {
    \agentforge_emit_json(500, ['error' => 'internal_error', 'correlation_id' => $correlationId]);
}

$rows = $pr->getData();
if (!\is_array($rows)) {
    \agentforge_emit_json(500, ['error' => 'internal_error', 'correlation_id' => $correlationId]);
}

$out = [];
foreach ($rows as $raw) {
    if (!\is_array($raw)) {
        continue;
    }

    $modVal = $raw['modifydate'] ?? null;
    $asOf = new \DateTimeImmutable('now');
    if (\is_string($modVal) && $modVal !== '') {
        $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $modVal);
        if ($parsed === false) {
            $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $modVal);
        }

        if ($parsed instanceof \DateTimeImmutable) {
            $asOf = $parsed;
        }
    }

    $verification = \is_string($raw['verification_title'] ?? null) ? $raw['verification_title'] : '';
    $enddate = $raw['enddate'] ?? null;
    $hasEnd = \is_string($enddate) ? $enddate !== '' : (\is_scalar($enddate) && (string) $enddate !== '');
    $status = $verification !== '' ? $verification : ($hasEnd ? 'inactive' : 'active');

    $reaction = '';
    if (\is_string($raw['reaction_title'] ?? null)) {
        $reaction = $raw['reaction_title'];
    } elseif (\is_string($raw['reaction'] ?? null)) {
        $reaction = $raw['reaction'];
    }

    $listIdRaw = $raw['id'] ?? null;
    $listId = \is_int($listIdRaw) ? $listIdRaw : (\is_string($listIdRaw) && \is_numeric($listIdRaw) ? (int) $listIdRaw : 0);
    $allergyUuid = \is_string($raw['uuid'] ?? null) ? $raw['uuid'] : '';

    $substance = \is_string($raw['title'] ?? null) ? $raw['title'] : '';
    $severity = \is_string($raw['severity_al'] ?? null) ? $raw['severity_al'] : '';

    $out[] = [
        'substance' => $substance,
        'reaction' => $reaction,
        'severity' => $severity,
        'status' => $status,
        'source_pack' => SourcePackFactory::allergy($listId, $allergyUuid, $asOf),
    ];
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid,
    'context_read',
    'allergies',
    $correlationId,
    true,
    []
);

\agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
