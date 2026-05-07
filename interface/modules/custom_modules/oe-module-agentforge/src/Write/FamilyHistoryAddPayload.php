<?php

/**
 * G2-Early-23 — family history add payload parser.
 *
 * Maps an LLM-friendly `relation` token to the canonical `history_data` column name. The
 * accepted relations cover the 5 columns the OpenEMR UI surfaces in the History form:
 *   mother → history_mother
 *   father → history_father
 *   sibling | brother | sister → history_siblings
 *   offspring | son | daughter | child → history_offspring
 *   spouse | partner → history_spouse
 *
 * Anything outside this set is rejected at parse time as `unsupported_payload` — we keep the
 * surface tight rather than fanning into the `relatives_*` boolean columns (which target a
 * different UX in the History form layout).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class FamilyHistoryAddPayload
{
    private const KEYS = ['relation', 'condition', 'age_of_onset', 'deceased'];

    /** @var array<string, non-empty-string> */
    private const RELATION_TO_COLUMN = [
        'mother' => 'history_mother',
        'father' => 'history_father',
        'sibling' => 'history_siblings',
        'brother' => 'history_siblings',
        'sister' => 'history_siblings',
        'offspring' => 'history_offspring',
        'son' => 'history_offspring',
        'daughter' => 'history_offspring',
        'child' => 'history_offspring',
        'spouse' => 'history_spouse',
        'partner' => 'history_spouse',
    ];

    /**
     * @param non-empty-string $columnName
     */
    private function __construct(
        private readonly string $relation,
        private readonly string $columnName,
        private readonly string $condition,
        private readonly ?string $ageOfOnset,
        private readonly ?bool $deceased,
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

        if (!isset($payload['relation']) || !is_string($payload['relation'])) {
            return [null, 'unsupported_payload'];
        }

        $relation = strtolower(trim($payload['relation']));
        if (!isset(self::RELATION_TO_COLUMN[$relation])) {
            return [null, 'unsupported_payload'];
        }

        if (!isset($payload['condition']) || !is_string($payload['condition'])) {
            return [null, 'invalid_payload'];
        }

        $condition = trim($payload['condition']);
        if ($condition === '' || strlen($condition) < 2 || strlen($condition) > 4000) {
            return [null, 'invalid_payload'];
        }

        // Schema-expansion: age_of_onset is verbatim free-text (e.g. "52", "early 60s")
        // — we don't try to normalize. deceased is true/false/null only.
        $ageOfOnset = null;
        if (array_key_exists('age_of_onset', $payload)) {
            $ao = $payload['age_of_onset'];
            if ($ao !== null) {
                if (!is_string($ao)) {
                    return [null, 'invalid_payload'];
                }
                $aoTrim = trim($ao);
                if ($aoTrim !== '') {
                    if (strlen($aoTrim) > 100) {
                        return [null, 'invalid_payload'];
                    }
                    $ageOfOnset = $aoTrim;
                }
            }
        }

        $deceased = null;
        if (array_key_exists('deceased', $payload)) {
            $dc = $payload['deceased'];
            if ($dc !== null) {
                if (!is_bool($dc)) {
                    return [null, 'invalid_payload'];
                }
                $deceased = $dc;
            }
        }

        return [new self($relation, self::RELATION_TO_COLUMN[$relation], $condition, $ageOfOnset, $deceased), null];
    }

    public function relation(): string
    {
        return $this->relation;
    }

    /** @return non-empty-string */
    public function columnName(): string
    {
        return $this->columnName;
    }

    public function condition(): string
    {
        return $this->condition;
    }

    public function ageOfOnset(): ?string
    {
        return $this->ageOfOnset;
    }

    public function deceased(): ?bool
    {
        return $this->deceased;
    }

    /**
     * Compose the free-text line that gets appended to the relative's history_data column.
     * Pattern: `<condition>` + ` (age <X>)` if age provided + ` (deceased)` if true.
     * The result is what `OpenEmrPatientFamilyHistoryAdapter::appendFamilyHistoryEntry`
     * scans against existing column content for idempotency.
     */
    public function composedHistoryLine(): string
    {
        $line = $this->condition;
        $modifiers = [];
        if ($this->ageOfOnset !== null && $this->ageOfOnset !== '') {
            $modifiers[] = 'age ' . $this->ageOfOnset;
        }
        if ($this->deceased === true) {
            $modifiers[] = 'deceased';
        }
        if ($modifiers !== []) {
            $line .= ' (' . implode(', ', $modifiers) . ')';
        }
        return $line;
    }
}
