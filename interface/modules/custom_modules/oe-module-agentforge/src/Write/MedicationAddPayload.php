<?php

/**
 * G2-Early-20 + schema-expansion — medication add payload parser.
 *
 * Accepts the schema-driven set of medication fields the intake extraction can populate.
 * The dispatch maps field → `lists` / `lists_medication` columns:
 *   name        → lists.title
 *   dose        → folded into lists.comments composite (with frequency + sig)
 *   frequency   → folded into lists.comments composite
 *   sig         → folded into lists.comments composite (and would map to
 *                 lists_medication.drug_dosage_instructions on a future upgrade)
 *   indication  → lists.diagnosis
 *   begdate     → lists.begdate (ISO YYYY-MM-DD)
 *   enddate     → lists.enddate (ISO YYYY-MM-DD)
 *
 * Mirrors the AllergyWritePayload parse contract: returns `[?MedicationAddPayload, ?string]`
 * where the string is one of `unsupported_payload` / `invalid_payload`.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class MedicationAddPayload
{
    private const KEYS = ['name', 'dose', 'frequency', 'sig', 'indication', 'begdate', 'enddate'];

    private function __construct(
        private readonly string $name,
        private readonly ?string $dose,
        private readonly ?string $frequency,
        private readonly ?string $sig,
        private readonly ?string $indication,
        private readonly ?string $begdate,
        private readonly ?string $enddate,
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

        if (!isset($payload['name']) || !is_string($payload['name'])) {
            return [null, 'invalid_payload'];
        }

        $name = trim($payload['name']);
        if ($name === '' || strlen($name) < 2 || strlen($name) > 255) {
            return [null, 'invalid_payload'];
        }

        $dose = self::optionalString($payload, 'dose', 1024);
        if ($dose === false) {
            return [null, 'invalid_payload'];
        }

        $frequency = self::optionalString($payload, 'frequency', 1024);
        if ($frequency === false) {
            return [null, 'invalid_payload'];
        }

        $sig = self::optionalString($payload, 'sig', 4000);
        if ($sig === false) {
            return [null, 'invalid_payload'];
        }

        $indication = self::optionalString($payload, 'indication', 255);
        if ($indication === false) {
            return [null, 'invalid_payload'];
        }

        $begdate = self::optionalIsoDate($payload, 'begdate');
        if ($begdate === false) {
            return [null, 'invalid_payload'];
        }

        $enddate = self::optionalIsoDate($payload, 'enddate');
        if ($enddate === false) {
            return [null, 'invalid_payload'];
        }

        return [new self($name, $dose, $frequency, $sig, $indication, $begdate, $enddate), null];
    }

    public function name(): string
    {
        return $this->name;
    }

    /** lists.diagnosis — what condition the medication treats. */
    public function indication(): ?string
    {
        return $this->indication;
    }

    /** ISO YYYY-MM-DD or null. lists.begdate. */
    public function begdate(): ?string
    {
        return $this->begdate;
    }

    /** ISO YYYY-MM-DD or null. lists.enddate. */
    public function enddate(): ?string
    {
        return $this->enddate;
    }

    /**
     * Composed `comments` body — preserves dose / frequency / sig as a human-readable line
     * since the demo flow doesn't yet write the `lists_medication` metadata table. The sig
     * is dropped from this composite when it's the same string as `dose · frequency` (common
     * intake-form duplication: dose+frequency IS the sig).
     */
    public function commentsBody(): ?string
    {
        $parts = [];
        if ($this->dose !== null && $this->dose !== '') {
            $parts[] = $this->dose;
        }

        if ($this->frequency !== null && $this->frequency !== '') {
            $parts[] = $this->frequency;
        }

        $shortComposite = implode(' · ', $parts);

        if ($this->sig !== null && $this->sig !== '' && $this->sig !== $shortComposite) {
            $parts[] = 'sig: ' . $this->sig;
        }

        if ($parts === []) {
            return null;
        }

        return implode(' · ', $parts);
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return string|null|false `false` indicates a type violation (caller maps to invalid_payload).
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
     * @return string|null|false `false` = format violation (caller maps to invalid_payload).
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
