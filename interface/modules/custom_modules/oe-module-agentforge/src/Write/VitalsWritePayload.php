<?php

/**
 * PRD §4.7.4-style vitals payload — maps to EncounterService validateVital/insertVital row shape.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class VitalsWritePayload
{
    private const ALLOWED = ['bp', 'hr', 'temp', 'pain', 'weight_lb', 'height_in'];

    private function __construct(
        private readonly ?string $bps,
        private readonly ?string $bpd,
        private readonly ?string $pulse,
        private readonly ?string $temperature,
        private readonly ?string $weightLb,
        private readonly ?string $heightIn,
        private readonly ?string $painNoteSuffix,
    ) {
    }

    /**
     * @param array<mixed, mixed>|null $payload
     *
     * @return array{0: self|null, 1: 'unsupported_payload'|'invalid_vitals'|null}
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

        $bps = null;
        $bpd = null;

        $bpPresent = array_key_exists('bp', $payload);
        $hrPresent = array_key_exists('hr', $payload);
        $tempPresent = array_key_exists('temp', $payload);
        $painPresent = array_key_exists('pain', $payload);
        $weightPresent = array_key_exists('weight_lb', $payload);
        $heightPresent = array_key_exists('height_in', $payload);

        if (!$bpPresent && !$hrPresent && !$tempPresent && !$painPresent && !$weightPresent && !$heightPresent) {
            return [null, 'invalid_vitals'];
        }

        if ($bpPresent) {
            $bpRaw = $payload['bp'];
            if (!is_string($bpRaw)) {
                return [null, 'invalid_vitals'];
            }

            $bpRaw = trim($bpRaw);
            if ($bpRaw !== '' && !preg_match('#^(\d+)\s*/\s*(\d+)$#', $bpRaw, $m)) {
                return [null, 'invalid_vitals'];
            }

            if ($bpRaw !== '') {
                $bps = $m[1];
                $bpd = $m[2];
            }
        }

        $pulse = null;
        if ($hrPresent) {
            $hrParsed = self::nonNegNumberToStringOrNull($payload['hr']);
            if ($hrParsed === false) {
                return [null, 'invalid_vitals'];
            }

            $pulse = $hrParsed;
        }

        $temp = null;
        if ($tempPresent) {
            $tParsed = self::nonNegNumberToStringOrNull($payload['temp']);
            if ($tParsed === false) {
                return [null, 'invalid_vitals'];
            }

            $temp = $tParsed;
        }

        $weight = null;
        if ($weightPresent) {
            $wParsed = self::nonNegNumberToStringOrNull($payload['weight_lb']);
            if ($wParsed === false) {
                return [null, 'invalid_vitals'];
            }

            $weight = $wParsed;
        }

        $height = null;
        if ($heightPresent) {
            $hParsed = self::nonNegNumberToStringOrNull($payload['height_in']);
            if ($hParsed === false) {
                return [null, 'invalid_vitals'];
            }

            $height = $hParsed;
        }

        $painSuffix = null;
        if ($painPresent) {
            $pRaw = $payload['pain'];
            if (!is_int($pRaw) && !is_float($pRaw) && !is_string($pRaw)) {
                return [null, 'invalid_vitals'];
            }

            if (is_string($pRaw)) {
                $trim = trim($pRaw);
                if ($trim === '') {
                    return [null, 'invalid_vitals'];
                }

                $filtered = filter_var($trim, FILTER_VALIDATE_FLOAT);
                if ($filtered === false) {
                    return [null, 'invalid_vitals'];
                }

                $pFloat = (float) $filtered;
            } else {
                $pFloat = (float) $pRaw;
            }

            if ($pFloat < 0 || $pFloat > 10) {
                return [null, 'invalid_vitals'];
            }

            $painSuffix = 'Pain score: ' . self::normalizeDecimalDisplay($pFloat);
        }

        if ($bps === null && $bpd === null && $pulse === null && $temp === null && $weight === null && $height === null && $painSuffix === null) {
            return [null, 'invalid_vitals'];
        }

        return [new self($bps, $bpd, $pulse, $temp, $weight, $height, $painSuffix), null];
    }

    /**
     * @return array<string, string|int|float>
     */
    public function toEncounterInsertRow(string $authUsername, string $authProvider): array
    {
        $group = $authProvider !== '' ? $authProvider : 'Default';
        $row = [
            'user' => $authUsername,
            'groupname' => $group,
        ];

        if ($this->bps !== null) {
            $row['bps'] = $this->bps;
        }

        if ($this->bpd !== null) {
            $row['bpd'] = $this->bpd;
        }

        if ($this->pulse !== null) {
            $row['pulse'] = $this->pulse;
        }

        if ($this->temperature !== null) {
            $row['temperature'] = $this->temperature;
        }

        if ($this->weightLb !== null) {
            $row['weight'] = $this->weightLb;
        }

        if ($this->heightIn !== null) {
            $row['height'] = $this->heightIn;
        }

        if ($this->painNoteSuffix !== null) {
            $note = $this->painNoteSuffix;
            if (strlen($note) > 255) {
                $note = substr($note, 0, 255);
            }

            $row['note'] = $note;
        }

        return $row;
    }

    private static function nonNegNumberToStringOrNull(mixed $v): string|false
    {
        if (!is_string($v) && !is_int($v) && !is_float($v)) {
            return false;
        }

        if (is_string($v)) {
            $v = trim($v);
            if ($v === '') {
                return false;
            }

            $flt = filter_var($v, FILTER_VALIDATE_FLOAT);
            if ($flt === false) {
                return false;
            }

            $n = (float) $flt;
            if ($n < 0) {
                return false;
            }

            return self::normalizeDecimalDisplay($n);
        }

        $n = (float) $v;
        if ($n < 0) {
            return false;
        }

        return self::normalizeDecimalDisplay($n);
    }

    /**
     * @return string FormVitals + validateVital accept numeric strings / scalars.
     */
    private static function normalizeDecimalDisplay(float $n): string
    {
        if (abs($n - round($n)) < 0.000001) {
            return (string) (int) round($n);
        }

        return rtrim(rtrim(sprintf('%.4f', $n), '0'), '.');
    }
}
