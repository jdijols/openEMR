<?php

/**
 * UC-B tobacco confirmed write → `history_data.tobacco` via SocialHistoryService::create (PRD §4.7).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class TobaccoWriteAction
{
    public const WRITE_TARGET = 'tobacco';

    public function __construct(
        private readonly PatientTobaccoHistoryWritePort $tobaccoPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        string $proposalId,
        TobaccoWritePayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $tobaccoPipe = $payload->toHistoryDataTobaccoValue();
        $outcome = $this->tobaccoPort->insertTobaccoForPatient($patientPid, $tobaccoPipe);

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }
}
