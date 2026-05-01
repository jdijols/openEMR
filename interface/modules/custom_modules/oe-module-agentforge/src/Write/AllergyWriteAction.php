<?php

/**
 * UC-B allergy confirmed write — lists.type='allergy' via AllergyIntoleranceService.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class AllergyWriteAction
{
    public const WRITE_TARGET = 'allergy';

    public function __construct(
        private readonly PatientAllergyWritePort $allergyPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        string $patientUuidCanonical,
        string $proposalId,
        AllergyWritePayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $outcome = match ($payload->action()) {
            'add' => $this->add($patientUuidCanonical, $payload),
            'update_reaction' => $this->allergyPort->updateAllergy(
                $patientUuidCanonical,
                (string) $payload->allergyUuid(),
                ['comments' => (string) $payload->reactionText()],
            ),
            'update_severity' => $this->allergyPort->updateAllergy(
                $patientUuidCanonical,
                (string) $payload->allergyUuid(),
                ['severity_al' => (string) $payload->severityAlOptionId()],
            ),
        };

        if ($outcome->isAccepted()) {
            $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);
        }

        return $outcome;
    }

    private function add(string $patientUuidCanonical, AllergyWritePayload $payload): ConfirmedWriteOutcome
    {
        $fields = [
            'title' => $payload->substance(),
        ];
        $rx = $payload->reactionText();
        if ($rx !== null && $rx !== '') {
            $fields['comments'] = $rx;
        }

        $sev = $payload->severityAlOptionId();
        if ($sev !== null) {
            $fields['severity_al'] = $sev;
        }

        return $this->allergyPort->insertAllergy($patientUuidCanonical, $fields);
    }
}
