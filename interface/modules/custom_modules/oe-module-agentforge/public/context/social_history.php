<?php

/**
 * Context Service — social history snapshot (PRD §4.4–§4.5).
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
use OpenEMR\Services\Search\TokenSearchField;
use OpenEMR\Services\SocialHistoryService;

$ingress = agentforge_context_service_ingress('social_history');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'social_history',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$svc = new SocialHistoryService();
$pr = $svc->search(
    ['pid' => new TokenSearchField('pid', [(string) $pid])],
    true,
    $ingress['window_limit']
);

if (!$pr->isValid()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'social_history',
        $correlationId,
        false,
        ['reason' => 'service_invalid'],
    );
    agentforge_emit_json(500, ['error' => 'internal_error', 'correlation_id' => $correlationId]);
}

$rows = $pr->getData();
$row = (\is_array($rows) && $rows !== []) && \is_array($rows[0] ?? null) ? $rows[0] : null;

$data = [];

if (\is_array($row)) {
    $idRaw = $row['id'] ?? null;
    $hid = \is_int($idRaw) ? $idRaw : (\is_numeric($idRaw) ? (int) $idRaw : 0);

    $uuidStr = '';
    if (\is_string($row['uuid'] ?? null)) {
        $uuidStr = agentforge_normalize_uuid_payload($row['uuid']);
    }

    $dateRow = isset($row['date']) ? (string) $row['date'] : '';
    $asOf = new \DateTimeImmutable('now');
    if ($dateRow !== '') {
        $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dateRow);
        if ($parsed === false) {
            $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $dateRow);
        }

        if ($parsed instanceof \DateTimeImmutable) {
            $asOf = $parsed;
        }
    }

    $data = [
        'record_date' => $dateRow,
        'tobacco' => isset($row['tobacco']) ? (string) $row['tobacco'] : '',
        'alcohol' => isset($row['alcohol']) ? (string) $row['alcohol'] : '',
        'exercise_patterns' => \is_string($row['exercise_patterns'] ?? null) ? $row['exercise_patterns'] : '',
        'recreational_drugs' => \is_string($row['recreational_drugs'] ?? null) ? $row['recreational_drugs'] : '',
        'source_pack' => SourcePackFactory::socialHistory(
            $hid > 0 ? $hid : \max(1, $pid),
            $uuidStr !== '' ? $uuidStr : ('sh-' . (string) $pid),
            $asOf
        ),
    ];
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid,
    'context_read',
    'social_history',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $data !== [] ? [$data] : [],
    'correlation_id' => $correlationId,
]);
