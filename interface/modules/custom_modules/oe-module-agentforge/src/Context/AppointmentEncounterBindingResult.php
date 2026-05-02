<?php

/**
 * Value object describing an AgentForge appointment encounter binding result.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Context;

final readonly class AppointmentEncounterBindingResult
{
    public function __construct(
        public ?int $encounterId,
        public string $encounterDate,
        public string $encounterCategory,
        public bool $created
    ) {
    }

    public function hasEncounter(): bool
    {
        return $this->encounterId !== null && $this->encounterId > 0;
    }
}
