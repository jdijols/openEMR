<?php

/**
 * S2S launch-code redemption for agentforge-api (PRD §4.3, §5.2, S5).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);

use OpenEMR\Modules\AgentForge\Install\AgentForgeAclInstaller;
use OpenEMR\Modules\AgentForge\Security\LaunchCode;
use OpenEMR\Modules\AgentForge\Security\OpenEmrLaunchCodeStore;

if (!\agentforge_verify_internal_auth()) {
    \agentforge_emit_json(401, ['error' => 'invalid_launch_code']);
}

AgentForgeAclInstaller::ensureRegistered();

$input = \agentforge_json_input();
$launchCode = isset($input['launch_code']) && \is_string($input['launch_code']) ? \trim($input['launch_code']) : '';
if ($launchCode === '') {
    \agentforge_emit_json(401, ['error' => 'invalid_launch_code']);
}

$service = new LaunchCode(new OpenEmrLaunchCodeStore());
$payload = $service->redeemOrNull($launchCode, new \DateTimeImmutable('now'));
if ($payload === null) {
    \agentforge_emit_json(401, ['error' => 'invalid_launch_code']);
}

\agentforge_emit_json(200, [
    'user_id' => $payload->userId,
    'patient_uuid' => $payload->patientUuid,
    'encounter_id' => $payload->encounterId,
]);
