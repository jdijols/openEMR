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

// Augment with PDF-extracted lab observations from the agentforge_w2
// sidecar store. The CUI upload + `attach_and_extract` flow writes a
// JSON sidecar per (patient_uuid, docref_uuid, field_path) but does not
// (yet) project into `procedure_result`, so the loop above misses them.
// The dashboard's LabsCard reads these via
// `context/lab_observations_for_dashboard.php`; we mirror that filter so
// the agent's `get_labs` tool sees the same rows the clinician sees on
// the dashboard, satisfying the §5 citation contract for uploaded labs.
$canonicalPatientUuid = \strtolower($ingress['patient_uuid']);
$obsRoot = \dirname(__DIR__, 6) . '/sites/default/documents/agentforge_w2/_obs';

if (\count($out) < $limit && \is_dir($obsRoot)) {
    foreach (\scandir($obsRoot) ?: [] as $name) {
        if ($name === '.' || $name === '..' || !\str_ends_with($name, '.json')) {
            continue;
        }
        if (\count($out) >= $limit) {
            break;
        }

        $sidecarPath = $obsRoot . '/' . $name;
        $raw = \file_get_contents($sidecarPath);
        if ($raw === false) {
            continue;
        }
        $decoded = \json_decode($raw, true);
        if (!\is_array($decoded)) {
            continue;
        }
        if (isset($decoded['deleted_at'])) {
            continue;
        }
        $sidecarPatient = \is_string($decoded['patient_uuid_canonical'] ?? null)
            ? \strtolower((string) $decoded['patient_uuid_canonical'])
            : '';
        if ($sidecarPatient !== $canonicalPatientUuid) {
            continue;
        }

        $payload = \is_array($decoded['payload'] ?? null) ? $decoded['payload'] : [];
        $testName = \is_string($payload['test_name'] ?? null) ? (string) $payload['test_name'] : '';
        if ($testName === '') {
            // Intake-form / metadata-only sidecars share this directory; only
            // result-row sidecars carry test_name.
            continue;
        }

        $docrefUuid = \is_string($decoded['docref_uuid'] ?? null) ? (string) $decoded['docref_uuid'] : '';
        $fieldPath = \is_string($decoded['extraction_field_path'] ?? null) ? (string) $decoded['extraction_field_path'] : '';

        $valueRaw = $payload['value'] ?? null;
        $valueStr = \is_scalar($valueRaw) ? (string) $valueRaw : '';
        $unit = \is_string($payload['unit'] ?? null) ? (string) $payload['unit'] : '';
        $abnormalFlag = \is_string($payload['abnormal_flag'] ?? null) ? (string) $payload['abnormal_flag'] : '';

        // Build a verbatim reference_range string from the structured fields
        // so the agent has a single readable token to cite.
        $rangeText = \is_string($payload['reference_range_text'] ?? null) ? (string) $payload['reference_range_text'] : '';
        if ($rangeText === '') {
            $low = $payload['reference_range_low'] ?? null;
            $high = $payload['reference_range_high'] ?? null;
            if (\is_numeric($low) && \is_numeric($high)) {
                $rangeText = (string) $low . '-' . (string) $high;
            } elseif (\is_numeric($high)) {
                $rangeText = '<=' . (string) $high;
            } elseif (\is_numeric($low)) {
                $rangeText = '>=' . (string) $low;
            }
        }

        $collectionDate = \is_string($payload['collection_date'] ?? null) ? (string) $payload['collection_date'] : '';
        $asOfRaw = \is_string($decoded['updated_at'] ?? null)
            ? (string) $decoded['updated_at']
            : (\is_string($decoded['created_at'] ?? null) ? (string) $decoded['created_at'] : '');
        $asOf = new \DateTimeImmutable('now');
        if ($asOfRaw !== '') {
            try {
                $asOf = new \DateTimeImmutable($asOfRaw);
            } catch (\Throwable) {
                // fall through to now()
            }
        }

        // The sidecar row_id is synthesized from (docref_uuid, field_path) so
        // the agent and dashboard agree on identity for the same observation.
        $synthRowId = \max(1, \abs(\crc32($docrefUuid . '|' . $fieldPath)));

        $out[] = [
            'procedure_name' => $testName,
            'procedure_or_result_code' => \is_string($payload['loinc'] ?? null) ? (string) $payload['loinc'] : '',
            'result_text' => $testName,
            'units' => $unit,
            'result_value' => $valueStr,
            'reference_range' => $rangeText,
            'abnormal_flag' => $abnormalFlag,
            'result_status' => 'final',
            'reported_at' => $collectionDate,
            'extraction_field_path' => $fieldPath,
            'docref_uuid' => $docrefUuid,
            'source_pack' => SourcePackFactory::lab(
                $synthRowId,
                $docrefUuid !== '' ? $docrefUuid : ('lab-sidecar-' . (string) $synthRowId),
                $asOf
            ),
        ];
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
