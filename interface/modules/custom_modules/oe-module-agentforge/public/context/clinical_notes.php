<?php

/**
 * Context Service — clinical note bodies (form_clinical_notes) with citation packs.
 *
 * Distinct from notes_metadata.php (which exposes DocumentService rows): this endpoint
 * surfaces narrative content authored via the Clinical Notes Form so the agent can
 * answer questions about MA intake notes, physician progress notes, etc.
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
use OpenEMR\Services\ClinicalNotesService;

const AGENTFORGE_CLINICAL_NOTE_BODY_CAP = 4000;

$ingress = agentforge_context_service_ingress('clinical_notes');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'clinical_notes',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

try {
    $svc = new ClinicalNotesService();
    $rows = $svc->getActiveClinicalNotesForPatient($pid, $ingress['window_limit']);
} catch (\Throwable) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'clinical_notes',
        $correlationId,
        false,
        ['reason' => 'service_error'],
    );
    agentforge_emit_json(500, ['error' => 'internal_error', 'correlation_id' => $correlationId]);
}

$out = [];
foreach ($rows as $raw) {
    if (!\is_array($raw)) {
        continue;
    }

    $noteIdRaw = $raw['id'] ?? null;
    $noteId = \is_int($noteIdRaw) ? $noteIdRaw : (\is_numeric($noteIdRaw) ? (int) $noteIdRaw : 0);
    if ($noteId <= 0) {
        continue;
    }

    $uuidStr = '';
    if (\is_string($raw['uuid'] ?? null)) {
        $uuidStr = agentforge_normalize_uuid_payload($raw['uuid']);
    }
    if ($uuidStr === '') {
        $uuidStr = 'clinical-note-' . (string) $noteId;
    }

    $encounterRaw = $raw['encounter'] ?? null;
    $encounterId = \is_int($encounterRaw) ? $encounterRaw : (\is_numeric($encounterRaw) ? (int) $encounterRaw : 0);

    $dateStr = isset($raw['date']) ? (string) $raw['date'] : '';
    $lastUpdatedStr = isset($raw['last_updated']) ? (string) $raw['last_updated'] : '';
    $asOfSource = $lastUpdatedStr !== '' ? $lastUpdatedStr : $dateStr;

    $asOf = new \DateTimeImmutable('now');
    if ($asOfSource !== '') {
        $parsed = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $asOfSource);
        if ($parsed === false) {
            $parsed = \DateTimeImmutable::createFromFormat('Y-m-d', $asOfSource);
        }

        if ($parsed instanceof \DateTimeImmutable) {
            $asOf = $parsed;
        }
    }

    $description = \is_string($raw['description'] ?? null) ? $raw['description'] : '';
    $truncated = false;
    $originalLen = \strlen($description);
    if ($originalLen > AGENTFORGE_CLINICAL_NOTE_BODY_CAP) {
        $description = \substr($description, 0, AGENTFORGE_CLINICAL_NOTE_BODY_CAP);
        $truncated = true;
    }

    $out[] = [
        'note_id' => $noteId,
        'uuid' => $uuidStr,
        'encounter_id' => $encounterId,
        'note_date' => $dateStr,
        'last_updated' => $lastUpdatedStr,
        'encounter_date' => \is_string($raw['encounter_date'] ?? null) ? $raw['encounter_date'] : '',
        'author_username' => \is_string($raw['user'] ?? null) ? $raw['user'] : '',
        'note_type' => \is_string($raw['clinical_notes_type'] ?? null) ? $raw['clinical_notes_type'] : '',
        'note_type_title' => \is_string($raw['type_title'] ?? null) ? $raw['type_title'] : '',
        'note_category' => \is_string($raw['clinical_notes_category'] ?? null) ? $raw['clinical_notes_category'] : '',
        'note_category_title' => \is_string($raw['category_title'] ?? null) ? $raw['category_title'] : '',
        'codetext' => \is_string($raw['codetext'] ?? null) ? $raw['codetext'] : '',
        'description' => $description,
        'description_truncated' => $truncated,
        'description_original_length' => $originalLen,
        'source_pack' => SourcePackFactory::clinicalNote($noteId, $uuidStr, $encounterId, $asOf),
    ];
}

AgentAuditLogger::recordAgentEvent(
    $ctx['auth_user'],
    $ctx['auth_provider'],
    $pid,
    'context_read',
    'clinical_notes',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
