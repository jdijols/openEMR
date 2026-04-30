<?php

/**
 * Server-side active chart binding (PRD §4.6, stop-the-line S1).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

final class ActiveChartBinding
{
    public function __construct(private readonly SessionTokenVerifier $verifier)
    {
    }

    /**
     * @throws ActiveChartBindingException
     */
    public function assert(string $sessionToken, string $requestedPatientUuid, ?string $sessionPatientUuidFromPid): void
    {
        $claims = $this->verifier->verify($sessionToken);
        if ($claims === null) {
            throw new ActiveChartBindingException('invalid_session');
        }

        $this->assertClaims($claims, $requestedPatientUuid, $sessionPatientUuidFromPid);
    }

    /**
     * Chart binding after the session token has already been verified (PRD §4.6).
     *
     * @param array{user_id:int, patient_uuid:?string, encounter_id:?int, iat:int, exp:int} $claims
     *
     * @throws ActiveChartBindingException
     */
    public function assertClaims(array $claims, string $requestedPatientUuid, ?string $sessionPatientUuidFromPid): void
    {
        $tokenPatient = $claims['patient_uuid'];
        if ($tokenPatient === null && $requestedPatientUuid !== '') {
            throw new ActiveChartBindingException('active_chart_mismatch');
        }

        if ($tokenPatient !== null && $requestedPatientUuid === '') {
            throw new ActiveChartBindingException('active_chart_mismatch');
        }

        if ($tokenPatient !== null && $tokenPatient !== $requestedPatientUuid) {
            throw new ActiveChartBindingException('active_chart_mismatch');
        }

        if ($sessionPatientUuidFromPid !== null && $sessionPatientUuidFromPid !== $requestedPatientUuid) {
            throw new ActiveChartBindingException('active_chart_mismatch');
        }

        if ($sessionPatientUuidFromPid !== null && $tokenPatient !== null && $tokenPatient !== $sessionPatientUuidFromPid) {
            throw new ActiveChartBindingException('active_chart_mismatch');
        }
    }
}
