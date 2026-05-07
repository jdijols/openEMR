<?php

/**
 * G2-Final-11 — production adapter for partial demographics updates against `patient_data`.
 *
 * The keys passed in are pre-validated by `DemographicsUpdatePayload` against an allowlist,
 * so they're safe to inline as SQL column identifiers. Direct SQL via QueryUtils keeps the
 * write path narrow — the heavyweight FHIR-aware `PatientService::update()` triggers events
 * and updates that the demo cohort doesn't need.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

use OpenEMR\Common\Database\QueryUtils;

final class OpenEmrPatientDemographicsAdapter implements PatientDemographicsWritePort
{
    /** @var list<string> */
    private const ALLOWED_COLUMNS = [
        'fname',
        'lname',
        'mname',
        'DOB',
        'sex',
        'phone_cell',
    ];

    public function updateDemographicsForPatient(int $patientPid, array $columnPatch): ConfirmedWriteOutcome
    {
        if ($patientPid <= 0) {
            return ConfirmedWriteOutcome::openemrRejected('patient invalid');
        }

        if ($columnPatch === []) {
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        // Defense in depth: payload parser already constrained these, but the adapter never
        // trusts caller input — re-checks against the same allowlist before splicing into SQL.
        $setFragments = [];
        $bindings = [];
        foreach ($columnPatch as $column => $value) {
            if (!\in_array($column, self::ALLOWED_COLUMNS, true)) {
                return ConfirmedWriteOutcome::openemrRejected('unsupported_write');
            }
            $setFragments[] = "`{$column}` = ?";
            $bindings[] = $value;
        }
        $bindings[] = $patientPid;

        try {
            QueryUtils::sqlStatementThrowException(
                'UPDATE `patient_data` SET ' . implode(', ', $setFragments) . ' WHERE `pid` = ? LIMIT 1',
                $bindings,
            );
        } catch (\Throwable $e) {
            error_log(sprintf(
                'agentforge.demographics_update_failed pid=%d columns=%s exception=%s message=%s',
                $patientPid,
                implode(',', array_keys($columnPatch)),
                $e::class,
                $e->getMessage(),
            ));
            return ConfirmedWriteOutcome::openemrRejected('write failed');
        }

        return ConfirmedWriteOutcome::accepted(0);
    }
}
