<?php

/**
 * Applies chief complaint updates via EncounterService (no direct clinical SQL).
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

final class ChiefComplaintWriteAction
{
    public const WRITE_TARGET = 'chief_complaint';

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
        ChiefComplaintPayload $payload,
    ): ConfirmedWriteOutcome {
        if ($this->ledger->hasSuccessfulCompletion($proposalId)) {
            throw new DuplicateProposalExecutionException($proposalId);
        }

        $encRow = $this->encounterPort->getOneByPidEid($patientPid, $numericEncounterId);
        if ($encRow === [] || empty($encRow['euuid']) || empty($encRow['puuid'])) {
            return ConfirmedWriteOutcome::openemrRejected('encounter not found');
        }

        $puuidRaw = $encRow['puuid'];
        $euuidRaw = $encRow['euuid'];

        $puuid = self::normalizeUuidPayload($puuidRaw);
        $euuid = self::normalizeUuidPayload($euuidRaw);

        if ($euuid === '' || $puuid === '') {
            return ConfirmedWriteOutcome::openemrRejected('encounter not found');
        }

        $facilityRaw = $encRow['facility_id'] ?? null;
        $facilityId = \is_int($facilityRaw) ? $facilityRaw : (\is_string($facilityRaw) && \is_numeric($facilityRaw) ? (int) $facilityRaw : 0);
        if ($facilityId <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('encounter invalid');
        }

        $patch = [
            'reason' => $payload->reason(),
            'facility_id' => $facilityId,
            'user' => $authUsername,
            'group' => $authProvider !== '' ? $authProvider : 'Default',
        ];

        $svcResult = $this->encounterPort->updateEncounterReason($puuid, $euuid, $patch);

        if (!($svcResult instanceof ProcessingResult)) {
            // EncounterService::updateEncounter has one path that returns a raw string instead of a
            // ProcessingResult (the sensitivities ACL deny: "You are not authorized to see this encounter.").
            // Surface that core string verbatim (PHI-free, capped) so the audit row tells us what actually
            // happened on the next mystery rejection — squashing this to "encounter not found" cost us hours.
            $reason = \is_string($svcResult) && $svcResult !== ''
                ? self::sanitizeOpenemrCoreReason($svcResult)
                : 'write failed';

            return ConfirmedWriteOutcome::openemrRejected($reason);
        }

        if (!$svcResult->isValid()) {
            return ConfirmedWriteOutcome::openemrRejected(self::squashSafeValidationMessage($svcResult));
        }

        if ($svcResult->getInternalErrors() !== []) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        // Mark dedupe ledger only once OpenEMR accepted the persisted change.
        $this->ledger->markSuccessful($proposalId, self::WRITE_TARGET);

        return ConfirmedWriteOutcome::accepted(0);
    }

    /**
     * @param mixed $uuidField
     */
    private static function normalizeUuidPayload($uuidField): string
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

    private static function squashSafeValidationMessage(ProcessingResult $result): string
    {
        $messages = $result->getValidationMessages();
        $flat = self::flattenValidationMessages($messages);
        foreach ($flat as $line) {
            $normalized = strtolower(trim($line));

            foreach (['patient', 'encounter', 'not found', 'invalid', 'unauthorized'] as $token) {
                if (str_contains($normalized, $token)) {
                    return 'encounter not found';
                }
            }

            foreach (['facility', 'required', 'validation'] as $token) {
                if (str_contains($normalized, $token)) {
                    return 'encounter invalid';
                }
            }
        }

        return 'write failed';
    }

    /**
     * Trim, collapse whitespace, drop trailing punctuation, and length-cap a raw string returned by an
     * OpenEMR core service so it survives a single-line audit comment without leaking surprise content.
     */
    private static function sanitizeOpenemrCoreReason(string $raw): string
    {
        $collapsed = \preg_replace('/\s+/', ' ', \trim($raw)) ?? '';
        $collapsed = \rtrim($collapsed, '.');
        if ($collapsed === '') {
            return 'write failed';
        }

        if (\strlen($collapsed) > 120) {
            $collapsed = \substr($collapsed, 0, 120);
        }

        return $collapsed;
    }

    /**
     * @param array<mixed>|string $messages
     *
     * @return list<string>
     */
    private static function flattenValidationMessages(array|string $messages): array
    {
        $out = [];
        if (\is_string($messages)) {
            return [$messages];
        }

        foreach ($messages as $value) {
            if (\is_string($value)) {
                $out[] = $value;
            } elseif (\is_array($value)) {
                $out = [...$out, ...self::flattenValidationMessages($value)];
            }
        }

        return $out;
    }
}
