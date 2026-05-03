<?php

/**
 * Strict clinical-note write payload — only `{ "text": "..." }` is in scope.
 *
 * The text is appended to the canonical physician progress-note row for the encounter
 * (or seeds it if no row exists). Routing/section logic stays out of this payload by design;
 * the agent supplies prose and the write action decides where it lands.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class ClinicalNoteWritePayload
{
    /**
     * @param array<mixed,mixed>|null $payload
     *
     * @return array{0: ClinicalNoteWritePayload|null, 1:'unsupported_payload'|'empty_text'|null}
     */
    public static function parse(?array $payload): array
    {
        if (!\is_array($payload)) {
            return [null, 'unsupported_payload'];
        }

        $unknownKeys = \array_diff(\array_keys($payload), ['text']);
        if ($unknownKeys !== []) {
            return [null, 'unsupported_payload'];
        }

        if (!\array_key_exists('text', $payload)) {
            return [null, 'unsupported_payload'];
        }

        $text = $payload['text'];
        if (!\is_string($text)) {
            return [null, 'unsupported_payload'];
        }

        $text = \trim($text);
        if ($text === '') {
            return [null, 'empty_text'];
        }

        if (\strlen($text) > 32768) {
            return [null, 'unsupported_payload'];
        }

        return [new self($text), null];
    }

    private function __construct(
        private readonly string $text
    ) {
    }

    public function text(): string
    {
        return $this->text;
    }
}
