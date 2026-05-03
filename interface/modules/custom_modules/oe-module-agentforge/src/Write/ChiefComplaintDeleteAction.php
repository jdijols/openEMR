<?php

/**
 * UC-B chief-complaint clear confirmed action (PRD §4.7.4 — clear erroneous reason for visit).
 * Reuses the existing EncounterChiefComplaintPort by patching reason='', so the same
 * EncounterService update path applies. Dedupes via the proposal ledger and surfaces a
 * distinct write_target='chief_complaint_delete' for audit clarity.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Validators\ProcessingResult;

final class ChiefComplaintDeleteAction
{
    public const WRITE_TARGET = 'chief_complaint_delete';

    public function __construct(
        private readonly EncounterChiefComplaintPort $encounterPort,
        private readonly CompletedWriteProposalLedgerInterface $ledger,
    ) {
    }

    public function execute(
        int $patientPid,
        int $numericEncounterId,
        string $proposalId,
        string $authUsername,
        string $authProvider,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $encRow = $this->encounterPort->getOneByPidEid($patientPid, $numericEncounterId);
        if ($encRow === [] || empty($encRow['euuid']) || empty($encRow['puuid'])) {
            return ConfirmedWriteOutcome::openemrRejected('encounter not found');
        }

        $puuid = self::normalizeUuidPayload($encRow['puuid']);
        $euuid = self::normalizeUuidPayload($encRow['euuid']);

        if ($puuid === '' || $euuid === '') {
            return ConfirmedWriteOutcome::openemrRejected('encounter not found');
        }

        $facilityRaw = $encRow['facility_id'] ?? null;
        $facilityId = \is_int($facilityRaw) ? $facilityRaw : (\is_string($facilityRaw) && \is_numeric($facilityRaw) ? (int) $facilityRaw : 0);
        if ($facilityId <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('encounter invalid');
        }

        $patch = [
            'reason' => '',
            'facility_id' => $facilityId,
            'user' => $authUsername,
            'group' => $authProvider !== '' ? $authProvider : 'Default',
        ];

        $svcResult = $this->encounterPort->updateEncounterReason($puuid, $euuid, $patch);

        if (!($svcResult instanceof ProcessingResult)) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        if (!$svcResult->isValid() || $svcResult->getInternalErrors() !== []) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);

        return ConfirmedWriteOutcome::accepted(0);
    }

    private static function normalizeUuidPayload(mixed $uuidField): string
    {
        if (\is_string($uuidField) && $uuidField !== '' && \strlen($uuidField) === 16) {
            try {
                return UuidRegistry::uuidToString($uuidField);
            } catch (\Exception) {
                return '';
            }
        }

        return \is_string($uuidField) ? $uuidField : '';
    }
}
