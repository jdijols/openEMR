<?php

/**
 * Context Service — laboratory results (procedure_result projection; PRD §4.4–§4.5).
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
use OpenEMR\Services\ObservationLabService;

$ingress = agentforge_context_service_ingress('labs');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'labs',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$svc = new ObservationLabService();
$pr = $svc->getAll([], true, $ingress['patient_uuid']);

if (!$pr->isValid()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'labs',
        $correlationId,
        false,
        ['reason' => 'service_invalid'],
    );
    agentforge_emit_json(500, ['error' => 'internal_error', 'correlation_id' => $correlationId]);
}

$limit = $ingress['window_limit'];
$out = [];
$rows = $pr->getData();

if (\is_array($rows)) {
    foreach ($rows as $raw) {
        if (!\is_array($raw)) {
            continue;
        }

        $lidRaw = $raw['procedure_result_id'] ?? null;
        $labRowId = \is_int($lidRaw) ? $lidRaw : (\is_numeric($lidRaw) ? (int) $lidRaw : 0);

        $labUuid = '';
        if (\is_string($raw['uuid'] ?? null)) {
            $labUuid = agentforge_normalize_uuid_payload($raw['uuid']);
        }

        $reportDate = isset($raw['date_report']) ? (string) $raw['date_report'] : '';
        $asOf = new \DateTimeImmutable('now');
        if ($reportDate !== '') {
            $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $reportDate);
            if ($parsed === false) {
                $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $reportDate);
            }

            if ($parsed instanceof \DateTimeImmutable) {
                $asOf = $parsed;
            }
        }

        $procedureName = \is_string($raw['procedure_name'] ?? null) ? $raw['procedure_name'] : '';
        $code = \is_string($raw['procedure_code'] ?? null) ? $raw['procedure_code']
            : (\is_string($raw['result_code'] ?? null) ? $raw['result_code'] : '');

        $out[] = [
            'procedure_name' => $procedureName,
            'procedure_or_result_code' => $code,
            'result_text' => \is_string($raw['result_text'] ?? null) ? $raw['result_text'] : '',
            'units' => \is_string($raw['units'] ?? null) ? $raw['units'] : '',
            'result_value' => isset($raw['result']) ? (string) $raw['result'] : '',
            'reference_range' => isset($raw['range']) ? (string) $raw['range'] : '',
            'abnormal_flag' => isset($raw['abnormal']) ? (string) $raw['abnormal'] : '',
            'result_status' => \is_string($raw['result_status'] ?? null) ? $raw['result_status'] : '',
            'reported_at' => $reportDate,
            'source_pack' => SourcePackFactory::lab(
                $labRowId > 0 ? $labRowId : \max(1, \abs(\crc32($labUuid !== '' ? $labUuid : $code . '|' . $procedureName))),
                $labUuid !== '' ? $labUuid : ('lab-' . $code),
                $asOf
            ),
        ];

        if (\count($out) >= $limit) {
            break;
        }
    }
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid,
    'context_read',
    'labs',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
