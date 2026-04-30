<?php

/**
 * Shared Context Service authorization: OpenEMR session, chart ACL, session token, active chart (PRD §4.4 §4.6, §5.3 S2S).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Context;

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Install\AgentForgeAclInstaller;
use OpenEMR\Modules\AgentForge\Security\ActiveChartBinding;
use OpenEMR\Modules\AgentForge\Security\ActiveChartBindingException;
use OpenEMR\Modules\AgentForge\Security\SessionTokenVerifier;
use Symfony\Component\HttpFoundation\Session\SessionInterface;

final class ChartContextGate
{
    /**
     * @return array{
     *     claims: array{user_id:int, patient_uuid:?string, encounter_id:?int, iat:int, exp:int},
     *     auth_user: string,
     *     auth_provider: string,
     *     user_id: int,
     *     pid: int
     * }
     */
    public static function authorizeFromGlobals(string $sessionToken, string $requestedPatientUuid): array
    {
        AgentForgeAclInstaller::ensureRegistered();

        if (\agentforge_verify_internal_auth()) {
            return self::authorizeTrustedAgentCall($sessionToken, $requestedPatientUuid);
        }

        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $authUser = self::sessionString($session, 'authUser');
        if ($authUser === '') {
            throw new ChartContextAuthorizationException(401, 'unauthenticated');
        }

        $userId = self::sessionInt($session, 'authUserID');
        if ($userId <= 0) {
            throw new ChartContextAuthorizationException(401, 'unauthenticated');
        }

        if (!AclMain::aclCheckCore(AclMap::CHART_READ_SECTION, AclMap::CHART_READ_VALUE, $authUser)) {
            throw new ChartContextAuthorizationException(403, 'acl_denied');
        }

        $verifier = new SessionTokenVerifier(\agentforge_session_token_secret());
        $claims = $verifier->verify($sessionToken);
        if ($claims === null || $claims['user_id'] !== $userId) {
            throw new ChartContextAuthorizationException(401, 'invalid_session');
        }

        $pid = self::sessionInt($session, 'pid');
        $chartUuid = $pid > 0 ? \agentforge_pid_to_uuid_string($pid) : null;

        $binding = new ActiveChartBinding($verifier);
        try {
            $binding->assertClaims($claims, $requestedPatientUuid, $chartUuid);
        } catch (ActiveChartBindingException $e) {
            if ($e->errorCode === 'invalid_session') {
                throw new ChartContextAuthorizationException(401, 'invalid_session', $e);
            }

            throw new ChartContextAuthorizationException(403, 'active_chart_mismatch', $e);
        }

        $provider = self::sessionString($session, 'authProvider');

        return [
            'claims' => $claims,
            'auth_user' => $authUser,
            'auth_provider' => $provider !== '' ? $provider : 'Default',
            'user_id' => $userId,
            'pid' => $pid,
        ];
    }

    /**
     * agentforge-api → module (PRD §5.3): shared secret + session token; no browser cookies.
     *
     * @return array{
     *     claims: array{user_id:int, patient_uuid:?string, encounter_id:?int, iat:int, exp:int},
     *     auth_user: string,
     *     auth_provider: string,
     *     user_id: int,
     *     pid: int
     * }
     */
    private static function authorizeTrustedAgentCall(string $sessionToken, string $requestedPatientUuid): array
    {
        $verifier = new SessionTokenVerifier(\agentforge_session_token_secret());
        $claims = $verifier->verify($sessionToken);
        if ($claims === null) {
            throw new ChartContextAuthorizationException(401, 'invalid_session');
        }

        $userRow = \sqlQuery(
            'SELECT `username` FROM `users` WHERE `id` = ?',
            [$claims['user_id']]
        );
        if ($userRow === false || empty($userRow['username']) || !\is_string($userRow['username'])) {
            throw new ChartContextAuthorizationException(401, 'invalid_session');
        }

        $authUser = $userRow['username'];
        if (!AclMain::aclCheckCore(AclMap::CHART_READ_SECTION, AclMap::CHART_READ_VALUE, $authUser)) {
            throw new ChartContextAuthorizationException(403, 'acl_denied');
        }

        $binding = new ActiveChartBinding($verifier);
        try {
            $binding->assertClaims($claims, $requestedPatientUuid, null);
        } catch (ActiveChartBindingException $e) {
            if ($e->errorCode === 'invalid_session') {
                throw new ChartContextAuthorizationException(401, 'invalid_session', $e);
            }

            throw new ChartContextAuthorizationException(403, 'active_chart_mismatch', $e);
        }

        $pid = 0;
        if ($requestedPatientUuid !== '') {
            if (!UuidRegistry::isValidStringUUID($requestedPatientUuid)) {
                throw new ChartContextAuthorizationException(403, 'active_chart_mismatch');
            }

            try {
                $bytes = UuidRegistry::uuidToBytes($requestedPatientUuid);
            } catch (\Exception) {
                throw new ChartContextAuthorizationException(403, 'active_chart_mismatch');
            }

            $pRow = \sqlQuery('SELECT `pid` FROM `patient_data` WHERE `uuid` = ?', [$bytes]);
            if ($pRow === false || !isset($pRow['pid'])) {
                throw new ChartContextAuthorizationException(403, 'active_chart_mismatch');
            }

            $pid = \is_numeric($pRow['pid']) ? (int) $pRow['pid'] : 0;
        }

        return [
            'claims' => $claims,
            'auth_user' => $authUser,
            'auth_provider' => 'Agent-API',
            'user_id' => $claims['user_id'],
            'pid' => $pid,
        ];
    }

    private static function sessionString(SessionInterface $session, string $key): string
    {
        $v = $session->get($key);

        return \is_string($v) ? $v : '';
    }

    private static function sessionInt(SessionInterface $session, string $key): int
    {
        $v = $session->get($key);
        if (\is_int($v)) {
            return $v;
        }

        if (\is_string($v) && \is_numeric($v)) {
            return (int) $v;
        }

        return 0;
    }
}
