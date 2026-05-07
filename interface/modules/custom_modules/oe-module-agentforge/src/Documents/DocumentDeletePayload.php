<?php

/**
 * G2-Early-24 — document soft-delete payload parser.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class DocumentDeletePayload
{
    private const KEYS = ['docref_uuid'];

    private function __construct(
        private readonly string $docrefUuid,
    ) {
    }

    /**
     * @param array<mixed, mixed>|null $payload
     *
     * @return array{0: ?self, 1: ?string}
     */
    public static function parse(?array $payload): array
    {
        if ($payload === null) {
            return [null, 'unsupported_payload'];
        }

        foreach ($payload as $k => $_) {
            if (!is_string($k)) {
                return [null, 'unsupported_payload'];
            }
        }

        $unknownKeys = array_diff(array_keys($payload), self::KEYS);
        if ($unknownKeys !== []) {
            return [null, 'unsupported_payload'];
        }

        if (!isset($payload['docref_uuid']) || !is_string($payload['docref_uuid'])) {
            return [null, 'missing_uuid'];
        }

        $candidate = trim($payload['docref_uuid']);
        $normalized = self::normalizeUuid($candidate);
        if ($normalized === null) {
            return [null, 'missing_uuid'];
        }

        return [new self($normalized), null];
    }

    public function docrefUuid(): string
    {
        return $this->docrefUuid;
    }

    private static function normalizeUuid(string $uuid): ?string
    {
        if (preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
            $uuid,
        )) {
            return strtolower($uuid);
        }

        return null;
    }
}
