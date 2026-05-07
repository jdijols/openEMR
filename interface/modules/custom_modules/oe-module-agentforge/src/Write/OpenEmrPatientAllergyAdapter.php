<?php

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Services\AllergyIntoleranceService;

final class OpenEmrPatientAllergyAdapter implements PatientAllergyWritePort
{
    /**
     * @param array<string, mixed> $fields
     */
    public function insertAllergy(string $patientUuidCanonical, array $fields): ConfirmedWriteOutcome
    {
        $svc = new AllergyIntoleranceService();
        $data = array_merge(['puuid' => $patientUuidCanonical], $fields);
        try {
            $pr = $svc->insert($data);
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return self::mapResult($pr);
    }

    /**
     * @param array<string, mixed> $patch
     */
    public function updateAllergy(string $patientUuidCanonical, string $allergyUuidCanonical, array $patch): ConfirmedWriteOutcome
    {
        $svc = new AllergyIntoleranceService();
        $exist = $svc->getOne($allergyUuidCanonical, $patientUuidCanonical);
        if (!$exist->isValid()) {
            return ConfirmedWriteOutcome::openemrRejected('allergy not found');
        }

        $rows = $exist->getData();
        if (!\is_array($rows) || $rows === []) {
            return ConfirmedWriteOutcome::openemrRejected('allergy not found');
        }

        try {
            $pr = $svc->update($allergyUuidCanonical, array_merge(['puuid' => $patientUuidCanonical], $patch));
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return self::mapResult($pr);
    }

    public function softDeleteAllergyByUuid(int $patientPid, string $allergyUuidString): ConfirmedWriteOutcome
    {
        if ($patientPid <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        }

        try {
            $hexUuid = UuidRegistry::uuidToBytes($allergyUuidString);
        } catch (\Throwable) {
            return ConfirmedWriteOutcome::openemrRejected('allergy not found');
        }

        if ($hexUuid === '') {
            return ConfirmedWriteOutcome::openemrRejected('allergy not found');
        }

        $rows = QueryUtils::fetchRecords(
            "SELECT `id` FROM `lists` WHERE `uuid` = ? AND `pid` = ? AND `type` = 'allergy' LIMIT 1",
            [$hexUuid, $patientPid],
        );
        if (!\is_array($rows) || \count($rows) === 0) {
            return ConfirmedWriteOutcome::openemrRejected('allergy not found');
        }

        try {
            QueryUtils::sqlStatementThrowException(
                "UPDATE `lists` SET `activity` = 0, `enddate` = NOW() "
                . "WHERE `uuid` = ? AND `pid` = ? AND `type` = 'allergy' LIMIT 1",
                [$hexUuid, $patientPid],
            );
        } catch (\Throwable $e) {
            error_log(sprintf(
                'agentforge.allergy_delete_failed pid=%d exception=%s message=%s',
                $patientPid,
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }

    private static function mapResult(\OpenEMR\Validators\ProcessingResult $pr): ConfirmedWriteOutcome
    {
        if (!$pr->isValid()) {
            return ConfirmedWriteOutcome::openemrRejected('validation failed');
        }

        if ($pr->getInternalErrors() !== []) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }
}
