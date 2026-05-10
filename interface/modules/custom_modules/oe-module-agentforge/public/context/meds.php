<?php

/**
 * Context Service — active medications (prescriptions UNION lists; PRD §4.4–§4.5).
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
use OpenEMR\Services\PrescriptionService;

$ingress = agentforge_context_service_ingress('meds');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'meds',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$svc = new PrescriptionService();
$pr = $svc->getAll(['patient.uuid' => $ingress['patient_uuid']]);

if (!$pr->isValid()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'meds',
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
    if (!\is_array($raw)) {
        continue;
    }

    $activeRaw = $raw['active'] ?? '';
    $isActive = (\is_numeric($activeRaw) && ((int) $activeRaw === 1)) || (\is_string($activeRaw) && strtolower($activeRaw) === '1');
    if (!$isActive) {
        continue;
    }

    $uuidStr = '';
    if (\is_string($raw['uuid'] ?? null)) {
        $uuidStr = agentforge_normalize_uuid_payload($raw['uuid']);
    }

    $idRaw = $raw['id'] ?? null;
    $rowIdNum = \is_int($idRaw) ? $idRaw : (\is_numeric($idRaw) ? (int) $idRaw : 0);

    $sourceTable = \is_string($raw['source_table'] ?? null) ? $raw['source_table'] : 'prescriptions';
    $dateMod = isset($raw['date_modified']) ? (string) $raw['date_modified'] : '';

    $asOf = new \DateTimeImmutable('now');
    if ($dateMod !== '') {
        $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dateMod);
        if ($parsed === false) {
            $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $dateMod);
        }

        if ($parsed instanceof \DateTimeImmutable) {
            $asOf = $parsed;
        }
    }

    $drug = \is_string($raw['drug'] ?? null) ? $raw['drug'] : '';
    $status = \is_string($raw['status'] ?? null) ? $raw['status'] : '';
    $dosage = \is_string($raw['dosage'] ?? null) ? $raw['dosage'] : '';
    $schedule = '';
    if (\is_string($raw['interval'] ?? null)) {
        $schedule = $raw['interval'];
    } elseif (\is_string($raw['drug_dosage_instructions'] ?? null)) {
        $schedule = $raw['drug_dosage_instructions'];
    }

    $uuidForPack = $uuidStr !== '' ? $uuidStr : ('rx-' . (string) $rowIdNum . '-' . (string) crc32((string) $drug));

    $out[] = [
        'drug' => $drug,
        'dosage' => $dosage,
        'route' => \is_string($raw['route'] ?? null) ? $raw['route'] : '',
        'instructions' => $schedule,
        'status_title' => $status,
        'source_pack' => SourcePackFactory::medication(
            $sourceTable,
            $rowIdNum > 0 ? $rowIdNum : 0,
            $uuidForPack,
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
    'meds',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
