<?php

/**
 * G2-Early-24 — soft-delete a FHIR DocumentReference + cascade-soft-delete every linked
 * Observation. Idempotent: re-deleting an already-deleted DocRef returns accept.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

use OpenEMR\Modules\AgentForge\Write\CompletedWriteProposalLedgerInterface;
use OpenEMR\Modules\AgentForge\Write\DuplicateProposalExecutionException;

final class DocumentDeleteAction
{
    public const WRITE_TARGET = 'document_delete';

    public function __construct(
        private readonly DocumentDeletePort $deletePort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    /**
     * @return array{accepted: bool, reason?: string, observations_deleted: int}
     */
    public function execute(
        string $patientUuidCanonical,
        string $proposalId,
        DocumentDeletePayload $payload,
    ): array {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $result = $this->deletePort->softDeleteDocRefAndCascadeObservations(
            $payload->docrefUuid(),
            $patientUuidCanonical,
        );

        if ($result['ok'] === false) {
            return [
                'accepted' => false,
                'reason' => 'document not found',
                'observations_deleted' => 0,
            ];
        }

        $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);

        return [
            'accepted' => true,
            'observations_deleted' => $result['observations_deleted'],
        ];
    }
}
