<?php

/**
 * W2 intake-bundle — medical problem add payload parser.
 *
 * Accepts the schema-driven set of problem-list fields the intake extraction
 * can populate. Mirrors the MedicationAddPayload parse contract: returns
 * `[?MedicalProblemAddPayload, ?string]` where the string is one of
 * `unsupported_payload` (unknown keys / wrong types) or `invalid_payload`
 * (required field missing / format violation).
 *
 * Field mapping (problem schema → `lists` columns):
 *   condition   → lists.title         (required, 2..255 chars)
 *   onset_date  → lists.begdate       (optional, ISO YYYY-MM-DD)
 *   status      → lists.activity      (optional, defaults to 'active')
 *   comments    → lists.comments      (optional, free-text qualifier)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class MedicalProblemAddPayload
{
    private const KEYS = ['condition', 'onset_date', 'status', 'comments'];
    private const VALID_STATUSES = ['active', 'inactive', 'resolved'];

    private function __construct(
        private readonly string $condition,
        private readonly ?string $onsetDate,
        private readonly string $status,
        private readonly ?string $comments,
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

        if (!isset($payload['condition']) || !is_string($payload['condition'])) {
            return [null, 'invalid_payload'];
        }

        $condition = trim($payload['condition']);
        if ($condition === '' || strlen($condition) < 2 || strlen($condition) > 255) {
            return [null, 'invalid_payload'];
        }

        $onsetDate = self::optionalIsoDate($payload, 'onset_date');
        if ($onsetDate === false) {
            return [null, 'invalid_payload'];
        }

        $status = 'active';
        if (array_key_exists('status', $payload) && $payload['status'] !== null) {
            $rawStatus = $payload['status'];
            if (!is_string($rawStatus)) {
                return [null, 'invalid_payload'];
            }
            $statusTrimmed = strtolower(trim($rawStatus));
            if (!in_array($statusTrimmed, self::VALID_STATUSES, true)) {
                return [null, 'invalid_payload'];
            }
            $status = $statusTrimmed;
        }

        $comments = self::optionalString($payload, 'comments', 4000);
        if ($comments === false) {
            return [null, 'invalid_payload'];
        }

        return [new self($condition, $onsetDate, $status, $comments), null];
    }

    public function condition(): string
    {
        return $this->condition;
    }

    public function onsetDate(): ?string
    {
        return $this->onsetDate;
    }

    /** @return 'active'|'inactive'|'resolved' */
    public function status(): string
    {
        return $this->status;
    }

    public function comments(): ?string
    {
        return $this->comments;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return string|null|false `false` indicates a type violation.
     */
    private static function optionalString(array $payload, string $key, int $maxLength): string|null|false
    {
        if (!array_key_exists($key, $payload)) {
            return null;
        }
        $value = $payload[$key];
        if ($value === null) {
            return null;
        }
        if (!is_string($value)) {
            return false;
        }
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }
        if (strlen($trimmed) > $maxLength) {
            return false;
        }
        return $trimmed;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return string|null|false `false` = format violation.
     */
    private static function optionalIsoDate(array $payload, string $key): string|null|false
    {
        $raw = self::optionalString($payload, $key, 10);
        if ($raw === false || $raw === null) {
            return $raw;
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) !== 1) {
            return false;
        }
        return $raw;
    }
}
