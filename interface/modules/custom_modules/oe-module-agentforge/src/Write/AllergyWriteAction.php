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
            // Substance lives in `lists.title`. The legacy add/edit-issue
            // form stores it there and the FHIR encoder pulls it back as
            // the resource narrative; updating it in place is parity with
            // that flow.
            'update_substance' => $this->allergyPort->updateAllergy(
                $patientUuidCanonical,
                (string) $payload->allergyUuid(),
                ['title' => (string) $payload->substance()],
            ),
            // `lists.reaction` (option_id from list_options.list_id='reaction')
            // is what the legacy form stores and what the FHIR encoder reads.
            // Writing to `comments` instead silently broke the round-trip:
            // the value persisted but never surfaced through FHIR, so the
            // dashboard modal couldn't read it back on edit.
            'update_reaction' => $this->allergyPort->updateAllergy(
                $patientUuidCanonical,
                (string) $payload->allergyUuid(),
                ['reaction' => (string) $payload->reactionText()],
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

        // Reaction lands in `lists.reaction` (option_id) so the FHIR encoder
        // emits it on read. Free-text annotations not part of the reaction
        // dropdown go into `lists.comments` separately.
        $reaction = $payload->reactionText();
        if ($reaction !== null && $reaction !== '') {
            $fields['reaction'] = $reaction;
        }

        $extraComments = $payload->extraComments();
        if ($extraComments !== null && $extraComments !== '') {
            $fields['comments'] = $extraComments;
        }

        $sev = $payload->severityAlOptionId();
        if ($sev !== null) {
            $fields['severity_al'] = $sev;
        }

        // onset_date → lists.begdate (AllergyIntoleranceService accepts begdate as a pass-through key).
        $onset = $payload->onsetDate();
        if ($onset !== null) {
            $fields['begdate'] = $onset;
        }

        return $this->allergyPort->insertAllergy($patientUuidCanonical, $fields);
    }
}
