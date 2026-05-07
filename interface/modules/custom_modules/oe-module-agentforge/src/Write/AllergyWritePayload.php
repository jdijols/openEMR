<?php

/**
 * UC-B allergy propose-write confirmation payload (PRD §4.7): add/update only; delete/refuse unsupported.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class AllergyWritePayload
{
    private const KEYS = ['action', 'substance', 'allergy_uuid', 'reaction', 'severity', 'onset_date', 'comments'];

    /** @var list<string> */
    private const ACTIONS = ['add', 'update_reaction', 'update_severity'];

    /** Map PRD-aligned tokens → OpenEMR `severity_ccda` option_id (lists table severity_al column). */
    private const SEVERITY_TO_OPTION_ID = [
        'mild' => 'mild',
        'moderate' => 'moderate',
        'severe' => 'severe',
        'life_threatening' => 'life_threatening_severity',
        'unknown' => 'unassigned',
    ];

    private function __construct(
        private readonly string $action,
        private readonly ?string $substance,
        private readonly ?string $allergyUuid,
        private readonly ?string $reaction,
        private readonly ?string $severityOptionId,
        private readonly ?string $onsetDate,
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

        if (!isset($payload['action']) || !is_string($payload['action'])) {
            return [null, 'unsupported_payload'];
        }

        $rawAction = $payload['action'];
        if ($rawAction === 'delete' || $rawAction === 'resolve') {
            return [null, 'unsupported_payload'];
        }

        if (!in_array($rawAction, self::ACTIONS, true)) {
            return [null, 'unsupported_payload'];
        }

        $action = $rawAction;

        $substance = null;
        if (array_key_exists('substance', $payload)) {
            $sv = $payload['substance'];
            if (!is_string($sv)) {
                return [null, 'invalid_allergy_payload'];
            }

            $substance = trim($sv);
        }

        $allergyUuid = null;
        if (array_key_exists('allergy_uuid', $payload)) {
            $uv = $payload['allergy_uuid'];
            if (!is_string($uv) || trim($uv) === '' || self::normalizeUuid(trim($uv)) === null) {
                return [null, 'invalid_allergy_payload'];
            }

            $allergyUuid = self::normalizeUuid(trim($uv));
        }

        $reaction = null;
        if (array_key_exists('reaction', $payload)) {
            $rv = $payload['reaction'];
            if ($rv !== null && !is_string($rv)) {
                return [null, 'invalid_allergy_payload'];
            }

            $reaction = is_string($rv) ? trim($rv) : null;
            if ($reaction === '') {
                $reaction = null;
            }
        }

        $severityOpt = null;
        if (array_key_exists('severity', $payload)) {
            $sevRaw = $payload['severity'];
            if (!is_string($sevRaw)) {
                return [null, 'invalid_allergy_payload'];
            }

            $sev = trim($sevRaw);
            if ($sev === '' || !isset(self::SEVERITY_TO_OPTION_ID[$sev])) {
                return [null, 'invalid_allergy_payload'];
            }

            $severityOpt = self::SEVERITY_TO_OPTION_ID[$sev];
        }

        // Schema-expansion fields (G2-Final-13). onset_date → ISO YYYY-MM-DD
        // (lists.begdate). comments → extra free-text appended after the reaction line.
        $onsetDate = null;
        if (array_key_exists('onset_date', $payload)) {
            $od = $payload['onset_date'];
            if ($od !== null) {
                if (!is_string($od)) {
                    return [null, 'invalid_allergy_payload'];
                }
                $odTrim = trim($od);
                if ($odTrim !== '') {
                    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $odTrim) !== 1) {
                        return [null, 'invalid_allergy_payload'];
                    }
                    $onsetDate = $odTrim;
                }
            }
        }

        $extraComments = null;
        if (array_key_exists('comments', $payload)) {
            $cm = $payload['comments'];
            if ($cm !== null) {
                if (!is_string($cm)) {
                    return [null, 'invalid_allergy_payload'];
                }
                $cmTrim = trim($cm);
                if ($cmTrim !== '') {
                    if (strlen($cmTrim) > 4000) {
                        return [null, 'invalid_allergy_payload'];
                    }
                    $extraComments = $cmTrim;
                }
            }
        }

        if ($action === 'add') {
            if ($substance === null || strlen($substance) < 2 || strlen($substance) > 255) {
                return [null, 'invalid_allergy_payload'];
            }

            return [new self($action, $substance, null, $reaction, $severityOpt, $onsetDate, $extraComments), null];
        }

        if ($action === 'update_reaction') {
            if ($allergyUuid === null || $reaction === null || $reaction === '') {
                return [null, 'invalid_allergy_payload'];
            }

            return [new self($action, null, $allergyUuid, $reaction, null, null, null), null];
        }

        if ($severityOpt === null) {
            return [null, 'invalid_allergy_payload'];
        }

        if ($allergyUuid === null) {
            return [null, 'invalid_allergy_payload'];
        }

        return [new self($action, null, $allergyUuid, null, $severityOpt, null, null), null];
    }

    public function action(): string
    {
        return $this->action;
    }

    /** Add-only normalized substance title. */
    public function substance(): ?string
    {
        return $this->substance;
    }

    public function allergyUuid(): ?string
    {
        return $this->allergyUuid;
    }

    /** Stored in `lists.comments` (free-text manifestation). */
    public function reactionText(): ?string
    {
        return $this->reaction;
    }

    /** `severity_ccda` option id or null when not supplied. */
    public function severityAlOptionId(): ?string
    {
        return $this->severityOptionId;
    }

    /** ISO YYYY-MM-DD or null. lists.begdate (allergy onset). */
    public function onsetDate(): ?string
    {
        return $this->onsetDate;
    }

    /** Extra free-text notes; combined with reaction text into lists.comments by the action. */
    public function extraComments(): ?string
    {
        return $this->comments;
    }

    /**
     * Combined comments body that lands in `lists.comments` — reaction text first
     * (the W1 manifestation field), extra comments appended below with a separator.
     * Returns null when neither is present, so the adapter doesn't write an empty
     * column over an existing value.
     */
    public function combinedCommentsBody(): ?string
    {
        $rx = $this->reaction !== null && $this->reaction !== '' ? $this->reaction : null;
        $ex = $this->comments !== null && $this->comments !== '' ? $this->comments : null;
        if ($rx === null && $ex === null) {
            return null;
        }
        if ($rx !== null && $ex !== null) {
            return $rx . "\n— " . $ex;
        }
        return $rx ?? $ex;
    }

    private static function normalizeUuid(string $uuid): ?string
    {
        if (preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
            $uuid,
        )) {
            return strtolower($uuid);
        }

        return null;
    }
}
