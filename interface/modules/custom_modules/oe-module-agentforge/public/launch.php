<?php

/**
 * Mint launch code; deliver only as HTML data attribute (PRD §4.3, S5).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/agentforge_common.php';

agentforge_require_globals();

use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Context\AppointmentEncounterBinder;
use OpenEMR\Modules\AgentForge\Install\AgentForgeAclInstaller;
use OpenEMR\Modules\AgentForge\Security\LaunchCode;
use OpenEMR\Modules\AgentForge\Security\OpenEmrLaunchCodeStore;

AgentForgeAclInstaller::ensureRegistered();

$session = SessionWrapperFactory::getInstance()->getActiveSession();
$authUser = (string) ($session->get('authUser') ?? '');
if ($authUser === '') {
    agentforge_emit_json(401, ['error' => 'unauthenticated']);
}

$userId = (int) ($session->get('authUserID') ?? 0);
if ($userId <= 0) {
    agentforge_emit_json(401, ['error' => 'unauthenticated']);
}

if (!AclMap::userPassesAgentForgeReadGate($authUser)) {
    agentforge_emit_json(403, ['error' => 'acl_denied']);
}

$pid = (int) ($session->get('pid') ?? 0);
$patientUuid = \agentforge_pid_to_uuid_string($pid);
$encounterId = (new AppointmentEncounterBinder())->bindForCurrentPatient($pid)->encounterId;

$service = new LaunchCode(new OpenEmrLaunchCodeStore());
$code = $service->mint($userId, $patientUuid, $encounterId, new \DateTimeImmutable('now'));
$attr = \htmlspecialchars($code, \ENT_QUOTES | \ENT_SUBSTITUTE, 'UTF-8');
$html = '<!DOCTYPE html><html lang="en" data-launch-code="' . $attr . '"><head><meta charset="utf-8"><title>AgentForge</title></head><body></body></html>';

\agentforge_emit_html(200, $html);
