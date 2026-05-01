<?php

/**
 * Strict chief-complaint write payload — only `{ "reason": "..." }` is in scope (PRD §4.7.1).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class ChiefComplaintPayload
{
    /**
     * @param array<mixed,mixed>|null $payload
     *
     * @return array{0: ChiefComplaintPayload|null, 1:'unsupported_payload'|'empty_reason'|null}
     */
    public static function parse(?array $payload): array
    {
        if (!\is_array($payload)) {
            return [null, 'unsupported_payload'];
        }

        $unknownKeys = \array_diff(\array_keys($payload), ['reason']);
        if ($unknownKeys !== []) {
            return [null, 'unsupported_payload'];
        }

        if (!\array_key_exists('reason', $payload)) {
            return [null, 'unsupported_payload'];
        }

        $reason = $payload['reason'];
        if (!\is_string($reason)) {
            return [null, 'unsupported_payload'];
        }

        $reason = \trim($reason);
        if ($reason === '') {
            return [null, 'empty_reason'];
        }

        if (\strlen($reason) > 32768) {
            return [null, 'unsupported_payload'];
        }

        return [new self($reason), null];
    }

    private function __construct(
        private readonly string $reason
    ) {
    }

    public function reason(): string
    {
        return $this->reason;
    }
}
