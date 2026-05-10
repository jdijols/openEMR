<?php

/**
 * W2 intake-bundle — confirmed medical problem add (write_target='problem_add').
 *
 * Mirrors `MedicationAddAction`: dedupe via the proposal ledger, delegate the
 * `lists` insert to the port, return a `ConfirmedWriteOutcome` the route layer
 * maps to JSON.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class MedicalProblemAddAction
{
    public const WRITE_TARGET = 'problem_add';

    public function __construct(
        private readonly PatientMedicalProblemWritePort $problemPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        string $proposalId,
        MedicalProblemAddPayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $outcome = $this->problemPort->insertMedicalProblemForPatient(
            $patientPid,
            [
                'title' => $payload->condition(),
                'comments' => $payload->comments(),
                'begdate' => $payload->onsetDate(),
                'status' => $payload->status(),
            ],
        );

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }
}
