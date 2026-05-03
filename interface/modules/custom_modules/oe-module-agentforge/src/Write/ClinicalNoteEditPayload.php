<?php

/**
 * Strict clinical-note edit payload — supports `update` (replace description) and
 * `delete` (soft-delete via activity = 0). Both actions target a specific note row
 * by UUID; the encounter id ensures we only edit notes that belong to the active visit.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class ClinicalNoteEditPayload
{
    public const ACTION_UPDATE = 'update';
    public const ACTION_DELETE = 'delete';

    /**
     * @param array<mixed,mixed>|null $payload
     *
     * @return array{0: ClinicalNoteEditPayload|null, 1:'unsupported_payload'|'invalid_action'|'missing_uuid'|'missing_text'|null}
     */
    public static function parse(?array $payload): array
    {
        if (!\is_array($payload)) {
            return [null, 'unsupported_payload'];
        }

        $allowedKeys = ['action', 'note_uuid', 'text'];
        $unknownKeys = \array_diff(\array_keys($payload), $allowedKeys);
        if ($unknownKeys !== []) {
            return [null, 'unsupported_payload'];
        }

        $actionRaw = $payload['action'] ?? null;
        if (!\is_string($actionRaw)) {
            return [null, 'invalid_action'];
        }
        $action = $actionRaw;
        if ($action !== self::ACTION_UPDATE && $action !== self::ACTION_DELETE) {
            return [null, 'invalid_action'];
        }

        $uuidRaw = $payload['note_uuid'] ?? null;
        if (!\is_string($uuidRaw) || \trim($uuidRaw) === '') {
            return [null, 'missing_uuid'];
        }
        $noteUuid = \strtolower(\trim($uuidRaw));

        $text = '';
        if ($action === self::ACTION_UPDATE) {
            $textRaw = $payload['text'] ?? null;
            if (!\is_string($textRaw)) {
                return [null, 'missing_text'];
            }
            $text = \trim($textRaw);
            if ($text === '') {
                return [null, 'missing_text'];
            }
            if (\strlen($text) > 32768) {
                return [null, 'unsupported_payload'];
            }
        } else {
            // delete must not carry text
            if (\array_key_exists('text', $payload) && $payload['text'] !== null && $payload['text'] !== '') {
                return [null, 'unsupported_payload'];
            }
        }

        return [new self($action, $noteUuid, $text), null];
    }

    private function __construct(
        private readonly string $action,
        private readonly string $noteUuid,
        private readonly string $text
    ) {
    }

    public function action(): string
    {
        return $this->action;
    }

    public function noteUuid(): string
    {
        return $this->noteUuid;
    }

    public function text(): string
    {
        return $this->text;
    }

    public function isUpdate(): bool
    {
        return $this->action === self::ACTION_UPDATE;
    }

    public function isDelete(): bool
    {
        return $this->action === self::ACTION_DELETE;
    }
}
