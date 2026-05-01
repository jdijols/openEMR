<?php

/**
 * Context Service — recent encounters (PRD §4.4–§4.5).
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
use OpenEMR\Services\EncounterService;
use OpenEMR\Services\Search\TokenSearchField;
use OpenEMR\Services\Search\TokenSearchValue;
use OpenEMR\Validators\ProcessingResult;

$ingress = agentforge_context_service_ingress('encounters');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'encounters',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$svc = new EncounterService();
$pr = $svc->search(
    ['pid' => new TokenSearchField('pid', [new TokenSearchValue((string) $pid, null)])],
    true,
    $ingress['patient_uuid'],
    ['limit' => $ingress['window_limit'], 'order' => '`date` DESC']
);

if (!$pr instanceof ProcessingResult || !$pr->isValid()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'encounters',
        $correlationId,
        false,
        ['reason' => 'service_invalid'],
    );
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

$rows = $pr->hasData() ? $pr->getData() : [];

$out = [];
foreach ($rows as $raw) {
    if (!\is_array($raw)) {
        continue;
    }

    $eidRaw = $raw['eid'] ?? null;
    $eid = \is_int($eidRaw) ? $eidRaw : (\is_numeric($eidRaw) ? (int) $eidRaw : 0);
    $euRaw = $raw['euuid'] ?? '';
    $euStr = agentforge_normalize_uuid_payload(\is_string($euRaw) ? $euRaw : '');

    $dateStr = isset($raw['date']) ? (string) $raw['date'] : '';
    $asOf = new \DateTimeImmutable('now');
    if (\is_string($dateStr) && $dateStr !== '') {
        $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dateStr);
        if ($parsed === false) {
            $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $dateStr);
        }

        if ($parsed instanceof \DateTimeImmutable) {
            $asOf = $parsed;
        }
    }

    $reason = \is_string($raw['reason'] ?? null) ? $raw['reason'] : '';
    $catName = \is_string($raw['pc_catname'] ?? null) ? $raw['pc_catname'] : '';
    $classTitle = \is_string($raw['class_title'] ?? null) ? $raw['class_title'] : '';

    $out[] = [
        'eid' => $eid,
        'euuid' => $euStr !== '' ? $euStr : (string) $eid,
        'date' => $dateStr,
        'reason' => $reason,
        'visit_category' => $catName,
        'visit_class_title' => $classTitle,
        'source_pack' => SourcePackFactory::encounter(
            $eid > 0 ? $eid : 0,
            $euStr !== '' ? $euStr : 'encounter-' . (string) $eid,
            $asOf
        ),
    ];
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid,
    'context_read',
    'encounters',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
