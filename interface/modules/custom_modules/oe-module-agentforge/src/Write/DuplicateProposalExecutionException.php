<?php

/**
 * Raised when replaying an already-confirmed UC-B proposal id (PRD §4.7 duplicate guard).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use RuntimeException;

final class DuplicateProposalExecutionException extends RuntimeException
{
    public function __construct(
        public readonly string $proposalId,
    ) {
        parent::__construct('duplicate_proposal_execution');
    }
}
