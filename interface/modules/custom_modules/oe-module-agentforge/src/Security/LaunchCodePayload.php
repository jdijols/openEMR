<?php

/**
 * Successful launch-code redemption payload (PRD §4.3).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

final readonly class LaunchCodePayload
{
    public function __construct(
        public int $userId,
        public ?string $patientUuid,
        public ?int $encounterId
    ) {
    }
}
