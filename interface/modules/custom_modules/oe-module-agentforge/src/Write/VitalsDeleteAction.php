<?php

/**
 * UC-B vitals soft-delete confirmed action (PRD §4.7.4 — void erroneous vitals).
 * Mirrors VitalsWriteAction shape: dedupe via the proposal ledger, delegate the
 * actual soft-delete to the port, return a ConfirmedWriteOutcome the route
 * surfaces back to the agent.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class VitalsDeleteAction
{
    public const WRITE_TARGET = 'vitals_delete';

    public function __construct(
        private readonly EncounterVitalsDeletePort $vitalsDeletePort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        int $numericEncounterId,
        string $proposalId,
        string $authUsername,
        string $authProvider,
        VitalsDeletePayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        unset($authUsername, $authProvider); // soft-delete writes audit via the route layer

        $outcome = $this->vitalsDeletePort->softDeleteVitalsByUuid(
            $patientPid,
            $numericEncounterId,
            $payload->vitalsUuid(),
        );

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }
}
