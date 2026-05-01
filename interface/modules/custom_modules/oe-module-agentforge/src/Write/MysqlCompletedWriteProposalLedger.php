<?php

/**
 * Persists dedupe rows for UC-B confirmations (minimal SQL limited to AgentForge bookkeeping).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class MysqlCompletedWriteProposalLedger implements CompletedWriteProposalLedgerInterface
{
    public function hasSuccessfulCompletion(string $proposalId): bool
    {
        $row = \sqlQuery(
            'SELECT `proposal_id` FROM `agentforge_completed_write_proposal` WHERE `proposal_id` = ? LIMIT 1',
            [$proposalId]
        );

        return $row !== false && isset($row['proposal_id']);
    }

    public function markSuccessful(string $proposalId, string $writeTarget): void
    {
        \sqlStatement(
            'INSERT IGNORE INTO `agentforge_completed_write_proposal` (`proposal_id`, `write_target`, `recorded_at`) VALUES (?, ?, NOW())',
            [$proposalId, $writeTarget]
        );
    }
}
