<?php

/**
 * Confirmed clinical-note edit (update or soft-delete) — dispatches by payload action.
 *
 * Encounter-scoped: the note UUID must belong to the encounter the proposal was raised against,
 * so an agent can't propose editing a different encounter's note by smuggling its UUID through.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class ClinicalNoteEditAction
{
    public function execute(
        int $patientPid,
        int $numericEncounterId,
        string $proposalId,
        string $authUsername,
        string $authProvider,
        ClinicalNoteEditPayload $payload,
    ): ConfirmedWriteOutcome {
        $writeTarget = $payload->isDelete() ? 'clinical_note_delete' : 'clinical_note_update';

        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        if (!$this->editPort->activeNoteBelongsToEncounter($patientPid, $payload->noteUuid(), $numericEncounterId)) {
            return ConfirmedWriteOutcome::openemrRejected('note not found');
        }

        try {
            if ($payload->isDelete()) {
                $changed = $this->editPort->softDelete($patientPid, $payload->noteUuid());
            } else {
                $changed = $this->editPort->replaceDescription(
                    $patientPid,
                    $payload->noteUuid(),
                    $payload->text(),
                    $authUsername,
                    $authProvider,
                );
            }
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        if (!$changed) {
            return ConfirmedWriteOutcome::openemrRejected('note not found');
        }

        $this->ledger->markSuccessful($proposalId, $writeTarget);

        return ConfirmedWriteOutcome::accepted(0);
    }

    public function __construct(
        private readonly ClinicalNoteEditPort $editPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }
}
