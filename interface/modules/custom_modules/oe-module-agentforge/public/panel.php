<?php

/**
 * CUI panel entry: mints launch code embedded in document (PRD §4.2 / §4.3, S4/S5).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/agentforge_common.php';

agentforge_require_globals();

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
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

if (!AclMain::aclCheckCore(AclMap::CHART_READ_SECTION, AclMap::CHART_READ_VALUE, $authUser)) {
    agentforge_emit_json(403, ['error' => 'acl_denied']);
}

$pid = (int) ($session->get('pid') ?? 0);
$patientUuid = \agentforge_pid_to_uuid_string($pid);
$encounter = $session->get('encounter');
$encounterId = \is_numeric($encounter) ? (int) $encounter : null;

$service = new LaunchCode(new OpenEmrLaunchCodeStore());
$code = $service->mint($userId, $patientUuid, $encounterId, new \DateTimeImmutable('now'));
$attr = \htmlspecialchars($code, \ENT_QUOTES | \ENT_SUBSTITUTE, 'UTF-8');

$patientAttr = $patientUuid !== null && $patientUuid !== ''
    ? \htmlspecialchars($patientUuid, \ENT_QUOTES | \ENT_SUBSTITUTE, 'UTF-8')
    : '';

$apiPublic = \getenv('AGENTFORGE_API_PUBLIC_URL');
$apiPublicStr = (\is_string($apiPublic) && $apiPublic !== '') ? $apiPublic : '';
$apiPublicJson = \json_encode($apiPublicStr, \JSON_THROW_ON_ERROR);

$globals = OEGlobalsBag::getInstance();
$webroot = $globals->getWebRoot();

/*
 * Cache-bust the CUI bundle by content hash (G6-16). Without this, the
 * browser caches `agentforge-cui.js` the first time it loads and never
 * refetches across redeploys, so any client-side fix (e.g. the brief
 * consistency PR1) silently fails to reach operators on already-warmed
 * tabs. Hashing the file on every request is cheap (~64 KB read) and
 * happens once per chart open. `md5_file()` returns false on a missing
 * file — fall back to a constant marker so the iframe still loads (the
 * resulting 404 will surface in the console with a recognisable URL).
 */
$bundleDir = __DIR__ . '/cui';
$jsHash = @\md5_file($bundleDir . '/agentforge-cui.js');
$cssHash = @\md5_file($bundleDir . '/agentforge-cui-index.css');
$jsVersion = \is_string($jsHash) ? $jsHash : 'missing';
$cssVersion = \is_string($cssHash) ? $cssHash : 'missing';

$scriptSrc = \htmlspecialchars(
    $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.js?v=' . $jsVersion,
    \ENT_QUOTES | \ENT_SUBSTITUTE,
    'UTF-8',
);
$styleHref = \htmlspecialchars(
    $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui-index.css?v=' . $cssVersion,
    \ENT_QUOTES | \ENT_SUBSTITUTE,
    'UTF-8',
);

$html = '<!DOCTYPE html><html lang="en" data-launch-code="' . $attr . '" data-patient-uuid="' . $patientAttr
    . '"><head><meta charset="utf-8"><title>AgentForge panel</title>'
    . '<link rel="stylesheet" href="' . $styleHref . '">'
    . '<script>window.__AGENTFORGE_CUI__={apiBase:' . $apiPublicJson . '};</script>'
    . '</head><body><div id="agentforge-panel-root"></div>'
    . '<script type="module" src="' . $scriptSrc . '"></script></body></html>';

\agentforge_emit_html(200, $html);
