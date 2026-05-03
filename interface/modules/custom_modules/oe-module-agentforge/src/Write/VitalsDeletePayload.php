<?php

/**
 * Payload parser for UC-B vitals soft-delete (PRD §4.7.4 — void erroneous vitals).
 * Single field: vitals_uuid (the form_vitals row UUID returned by get_vitals).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class VitalsDeletePayload
{
    private const ALLOWED = ['vitals_uuid'];

    private function __construct(
        private readonly string $vitalsUuid,
    ) {
    }

    public function vitalsUuid(): string
    {
        return $this->vitalsUuid;
    }

    /**
     * @param array<mixed, mixed>|null $payload
     *
     * @return array{0: self|null, 1: 'unsupported_payload'|'missing_uuid'|null}
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

        $unknownKeys = array_diff(array_keys($payload), self::ALLOWED);
        if ($unknownKeys !== []) {
            return [null, 'unsupported_payload'];
        }

        $raw = $payload['vitals_uuid'] ?? null;
        if (!is_string($raw)) {
            return [null, 'missing_uuid'];
        }

        $trim = strtolower(trim($raw));
        if ($trim === '') {
            return [null, 'missing_uuid'];
        }

        return [new self($trim), null];
    }
}
