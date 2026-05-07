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
        } catch (\Throwable $e) {
            // G2-Early-27 — emit the underlying exception class + message to PHP error log
            // so `devtools php-log` shows the root cause without redeploying. Audit row still
            // surfaces only the generic 'write failed' string to keep PHI out of the audit DB
            // (service-layer exceptions can echo back failed query parameters).
            error_log(sprintf(
                'agentforge.clinical_note_write_failed proposal_id=%s exception=%s message=%s',
                $proposalId,
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);

        return ConfirmedWriteOutcome::accepted(0);
    }
}
