<?php

/**
 * PRD-aligned smoking status propose-write payload mapped to HIS `history_data.tobacco` pipe encoding.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

/**
 * Accepts strictly `never_smoker|former_smoker|current_every_day|current_some_day|unknown`.
 * Stored string matches SmokingStatusType encoding: note|radio|YYYYMMDD|smoking_status list option_id|packs.
 */
final class TobaccoWritePayload
{
    private const KEYS = ['status'];

    /** @var list<string> */
    private const STATUS_ENUM = ['never_smoker', 'former_smoker', 'current_every_day', 'current_some_day', 'unknown'];

    /** @var array<string, string> OpenEMR default `smoking_status` option_id */
    private const LIST_ID = [
        'current_every_day' => '1',
        'current_some_day' => '2',
        'former_smoker' => '3',
        'never_smoker' => '4',
        'unknown' => '9',
    ];

    private function __construct(private readonly string $status)
    {
    }

    /**
     * @param array<mixed, mixed>|null $payload
     *
     * @return array{0: ?self, 1: ?string} Second element null on success or error code otherwise.
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

        if (!array_key_exists('status', $payload)) {
            return [null, 'unsupported_payload'];
        }

        $rawStatus = $payload['status'];
        if (!is_string($rawStatus)) {
            return [null, 'invalid_tobacco_status'];
        }

        $status = $rawStatus;
        if ($status === '' || !in_array($status, self::STATUS_ENUM, true)) {
            return [null, 'invalid_tobacco_status'];
        }

        return [new self($status), null];
    }

    public function status(): string
    {
        return $this->status;
    }

    /** Pipe-delimited HIS tobacco field (@see SmokingStatusType::getValueFromRequest). */
    public function toHistoryDataTobaccoValue(): string
    {
        $listId = self::LIST_ID[$this->status];
        $restype = match ($this->status) {
            'never_smoker' => 'nevertobacco',
            'former_smoker' => 'quittobacco',
            'current_every_day', 'current_some_day' => 'currenttobacco',
            'unknown' => '0',
        };

        $note = '';
        $date = '';
        $packs = '0';

        return implode('|', [$note, $restype, $date, $listId, $packs]);
    }
}
