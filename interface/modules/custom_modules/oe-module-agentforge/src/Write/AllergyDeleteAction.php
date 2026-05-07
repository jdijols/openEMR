<?php

/**
 * G2-Early-22 — confirmed allergy soft-delete (write_target='allergy_delete').
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class AllergyDeleteAction
{
    public const WRITE_TARGET = 'allergy_delete';

    public function __construct(
        private readonly PatientAllergyWritePort $allergyPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        string $proposalId,
        AllergyDeletePayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $outcome = $this->allergyPort->softDeleteAllergyByUuid($patientPid, $payload->allergyUuid());

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }
}
