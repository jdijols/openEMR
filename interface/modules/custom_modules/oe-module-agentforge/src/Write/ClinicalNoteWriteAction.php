<?php

/**
 * Confirmed clinical-note write — appends physician dictation to a per-encounter
 * progress note via ClinicalNotesService (no clinical SQL here).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class ClinicalNoteWriteAction
{
    public const WRITE_TARGET = 'clinical_note';

    public function __construct(
        private readonly ClinicalNoteWritePort $clinicalNotePort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        int $numericEncounterId,
        string $proposalId,
        string $authUsername,
        string $authProvider,
        ClinicalNoteWritePayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        if (!$this->clinicalNotePort->encounterExists($patientPid, $numericEncounterId)) {
            return ConfirmedWriteOutcome::openemrRejected('encounter not found');
        }

        try {
            $this->clinicalNotePort->appendPhysicianNoteForEncounter(
                $patientPid,
                $numericEncounterId,
                $authUsername,
                $authProvider,
                $payload->text(),
            );
        } catch (\InvalidArgumentException) {
            return ConfirmedWriteOutcome::openemrRejected('encounter invalid');
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);

        return ConfirmedWriteOutcome::accepted(0);
    }
}
