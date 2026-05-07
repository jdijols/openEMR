<?php

/**
 * G2-Final-11 — partial demographics update payload parser.
 *
 * Accepts an arbitrary subset of fields from the supported allowlist; rejects unknown keys.
 * Each field is normalized to its canonical patient_data column on parse so the adapter
 * gets a `column_name => trimmed_value` map ready to bind into UPDATE.
 *
 * Allowed fields:
 *   first_name, last_name, middle_name → fname / lname / mname
 *   dob                                → DOB (YYYY-MM-DD only; rejects partial dates)
 *   sex                                → sex (one of Male / Female / Unknown — OpenEMR option list)
 *   contact_phone                      → phone_cell (the primary mobile contact)
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class DemographicsUpdatePayload
{
    private const ALLOWED_KEYS = [
        'first_name',
        'last_name',
        'middle_name',
        'dob',
        'sex',
        'contact_phone',
    ];

    /** @var array<string, non-empty-string> */
    private const KEY_TO_COLUMN = [
        'first_name' => 'fname',
        'last_name' => 'lname',
        'middle_name' => 'mname',
        'dob' => 'DOB',
        'sex' => 'sex',
        'contact_phone' => 'phone_cell',
    ];

    /** @var list<string> */
    private const ALLOWED_SEX = ['Male', 'Female', 'Unknown'];

    /**
     * @param array<non-empty-string, string> $columnPatch
     */
    private function __construct(
        private readonly array $columnPatch,
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

        $unknownKeys = array_diff(array_keys($payload), self::ALLOWED_KEYS);
        if ($unknownKeys !== []) {
            return [null, 'unsupported_payload'];
        }

        if ($payload === []) {
            return [null, 'invalid_payload'];
        }

        $columnPatch = [];

        foreach (self::ALLOWED_KEYS as $key) {
            if (!array_key_exists($key, $payload)) {
                continue;
            }

            $value = $payload[$key];
            if (!is_string($value)) {
                return [null, 'invalid_payload'];
            }

            $trimmed = trim($value);
            if ($trimmed === '') {
                return [null, 'invalid_payload'];
            }

            if ($key === 'dob') {
                if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) !== 1) {
                    return [null, 'invalid_payload'];
                }
            } elseif ($key === 'sex') {
                if (!\in_array($trimmed, self::ALLOWED_SEX, true)) {
                    return [null, 'invalid_payload'];
                }
            } else {
                if (\strlen($trimmed) > 255) {
                    return [null, 'invalid_payload'];
                }
            }

            $column = self::KEY_TO_COLUMN[$key];
            $columnPatch[$column] = $trimmed;
        }

        if ($columnPatch === []) {
            return [null, 'invalid_payload'];
        }

        return [new self($columnPatch), null];
    }

    /** @return array<non-empty-string, string> */
    public function columnPatch(): array
    {
        return $this->columnPatch;
    }
}
