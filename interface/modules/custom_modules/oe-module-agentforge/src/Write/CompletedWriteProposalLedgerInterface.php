<?php

/**
 * Guards against duplicate POST of the same UC-B proposal id (PRD §4.7).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

interface CompletedWriteProposalLedgerInterface
{
    /**
     * True when this proposal_id already resulted in accepted:true (successful write committed).
     */
    public function hasSuccessfulCompletion(string $proposalId): bool;

    /**
     * Record proposal_id after an accepted OpenEMR write (accepted:true response path).
     */
    public function markSuccessful(string $proposalId, string $writeTarget): void;
}
