<?php

/**
 * G2-Early-20 — confirmed medication add (write_target='medication_add').
 *
 * Mirrors the AllergyWriteAction shape: dedupe via the proposal ledger, delegate the
 * insert to the port, return a ConfirmedWriteOutcome the route layer maps to JSON.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class MedicationAddAction
{
    public const WRITE_TARGET = 'medication_add';

    public function __construct(
        private readonly PatientMedicationWritePort $medicationPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        string $proposalId,
        MedicationAddPayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $outcome = $this->medicationPort->insertMedicationForPatient(
            $patientPid,
            [
                'title' => $payload->name(),
                'comments' => $payload->commentsBody(),
                'begdate' => $payload->begdate(),
                'enddate' => $payload->enddate(),
                'diagnosis' => $payload->indication(),
            ],
        );

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }
}
