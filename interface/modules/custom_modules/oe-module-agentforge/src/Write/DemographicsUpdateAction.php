<?php

/**
 * G2-Final-11 — confirmed demographics update (write_target='demographics_update').
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class DemographicsUpdateAction
{
    public const WRITE_TARGET = 'demographics_update';

    public function __construct(
        private readonly PatientDemographicsWritePort $demographicsPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        string $proposalId,
        DemographicsUpdatePayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $outcome = $this->demographicsPort->updateDemographicsForPatient(
            $patientPid,
            $payload->columnPatch(),
        );

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }
}
