<?php

/**
 * Context Service — patient identity (PRD §4.4, §4.5, §4.6, §4.8).
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
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Context\SourcePackFactory;
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
                'identity',
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

$svc = new PatientService();
$pr = $svc->getOne($patientUuid);
if (!$pr->isValid() || !$pr->hasData()) {
    \agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$row = $pr->getFirstDataResult();
if (!\is_array($row)) {
    \agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

unset($row['ss'], $row['drivers_license']);

if (isset($row['uuid']) && \is_string($row['uuid']) && \strlen($row['uuid']) === 16) {
    $row['uuid'] = UuidRegistry::uuidToString($row['uuid']);
}

$dateVal = $row['date'] ?? null;
$asOf = new \DateTimeImmutable('now');
if (\is_string($dateVal) && $dateVal !== '') {
    $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dateVal);
    if ($parsed === false) {
        $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $dateVal);
    }

    if ($parsed instanceof \DateTimeImmutable) {
        $asOf = $parsed;
    }
}

$row['source_pack'] = SourcePackFactory::identity($asOf, $pid, $patientUuid);

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid > 0 ? $pid : null,
    'context_read',
    'identity',
    $correlationId,
    true,
    []
);

\agentforge_emit_json(200, [
    'ok' => true,
    'data' => $row,
    'correlation_id' => $correlationId,
]);
