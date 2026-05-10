<?php

/**
 * QA-pass shortcut — surface lab observations that landed in the
 * agentforge JSON sidecar store as FHIR-shaped Observation resources so
 * the patient-dashboard's LabsCard can render them. The original W2 MVP
 * deferred writing FHIR Observation rows ("Thursday upgrade") and the
 * lab data has been living in `sites/default/documents/agentforge_w2/_obs/`
 * as JSON files keyed by sha256(patient_uuid|docref_uuid|field_path).
 *
 * This endpoint walks that directory, filters by `patient_uuid_canonical`,
 * shapes each row into a minimal FHIR Observation, and returns a Bundle
 * the dashboard can drop into its existing LabsCard render path.
 *
 * Auth pattern mirrors the other context endpoints: agentforge session
 * token + patient_uuid in POST body, ChartContextGate authorization.
 *
 * Long-term: replace this with a real `procedure_result` write inside
 * `OpenEmrObservationWriteAdapter` so stock OpenEMR FHIR
 * `/Observation?category=laboratory` serves the same data.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);
agentforge_require_post();

use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;

$body = \agentforge_json_input();
$sessionToken = isset($body['session_token']) && \is_string($body['session_token']) ? \trim($body['session_token']) : '';
$patientUuid = isset($body['patient_uuid']) && \is_string($body['patient_uuid']) ? \trim($body['patient_uuid']) : '';
if ($sessionToken === '' || $patientUuid === '') {
    \agentforge_emit_json(400, ['error' => 'invalid_request']);
}

$correlationId = \agentforge_incoming_correlation_id();

try {
    ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
} catch (ChartContextAuthorizationException $e) {
    \agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

$canonicalPatientUuid = strtolower($patientUuid);
$storageRoot = \dirname(__DIR__, 6) . '/sites/default/documents/agentforge_w2/_obs';

$observations = [];

if (\is_dir($storageRoot)) {
    foreach (\scandir($storageRoot) ?: [] as $name) {
        if ($name === '.' || $name === '..' || !\str_ends_with($name, '.json')) {
            continue;
        }
        $path = $storageRoot . '/' . $name;
        $raw = \file_get_contents($path);
        if ($raw === false) {
            continue;
        }
        $decoded = \json_decode($raw, true);
        if (!\is_array($decoded)) {
            continue;
        }
        $sidecarPatient = \is_string($decoded['patient_uuid_canonical'] ?? null)
            ? \strtolower((string) $decoded['patient_uuid_canonical'])
            : '';
        if ($sidecarPatient !== $canonicalPatientUuid) {
            continue;
        }
        $payload = \is_array($decoded['payload'] ?? null) ? $decoded['payload'] : [];
        $docrefUuid = \is_string($decoded['docref_uuid'] ?? null) ? (string) $decoded['docref_uuid'] : '';
        $fieldPath = \is_string($decoded['extraction_field_path'] ?? null) ? (string) $decoded['extraction_field_path'] : '';

        // Only result-row sidecars surface as Observations. Filter out
        // metadata-only sidecars (e.g. interpretive_comments) which do
        // not have the per-row shape.
        $testName = \is_string($payload['test_name'] ?? null) ? (string) $payload['test_name'] : '';
        if ($testName === '') {
            continue;
        }

        $rawValue = $payload['value'] ?? null;
        $unit = \is_string($payload['unit'] ?? null) ? (string) $payload['unit'] : null;
        $rangeLow = $payload['reference_range_low'] ?? null;
        $rangeHigh = $payload['reference_range_high'] ?? null;
        $rangeText = \is_string($payload['reference_range_text'] ?? null) ? (string) $payload['reference_range_text'] : null;
        $collectionDate = \is_string($payload['collection_date'] ?? null) ? (string) $payload['collection_date'] : null;
        $abnormalFlag = \is_string($payload['abnormal_flag'] ?? null) ? (string) $payload['abnormal_flag'] : '';

        $obs = [
            'resourceType' => 'Observation',
            'id' => \hash('sha1', $docrefUuid . '|' . $fieldPath),
            'status' => 'final',
            'category' => [[
                'coding' => [[
                    'system' => 'http://terminology.hl7.org/CodeSystem/observation-category',
                    'code' => 'laboratory',
                    'display' => 'Laboratory',
                ]],
                'text' => 'laboratory',
            ]],
            'code' => [
                'text' => $testName,
            ],
        ];

        if (\is_numeric($rawValue)) {
            $obs['valueQuantity'] = [
                'value' => 0 + $rawValue,
                'unit' => $unit ?? '',
            ];
        } elseif (\is_string($rawValue) && $rawValue !== '') {
            $obs['valueString'] = $rawValue;
        }

        if ($collectionDate !== null && $collectionDate !== '') {
            $obs['effectiveDateTime'] = $collectionDate;
        }

        $referenceRange = [];
        if (\is_numeric($rangeLow)) {
            $referenceRange['low'] = ['value' => 0 + $rangeLow, 'unit' => $unit ?? ''];
        }
        if (\is_numeric($rangeHigh)) {
            $referenceRange['high'] = ['value' => 0 + $rangeHigh, 'unit' => $unit ?? ''];
        }
        if ($rangeText !== null && $rangeText !== '') {
            $referenceRange['text'] = $rangeText;
        }
        if ($referenceRange !== []) {
            $obs['referenceRange'] = [$referenceRange];
        }

        if ($abnormalFlag !== '' && $abnormalFlag !== 'normal' && $abnormalFlag !== 'unknown') {
            // Map our extracted abnormal_flag to FHIR interpretation codes.
            $code = match ($abnormalFlag) {
                'low' => 'L',
                'high' => 'H',
                'critical_low' => 'LL',
                'critical_high' => 'HH',
                default => 'A',
            };
            $obs['interpretation'] = [[
                'coding' => [[
                    'system' => 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
                    'code' => $code,
                    'display' => $abnormalFlag,
                ]],
            ]];
        }

        $observations[] = $obs;
    }
}

// Sort by effectiveDateTime descending so the newest labs appear first
// in the card (the dashboard uses _sort=-date in its FHIR query; mirror
// that here so the perceived ordering stays the same).
\usort($observations, static function ($a, $b) {
    $ad = $a['effectiveDateTime'] ?? '';
    $bd = $b['effectiveDateTime'] ?? '';
    return \strcmp((string) $bd, (string) $ad);
});

\agentforge_emit_json(200, [
    'resourceType' => 'Bundle',
    'type' => 'searchset',
    'total' => \count($observations),
    'entry' => \array_map(static fn($r) => ['resource' => $r], $observations),
]);
