<?php

/**
 * G2-Early-23 — confirmed family history add (write_target='family_history_add').
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class FamilyHistoryAddAction
{
    public const WRITE_TARGET = 'family_history_add';

    public function __construct(
        private readonly PatientFamilyHistoryWritePort $familyHistoryPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        string $proposalId,
        FamilyHistoryAddPayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $outcome = $this->familyHistoryPort->appendFamilyHistoryEntry(
            $patientPid,
            $payload->columnName(),
            $payload->composedHistoryLine(),
        );

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }
}
