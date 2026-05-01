<?php

/**
 * Context Service — active problem list (PRD §4.4–§4.5).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);
agentforge_require_post();

use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\SourcePackFactory;
use OpenEMR\Services\PatientIssuesService;

$ingress = agentforge_context_service_ingress('problems');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'problems',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$svc = new PatientIssuesService();
$pr = $svc->getActiveIssues($pid);

if (!$pr->isValid()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'problems',
        $correlationId,
        false,
        ['reason' => 'service_invalid'],
    );
    agentforge_emit_json(500, ['error' => 'internal_error', 'correlation_id' => $correlationId]);
}

$limit = $ingress['window_limit'];
$out = [];
$rows = $pr->getData();
if (!\is_array($rows)) {
    $rows = [];
}

foreach ($rows as $raw) {
    if (!\is_array($raw) || ($raw['type'] ?? '') !== 'medical_problem') {
        continue;
    }

    $idRaw = $raw['id'] ?? null;
    $listId = \is_int($idRaw) ? $idRaw : (\is_numeric($idRaw) ? (int) $idRaw : 0);

    $title = \is_string($raw['title'] ?? null) ? $raw['title'] : '';
    $begdate = \is_string($raw['begdate'] ?? null) ? $raw['begdate'] : '';
    $diag = \is_string($raw['diagnosis'] ?? null) ? $raw['diagnosis'] : '';

    $enddate = $raw['enddate'] ?? null;
    $inactive = (\is_string($enddate) && $enddate !== '') || (\is_scalar($enddate) && (string) $enddate !== '');

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

    $probUuidRaw = $raw['uuid'] ?? '';
    $probUuidStr = '';
    if (\is_string($probUuidRaw)) {
        $probUuidStr = agentforge_normalize_uuid_payload($probUuidRaw);
    }

    $status = ($inactive === false ? 'active' : 'inactive');

    $out[] = [
        'title' => $title,
        'diagnosis_codes' => $diag,
        'onset_date' => $begdate,
        'status' => $status,
        'source_pack' => SourcePackFactory::problem(
            $listId,
            $probUuidStr !== '' ? $probUuidStr : 'problem-' . (string) $listId,
            $asOf
        ),
    ];

    if (\count($out) >= $limit) {
        break;
    }
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid,
    'context_read',
    'problems',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
