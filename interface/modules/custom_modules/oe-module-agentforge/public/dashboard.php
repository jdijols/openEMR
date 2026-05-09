<?php

/**
 * Modernized Patient Dashboard loader (W2 Surprise Challenge — PRD §14, PD-93).
 *
 * Mirrors the panel.php pattern: validates the OpenEMR session, resolves the
 * active patient, and renders an HTML shell that boots the React bundle with a
 * pre-populated `window.__AGENTFORGE_DASHBOARD__` global. Auth model: the React
 * app sends the OpenEMR session cookie (same-origin) plus an `APICSRFTOKEN`
 * header on each FHIR call. OpenEMR's `LocalApiAuthorizationController`
 * (src/RestControllers/Authorization/LocalApiAuthorizationController.php)
 * accepts that pair on `/apis/default/fhir/*` requests, bypassing both the
 * Bearer-token strategy and downstream scope checks. This is the same auth
 * pathway `interface/main/tabs/main.php:133` uses for its own LocalApi calls.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/agentforge_common.php';

agentforge_require_globals();

use OpenEMR\Common\Csrf\CsrfUtils;
use OpenEMR\Common\Session\PatientSessionUtil;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Install\AgentForgeAclInstaller;

AgentForgeAclInstaller::ensureRegistered();

$session = SessionWrapperFactory::getInstance()->getActiveSession();
$authUser = (string) ($session->get('authUser') ?? '');
if ($authUser === '') {
    agentforge_emit_html(401, '<!DOCTYPE html><meta charset="utf-8"><title>Unauthenticated</title><body style="font-family:system-ui;padding:2rem;color:#475569">Session expired. <a href="../../../../../">Return to OpenEMR</a>.</body>');
}

$userId = (int) ($session->get('authUserID') ?? 0);
if ($userId <= 0) {
    agentforge_emit_html(401, '<!DOCTYPE html><meta charset="utf-8"><title>Unauthenticated</title><body style="font-family:system-ui;padding:2rem;color:#475569">No user context.</body>');
}

if (!AclMap::userPassesAgentForgeReadGate($authUser)) {
    agentforge_emit_html(403, '<!DOCTYPE html><meta charset="utf-8"><title>Access denied</title><body style="font-family:system-ui;padding:2rem;color:#475569">Access denied.</body>');
}

// Drop-in compatibility with the legacy chart load (interface/patient_file/summary/demographics.php).
// The calendar / finder / messages / dated_reminders all open patients via
// `?set_pid=N`. Honor it here so dashboard.php is a drop-in replacement and
// the JS RTop.location override (Bootstrap.php) doesn't have to mint a new
// auth flow on every patient switch.
$setPid = filter_input(\INPUT_GET, 'set_pid', \FILTER_VALIDATE_INT);
if (\is_int($setPid) && $setPid > 0) {
    PatientSessionUtil::setPid($setPid);
}

$pid = (int) ($session->get('pid') ?? 0);
$patientUuid = $pid > 0 ? \agentforge_pid_to_uuid_string($pid) : null;

/**
 * Mirror demographics.php's `setMyPatient()` JS so the chart-shell's
 * `app_view_model.application_data.patient` Knockout observable updates when
 * the user navigates here from the calendar (or any other set_pid entry
 * point). Without this, `parent.left_nav.setPatient(...)` is never called and
 * downstream consumers — most importantly the W1 Clinical Co-Pilot rail,
 * which subscribes to that observable to fetch a fresh launch code + start
 * the case-presentation generation — keep showing the previous patient.
 *
 * Only fires when `?set_pid=N` is in the URL (matches demographics.php's
 * gate at line 932). Subsequent same-patient navigations skip the JS so the
 * chart shell isn't churned needlessly.
 *
 * @return string JS to emit before the React bundle, or '' if no notification
 *                is needed.
 */
$leftNavNotifyJs = '';
if ($setPid !== null && $setPid > 0 && $pid === $setPid) {
    $patientRow = \sqlQuery(
        'SELECT `fname`, `lname`, `pubpid`, `DOB` FROM `patient_data` WHERE `pid` = ?',
        [$setPid],
    );
    if (\is_array($patientRow)) {
        $fullName = \trim(((string) ($patientRow['fname'] ?? '')) . ' ' . ((string) ($patientRow['lname'] ?? '')));
        $pubpid = (string) ($patientRow['pubpid'] ?? '');
        $dobRaw = (string) ($patientRow['DOB'] ?? '');
        $dobShort = '';
        $ageDigits = '';
        if ($dobRaw !== '' && $dobRaw !== '0000-00-00') {
            try {
                $dobDt = new \DateTimeImmutable($dobRaw);
                $today = new \DateTimeImmutable('today');
                $dobShort = $dobDt->format('m/d/Y');
                $ageDigits = (string) $dobDt->diff($today)->y;
            } catch (\Throwable) {
                $dobShort = '';
                $ageDigits = '';
            }
        }
        $caption = '';
        if ($dobShort !== '') {
            $caption = ' DOB: ' . $dobShort;
            if ($ageDigits !== '') {
                $caption .= ' Age: ' . $ageDigits;
            }
        }

        $encStmt = \sqlStatement(
            'SELECT fe.encounter, fe.date, c.pc_catname FROM form_encounter AS fe '
            . 'LEFT JOIN openemr_postcalendar_categories AS c ON fe.pc_catid = c.pc_catid '
            . 'WHERE fe.pid = ? ORDER BY fe.date DESC',
            [$setPid],
        );
        $encIds = [];
        $encDates = [];
        $encCats = [];
        while ($r = \sqlFetchArray($encStmt)) {
            $encIds[] = (string) ($r['encounter'] ?? '');
            $rawDate = (string) ($r['date'] ?? '');
            $ts = $rawDate !== '' ? \strtotime($rawDate) : false;
            $encDates[] = $ts !== false ? \date('m/d/Y', $ts) : '';
            $encCats[] = (string) ($r['pc_catname'] ?? '');
        }

        $jsonFlags = \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES;
        $args = [
            \json_encode($fullName, $jsonFlags),
            \json_encode((string) $setPid, $jsonFlags),
            \json_encode($pubpid, $jsonFlags),
            '""',
            \json_encode($caption, $jsonFlags),
        ];
        $encIdsJson = \json_encode($encIds, $jsonFlags);
        $encDatesJson = \json_encode($encDates, $jsonFlags);
        $encCatsJson = \json_encode($encCats, $jsonFlags);

        $leftNavNotifyJs = '<script>(function(){try{'
            . 'var p=window.parent;'
            . 'if(p&&p.left_nav&&typeof p.left_nav.setPatient==="function"){'
            . 'p.left_nav.setPatient(' . \implode(',', $args) . ');'
            . 'if(typeof p.left_nav.setPatientEncounter==="function"){'
            . 'p.left_nav.setPatientEncounter(' . $encIdsJson . ',' . $encDatesJson . ',' . $encCatsJson . ');'
            . '}'
            . 'if(typeof p.left_nav.syncRadios==="function"){p.left_nav.syncRadios();}'
            . '}'
            . '}catch(e){/* standalone-dev or cross-origin; CUI rail still works via session pid */}'
            . '})();</script>';
    }
}
if ($patientUuid === null || $patientUuid === '') {
    agentforge_emit_html(
        409,
        '<!DOCTYPE html><meta charset="utf-8"><title>No patient selected</title>'
        . '<body style="font-family:system-ui;padding:2rem;color:#475569">'
        . '<h1 style="font-size:1.25rem;font-weight:600;color:#0f172a;margin:0 0 .5rem">No patient selected</h1>'
        . '<p>Open a patient chart from the calendar to load the modernized dashboard.</p>'
        . '</body>'
    );
}

$csrfToken = CsrfUtils::collectCsrfToken($session, 'api');

$globals = OEGlobalsBag::getInstance();
$webroot = (string) $globals->getWebRoot();

$bundleDir = __DIR__ . '/dashboard';
$jsHash = @\md5_file($bundleDir . '/agentforge-dashboard.js');
$cssHash = @\md5_file($bundleDir . '/agentforge-dashboard-index.css');
$jsVersion = \is_string($jsHash) ? $jsHash : 'missing';
$cssVersion = \is_string($cssHash) ? $cssHash : 'missing';

$scriptSrc = \htmlspecialchars(
    $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/dashboard/agentforge-dashboard.js?v=' . $jsVersion,
    \ENT_QUOTES | \ENT_SUBSTITUTE,
    'UTF-8',
);
$styleHref = \htmlspecialchars(
    $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/dashboard/agentforge-dashboard-index.css?v=' . $cssVersion,
    \ENT_QUOTES | \ENT_SUBSTITUTE,
    'UTF-8',
);

$bootstrap = [
    'patientId' => $patientUuid,
    'pid' => $pid,
    'csrfToken' => $csrfToken,
    'fhirBase' => $webroot . '/apis/default/fhir',
    'webroot' => $webroot,
    'authUser' => $authUser,
];
$bootstrapJson = \json_encode($bootstrap, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES);

$html = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    . '<meta name="viewport" content="width=device-width,initial-scale=1">'
    . '<title>Dashboard</title>'
    . '<link rel="stylesheet" href="' . $styleHref . '">'
    . '<script>window.__AGENTFORGE_DASHBOARD__=' . $bootstrapJson . ';</script>'
    . '</head><body>'
    // The left_nav.setPatient notify fires synchronously before the React
    // bundle boots so the W1 CUI rail sees the patient change immediately.
    . $leftNavNotifyJs
    . '<div id="root"></div>'
    . '<script type="module" src="' . $scriptSrc . '"></script>'
    . '</body></html>';

\agentforge_emit_html(200, $html);
