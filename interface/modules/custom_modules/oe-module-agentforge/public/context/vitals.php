<?php

/**
 * Context Service — recent vitals panels (PRD §4.4–§4.5).
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
use OpenEMR\Services\VitalsService;

$ingress = agentforge_context_service_ingress('vitals');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'vitals',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$svc = new VitalsService();
$svc->setShouldConvertVitalMeasurementsFlag(false);
$pr = $svc->search(['pid' => new TokenSearchField('pid', [(string) $pid])]);

if (!$pr->isValid()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'vitals',
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

        $vitalsUuidStr = '';
        if (\is_string($raw['uuid'] ?? null)) {
            $vitalsUuidStr = agentforge_normalize_uuid_payload($raw['uuid']);
        }

        $idRaw = $raw['form_id'] ?? $raw['id'] ?? null;
        $vitalsPk = \is_int($idRaw) ? $idRaw : (\is_numeric($idRaw) ? (int) $idRaw : 0);

        $dateStr = isset($raw['date']) ? (string) $raw['date'] : '';
        $asOf = new \DateTimeImmutable('now');
        if ($dateStr !== '') {
            $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $dateStr);
            if ($parsed === false) {
                $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $dateStr);
            }

            if ($parsed instanceof \DateTimeImmutable) {
                $asOf = $parsed;
            }
        }
        $packId = $vitalsPk > 0 ? $vitalsPk : \max(1, \abs(\crc32($vitalsUuidStr !== ''
            ? $vitalsUuidStr
            : ('v-' . $dateStr))));
        $packUuid = $vitalsUuidStr !== '' ? $vitalsUuidStr : ('v-' . ($dateStr !== '' ? $dateStr : 'na'));

        $out[] = [
            'recorded_at' => $dateStr,
            'bps' => isset($raw['bps']) ? (string) $raw['bps'] : '',
            'bpd' => isset($raw['bpd']) ? (string) $raw['bpd'] : '',
            'pulse' => isset($raw['pulse']) ? (string) $raw['pulse'] : '',
            'respiration' => isset($raw['respiration']) ? (string) $raw['respiration'] : '',
            'temperature' => isset($raw['temperature']) ? (string) $raw['temperature'] : '',
            'oxygen_saturation' => isset($raw['oxygen_saturation']) ? (string) $raw['oxygen_saturation'] : '',
            'pain' => '',
            'weight' => isset($raw['weight']) ? (string) $raw['weight'] : '',
            'height' => isset($raw['height']) ? (string) $raw['height'] : '',
            'BMI' => isset($raw['BMI']) ? (string) $raw['BMI'] : '',
            'note' => \is_string($raw['note'] ?? null) ? $raw['note'] : '',
            'source_pack' => SourcePackFactory::vital(
                $packId,
                $packUuid,
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
    'vitals',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
