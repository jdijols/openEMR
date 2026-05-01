<?php

/**
 * Context Service — document / note metadata only (PRD §4.4–§4.5).
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
use OpenEMR\Services\DocumentService;
use OpenEMR\Services\Search\TokenSearchField;

$ingress = agentforge_context_service_ingress('notes_metadata');
$ctx = $ingress['ctx'];
$correlationId = $ingress['correlation_id'];
$pid = $ingress['pid'];

if ($pid <= 0) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        null,
        'context_read',
        'notes_metadata',
        $correlationId,
        false,
        ['reason' => 'not_found'],
    );
    agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
}

$svc = new DocumentService();
$pr = $svc->search(
    [
        'foreign_id' => new TokenSearchField('foreign_id', [(string) $pid]),
        'deleted' => new TokenSearchField('deleted', ['0']),
    ],
    true,
    ['limit' => $ingress['window_limit'], 'order' => '`docs`.`date` DESC']
);

if (!$pr->isValid()) {
    AgentAuditLogger::recordAgentEvent(
        $ctx['auth_user'],
        $ctx['auth_provider'],
        $pid,
        'context_read',
        'notes_metadata',
        $correlationId,
        false,
        ['reason' => 'service_invalid'],
    );
    agentforge_emit_json(500, ['error' => 'internal_error', 'correlation_id' => $correlationId]);
}

$out = [];
$rows = $pr->getData();
if (\is_array($rows)) {
    foreach ($rows as $raw) {
        if (!\is_array($raw)) {
            continue;
        }

        $docIdRaw = $raw['id'] ?? null;
        $docId = \is_int($docIdRaw) ? $docIdRaw : (\is_numeric($docIdRaw) ? (int) $docIdRaw : 0);

        $uuidStr = '';
        if (\is_string($raw['uuid'] ?? null)) {
            $uuidStr = agentforge_normalize_uuid_payload($raw['uuid']);
        }

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

        $mimetype = \is_string($raw['mimetype'] ?? null) ? $raw['mimetype'] : '';

        // proxy for “size” — no raw body; length heuristic from name/category only
        $name = \is_string($raw['name'] ?? null) ? $raw['name'] : '';
        $pseudoLen = \strlen($name) + \strlen($mimetype);
        $out[] = [
            'title' => $name,
            'document_date' => $dateStr,
            'mime_type' => $mimetype,
            'category' => \is_string($raw['category_name'] ?? null) ? $raw['category_name'] : '',
            'encounter_id' => isset($raw['encounter_id']) ? (int) $raw['encounter_id'] : 0,
            'approx_metadata_bytes' => $pseudoLen,
            'source_pack' => SourcePackFactory::note(
                $docId > 0 ? $docId : \max(1, \abs(\crc32($uuidStr !== '' ? $uuidStr : $name))),
                $uuidStr !== '' ? $uuidStr : ('note-' . (string) $docId),
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
    'notes_metadata',
    $correlationId,
    true,
    []
);

agentforge_emit_json(200, [
    'ok' => true,
    'data' => $out,
    'correlation_id' => $correlationId,
]);
