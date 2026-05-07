<?php

/**
 * G2-Final-FB-B-01 — observation persistence from a verified VLM extraction.
 *
 * Receives `(session_token, patient_uuid, docref_uuid, results[])` from the
 * agentforge-api after `attach_and_extract` returns with
 * `crossCheckStatus === 'verified'`. Iterates the lab results and calls
 * `ObservationWriter::upsert()` per row using the already-shipped
 * idempotency contract `(patient_uuid, docref_uuid, extraction_field_path)`.
 *
 * **Direct call to ObservationWriter** — does NOT route through the cut
 * `ClinicalNoteWriteAction.execute()` path that swallowed the underlying
 * exception in W2-D1. Per-row errors are aggregated into the response so
 * the caller can surface partial-failure to the chat.
 *
 * Refusal contract (S2 carve-out, see Documentation/AgentForge/implementation/FEEDBACK.md §2.2):
 * facts derived from a clinician-uploaded document with cross-check
 * verification are the brief's "ingestion" path, not a structured-edit
 * proposal — no Confirm/Reject gate. The audit row + DocumentReference
 * `derivedFrom` provenance is the safety surface here.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);
agentforge_require_post();

use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Modules\AgentForge\Documents\AgentAuditDocumentSink;
use OpenEMR\Modules\AgentForge\Documents\ObservationWriter;
use OpenEMR\Modules\AgentForge\Documents\OpenEmrObservationWriteAdapter;

$body = agentforge_json_input();
$sessionToken = isset($body['session_token']) && is_string($body['session_token']) ? trim($body['session_token']) : '';
$patientUuid = isset($body['patient_uuid']) && is_string($body['patient_uuid']) ? trim($body['patient_uuid']) : '';
$docrefUuid = isset($body['docref_uuid']) && is_string($body['docref_uuid']) ? trim($body['docref_uuid']) : '';
$resultsRaw = $body['results'] ?? null;

$correlationId = agentforge_incoming_correlation_id();

if ($sessionToken === '' || $patientUuid === '' || $docrefUuid === '' || !is_array($resultsRaw)) {
    agentforge_emit_json(400, ['error' => 'invalid_request', 'correlation_id' => $correlationId]);
}

if (count($resultsRaw) === 0) {
    agentforge_emit_json(400, ['error' => 'no_results', 'correlation_id' => $correlationId]);
}

try {
    $ctx = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
} catch (ChartContextAuthorizationException $e) {
    agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
}

if (!AclMap::userPassesAgentForgeProposeWriteGate($ctx['auth_user'])) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $ctx['pid'] > 0 ? $ctx['pid'] : null,
        'write_attempt',
        'observation_from_extraction',
        $correlationId,
        false,
        ['reason' => 'acl_denied'],
        'acl_denied',
    );
    agentforge_emit_json(403, ['error' => 'acl_denied', 'correlation_id' => $correlationId]);
}

$pid = $ctx['pid'];
if ($pid <= 0) {
    agentforge_emit_json(403, ['error' => 'active_chart_mismatch', 'correlation_id' => $correlationId]);
}

$storageRoot = \dirname(__DIR__, 5) . '/sites/default/documents/agentforge_w2/_obs';
$port = new OpenEmrObservationWriteAdapter($storageRoot);
$audit = new AgentAuditDocumentSink();
$writer = new ObservationWriter($port, $audit);

$inserted = 0;
$updated = 0;
$failed = [];

foreach ($resultsRaw as $i => $row) {
    if (!is_array($row)) {
        $failed[] = ['index' => $i, 'reason' => 'invalid_row'];
        continue;
    }

    $fieldPath = sprintf('extraction.results[%d].value', $i);

    try {
        $isInsert = $writer->upsert(
            $ctx['auth_user'],
            $ctx['auth_provider'],
            $pid,
            $patientUuid,
            $docrefUuid,
            $fieldPath,
            $correlationId,
            $row,
        );
        if ($isInsert) {
            $inserted++;
        } else {
            $updated++;
        }
    } catch (\Throwable $e) {
        // Per-row failure is aggregated; the caller surfaces partial-failure
        // to the chat. We never embed exception messages in the response
        // body (S6) — only the field path and a generic reason.
        AgentAuditLogger::recordAgentEvent(
            $ctx['auth_user'],
            $ctx['auth_provider'],
            $pid,
            'write_rejected',
            'observation_from_extraction',
            $correlationId,
            false,
            ['field_path' => $fieldPath, 'reason' => 'persistence_error'],
            'persistence_error',
        );
        $failed[] = ['index' => $i, 'reason' => 'persistence_error'];
    }
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid,
    'write_apply',
    'observation_from_extraction',
    $correlationId,
    count($failed) === 0,
    [
        'docref_uuid' => $docrefUuid,
        'inserted' => $inserted,
        'updated' => $updated,
        'failed_count' => count($failed),
    ],
);

agentforge_emit_json(200, [
    'ok' => true,
    'inserted' => $inserted,
    'updated' => $updated,
    'failed' => $failed,
    'correlation_id' => $correlationId,
]);
