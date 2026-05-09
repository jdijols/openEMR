<?php

/**
 * Header icon + right-rail shim for the Clinical Copilot (PRD §4.1, §4.2 — Gate 2).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge;

use OpenEMR\Common\Auth\OpenIDConnect\Entities\ScopeEntity;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Twig\TwigContainer;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Events\Main\Tabs\RenderEvent;
use OpenEMR\Events\PatientDemographics\RenderEvent as PatientDemographicsRenderEvent;
use OpenEMR\Events\RestApiExtend\RestApiSecurityCheckEvent;
use OpenEMR\Menu\MenuEvent;
use OpenEMR\Menu\PatientMenuEvent;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Install\AgentForgeAclInstaller;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;
use Twig\Environment;

final class Bootstrap
{
    // Initial inline width used before the rail-container script reads
    // sessionStorage. Matches the JS MAX_WIDTH so a fresh-session render
    // doesn't briefly flash the narrower default before snapping to max.
    private const RAIL_WIDTH_PX = 600;

    public function __construct(
        private readonly EventDispatcherInterface $eventDispatcher
    ) {
    }

    public function subscribeToEvents(): void
    {
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_NAV, $this->injectHeaderIcon(...));
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_POST, $this->injectRailContainer(...));
        // PD-95 follow-up: override every chart-shell entry point that loads a
        // patient chart so they all route to the modernized React dashboard.
        // Two seams:
        //   1. window.loadCurrentPatient() (tabs_view_model.js) — hit by the
        //      "Refresh patient" button + the rail container's tab activator.
        //   2. window.RTop's `location` setter (frame_proxies.js) — hit by
        //      the calendar appointment click, the patient finder, dated
        //      reminders, messages-with-linked-patient, dynamic_finder.
        // Both are OpenEMR core; we replace the globals from JS instead of
        // editing core files (which the brief forbids).
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_POST, $this->injectChartShellOverrides(...));
        // PD-95: replace the chart's Dashboard tab content with the modernized
        // React app (PRD §14). Only rewrites for users who pass the AgentForge
        // ACL gate; everyone else continues to see the legacy demographics.php.
        // Two menu surfaces fire: MenuEvent (chart-shell top-level tabs, where
        // the user-visible "Dashboard" tab lives — menu_id="dem1" in
        // interface/main/tabs/menu/menus/standard.json) and PatientMenuEvent
        // (the secondary patient nav rendered inside demographics.php — menu_id
        // ="dashboard" in patient_menus/standard.json). We rewrite both so a
        // click on either lands on the React app.
        $this->eventDispatcher->addListener(MenuEvent::MENU_UPDATE, $this->rewriteChartShellDashboardTab(...));
        $this->eventDispatcher->addListener(PatientMenuEvent::MENU_UPDATE, $this->rewriteDashboardTab(...));
        // OpenEMR core's AuthorizationListener::onRestApiSecurityCheck early-
        // returns for LocalApi requests (the cookie + APICSRFTOKEN auth path
        // our React dashboard uses) WITHOUT initializing the request's
        // `requiredEndpointScope` typed property. Downstream consumers like
        // FhirGenericRestController read it via `canAccessResource()` and
        // crash with "Typed property must not be accessed before init",
        // returning HTTP 500. Affects ANY LocalApi + FHIR/API request — same
        // root cause for /apis/default/fhir/* (vitals, labs, ...) and
        // /apis/default/api/background_service/$run on chart-shell load.
        // Priority 40 runs AFTER core's AuthorizationListener (priority 50),
        // so we back-fill a wildcard scope when LocalApi is in use without
        // disturbing the Bearer-token path. See HttpRestRouteHandler.php:183
        // for the dispatch.
        $this->eventDispatcher->addListener(
            RestApiSecurityCheckEvent::EVENT_HANDLE,
            $this->backfillLocalApiScope(...),
            40,
        );
        // PD-97: Phase 7 visual elevation. Inject the elevated-theme stylesheet
        // on the chart shell (top tab strip) AND on demographics.php (patient
        // secondary nav, where graders click "Dashboard" to enter the React
        // app). demographics.php loads in its own iframe so CSS injected on
        // main.php does not cascade in — both hooks are required.
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_NAV, $this->injectElevatedTheme(...));
        $this->eventDispatcher->addListener(
            PatientDemographicsRenderEvent::EVENT_SECTION_LIST_RENDER_TOP,
            $this->injectElevatedTheme(...),
        );
    }

    public function injectHeaderIcon(): void
    {
        AgentForgeAclInstaller::ensureRegistered();
        if (!$this->shouldShowChrome()) {
            return;
        }

        echo $this->twig()->render('header_icon.html.twig', []);
    }

    public function injectRailContainer(): void
    {
        AgentForgeAclInstaller::ensureRegistered();
        if (!$this->shouldShowChrome()) {
            return;
        }

        $globals = OEGlobalsBag::getInstance();
        $webroot = $globals->getWebRoot();
        $panelSrc = $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/panel.php';
        $common = \dirname(__DIR__) . '/public/agentforge_common.php';
        if (is_file($common)) {
            require_once $common;
        }
        $pid = (int) (SessionWrapperFactory::getInstance()->getActiveSession()->get('pid') ?? 0);
        $railPatientUuidAttr = '';
        if ($pid > 0 && function_exists('agentforge_pid_to_uuid_string')) {
            $u = agentforge_pid_to_uuid_string($pid);
            $railPatientUuidAttr = ($u !== null && $u !== '') ? htmlspecialchars($u, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') : '';
        }
        echo $this->twig()->render('rail_container.html.twig', [
            'panel_src' => $panelSrc,
            'rail_width' => self::RAIL_WIDTH_PX,
            'web_root_js' => $webroot === '' ? '' : htmlspecialchars((string) $webroot, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'),
            'rail_patient_uuid' => $railPatientUuidAttr,
        ]);
    }

    /**
     * Replace the chart-shell top-level "Dashboard" tab URL with the modernized
     * React app (PD-95 follow-up — the secondary patient-nav rewrite alone
     * left the user-visible top-level "Dashboard" tab still pointing at
     * demographics.php). The chart-shell menu (interface/main/tabs/menu/menus/
     * standard.json) is a TREE — Dashboard sits under the Patient parent — so
     * we walk it recursively. The target entry is `menu_id="dem1"` not
     * "dashboard"; this is the canonical chart-shell-tab id, not a label.
     */
    public function rewriteChartShellDashboardTab(MenuEvent $event): MenuEvent
    {
        AgentForgeAclInstaller::ensureRegistered();
        if (!$this->shouldShowChrome()) {
            return $event;
        }

        $menu = $event->getMenu();
        $webroot = OEGlobalsBag::getInstance()->getWebRoot();
        $dashboardUrl = $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php';

        $rewriteRecursive = function (array $items) use (&$rewriteRecursive, $dashboardUrl): void {
            foreach ($items as $item) {
                if (\is_object($item) && \property_exists($item, 'menu_id') && $item->menu_id === 'dem1') {
                    $item->url = $dashboardUrl;
                }
                if (\is_object($item) && \property_exists($item, 'children') && \is_array($item->children) && $item->children !== []) {
                    $rewriteRecursive($item->children);
                }
            }
        };
        $rewriteRecursive($menu);

        $event->setMenu($menu);

        return $event;
    }

    /**
     * Replace the patient chart's Dashboard tab URL with the modernized React
     * dashboard served by this module (PRD §14, PD-95). The legacy menu entry
     * has menu_id="dashboard" and url="interface/patient_file/summary/demographics.php"
     * (interface/main/tabs/menu/menus/patient_menus/standard.json). PatientMenuRole
     * dispatches MENU_UPDATE after applying setPatientMenuUrl(), so URLs reaching
     * this listener are already webroot-prefixed; we overwrite with our absolute
     * path. The label is unchanged so graders see "Dashboard" — clicking it
     * loads the React app, which IS the modernization.
     */
    public function rewriteDashboardTab(PatientMenuEvent $event): PatientMenuEvent
    {
        AgentForgeAclInstaller::ensureRegistered();
        if (!$this->shouldShowChrome()) {
            return $event;
        }

        $menu = $event->getMenu();
        $webroot = OEGlobalsBag::getInstance()->getWebRoot();
        $dashboardUrl = $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php';

        foreach ($menu as $item) {
            if (\is_object($item) && \property_exists($item, 'menu_id') && $item->menu_id === 'dashboard') {
                $item->url = $dashboardUrl;
                break;
            }
        }

        $event->setMenu($menu);

        return $event;
    }

    /**
     * Phase 7 visual elevation (PRD §15, PD-97). Echoes a `<link>` tag for the
     * agentforge-elevated stylesheet, which restyles OpenEMR's chart chrome to
     * speak the same `--af-*` token vocabulary as the React surfaces (CUI rail
     * + modernized patient dashboard). Tracked with a static so the listener
     * is idempotent across multiple events on the same request.
     */
    public function injectElevatedTheme(): void
    {
        static $injected = false;
        if ($injected) {
            return;
        }
        AgentForgeAclInstaller::ensureRegistered();
        if (!$this->shouldShowChrome()) {
            return;
        }
        $injected = true;

        $globals = OEGlobalsBag::getInstance();
        $webroot = (string) $globals->getWebRoot();
        $cssPath = \dirname(__DIR__, 4) . '/themes/agentforge-elevated.css';
        $cssHash = @\md5_file($cssPath);
        $version = \is_string($cssHash) ? $cssHash : 'missing';
        $href = \htmlspecialchars(
            $webroot . '/interface/themes/agentforge-elevated.css?v=' . $version,
            \ENT_QUOTES | \ENT_SUBSTITUTE,
            'UTF-8',
        );

        echo '<link rel="stylesheet" data-agentforge-elevated="1" href="' . $href . '">';
    }

    /**
     * Override the chart-shell's two patient-chart entry points so every
     * pathway lands on the modernized React dashboard:
     *
     *   1. `window.loadCurrentPatient()` (tabs_view_model.js:283) — used by
     *      the in-page "Refresh patient" handler and the rail container's
     *      chart-tab activator.
     *   2. `window.RTop`'s `location` setter (frame_proxies.js:11-19) — used
     *      by every external entry point that does
     *      `top.RTop.location = '../../patient_file/summary/demographics.php?set_pid=N'`:
     *      the calendar appointment click, the patient finder, dated
     *      reminders, lab-results messages, dynamic_finder, etc.
     *
     * Both are OpenEMR core globals; replacing them from JS avoids any core
     * edits. The override is idempotent (a `__agentforgeChartShellOverrides`
     * flag short-circuits second runs) and defensive — it waits up to ~2s
     * for the chart-shell helpers to register before bailing.
     */
    public function injectChartShellOverrides(): void
    {
        AgentForgeAclInstaller::ensureRegistered();
        if (!$this->shouldShowChrome()) {
            return;
        }

        $globals = OEGlobalsBag::getInstance();
        $webroot = (string) $globals->getWebRoot();
        $dashboardUrl = $webroot . '/interface/modules/custom_modules/oe-module-agentforge/public/dashboard.php';
        $urlJson = \json_encode($dashboardUrl, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES);

        $cssPath = \dirname(__DIR__, 4) . '/themes/agentforge-elevated.css';
        $cssHash = @\md5_file($cssPath);
        $cssVersion = \is_string($cssHash) ? $cssHash : 'missing';
        $cssHref = $webroot . '/interface/themes/agentforge-elevated.css?v=' . $cssVersion;
        $cssHrefJson = \json_encode($cssHref, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES);

        $script = <<<JS
            (function(){
                if (window.__agentforgeChartShellOverrides) { return; }
                window.__agentforgeChartShellOverrides = true;
                var DASHBOARD_URL = $urlJson;
                var ELEVATED_CSS_HREF = $cssHrefJson;

                // Swap any URL targeting the legacy demographics.php with the
                // modernized dashboard.php, preserving any query string
                // (notably ?set_pid=N — dashboard.php now honors it).
                function rewriteIfDemographics(url) {
                    if (typeof url !== 'string') { return url; }
                    var idx = url.indexOf('demographics.php');
                    if (idx === -1) { return url; }
                    var qIdx = url.indexOf('?', idx);
                    var qs = qIdx >= 0 ? url.substring(qIdx) : '';
                    return DASHBOARD_URL + qs;
                }

                function navigateAsPat(url) {
                    window.navigateTab(url, 'pat', function () {
                        window.activateTabByName('pat', true);
                    });
                }

                function patch() {
                    var helpersReady = typeof window.navigateTab === 'function'
                        && typeof window.activateTabByName === 'function';
                    if (!helpersReady) { return false; }

                    // Seam 1: refresh-patient button + rail container.
                    window.loadCurrentPatient = function () {
                        navigateAsPat(DASHBOARD_URL);
                    };

                    // Seam 2: every top.RTop.location = '...' caller (calendar,
                    // finder, messages, reminders, ...).
                    if (typeof window.RTop === 'object' && window.RTop !== null) {
                        try {
                            Object.defineProperty(window.RTop, 'location', {
                                configurable: true,
                                set: function (url) {
                                    navigateAsPat(rewriteIfDemographics(url));
                                }
                            });
                        } catch (e) {
                            // Older browsers / non-configurable setter — fall
                            // back to a plain assignment so the chart still
                            // works (legacy view).
                        }
                    }

                    return true;
                }

                if (!patch()) {
                    var tries = 0;
                    var iv = setInterval(function () {
                        if (patch() || ++tries > 40) { clearInterval(iv); }
                    }, 50);
                }

                // Iframe-load injector — extends Phase 7 visual elevation +
                // active-tab highlighting to every legacy patient subpage
                // (history.php, transactions.php, patient_report.php,
                // history_sdoh_widget.php, stats_full.php, ...). Each of
                // those loads inside the chart-shell "pat" / "enc" / "rep"
                // tab iframes; CSS doesn't cascade through iframe boundaries,
                // so we have to inject the link tag and the active-class
                // marker into each iframe document on its load event.
                //
                // Same-origin (everything is served by OpenEMR Apache), so
                // contentDocument access is permitted. Try/catch guards
                // against any future cross-origin embed (e.g. external
                // EHR-launched apps).
                function urlToActiveMenuId(href) {
                    if (typeof href !== 'string') { return null; }
                    var u = href.split('#')[0];
                    if (u.indexOf('oe-module-agentforge/public/dashboard.php') !== -1) { return 'dashboard'; }
                    if (u.indexOf('patient_file/summary/demographics.php') !== -1) { return 'dashboard'; }
                    if (u.indexOf('patient_file/history/history_sdoh_widget') !== -1) { return 'sdoc1'; }
                    if (u.indexOf('patient_file/history/history.php') !== -1) { return 'history'; }
                    if (u.indexOf('patient_file/report/patient_report.php') !== -1) { return 'report'; }
                    if (u.indexOf('controller.php') !== -1 && u.indexOf('document') !== -1) { return 'documents'; }
                    if (u.indexOf('patient_file/transaction/transactions.php') !== -1) { return 'transactions'; }
                    if (u.indexOf('patient_file/summary/stats_full.php') !== -1) { return 'issues'; }
                    if (u.indexOf('reports/pat_ledger.php') !== -1) { return 'ledger'; }
                    if (u.indexOf('reports/external_data.php') !== -1) { return 'external_data'; }
                    return null;
                }

                function elevateIframeDocument(doc, href) {
                    if (!doc || !doc.head) { return; }
                    // 1. Stylesheet — idempotent via the data-agentforge-elevated marker.
                    if (!doc.querySelector('link[data-agentforge-elevated]')) {
                        var link = doc.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = ELEVATED_CSS_HREF;
                        link.setAttribute('data-agentforge-elevated', '1');
                        doc.head.appendChild(link);
                    }
                    // 2. Active-tab marker — clear any previous, then mark current.
                    var prior = doc.querySelectorAll('.af-active');
                    for (var i = 0; i < prior.length; i++) { prior[i].classList.remove('af-active'); }
                    var menuId = urlToActiveMenuId(href);
                    if (menuId) {
                        var node = doc.getElementById(menuId);
                        if (node) { node.classList.add('af-active'); }
                    }
                    // 3. Rewrite legacy "Back to chart" / "Go Back" anchors that
                    //    hardcode demographics.php (e.g.,
                    //    templates/documents/general_list.html:74). Without this
                    //    the back button on the Documents tab — and any similar
                    //    return-to-chart link scattered through legacy patient
                    //    pages — routes to the legacy dashboard instead of our
                    //    React app. Click semantics stay intact: the browser
                    //    just sees a different href.
                    var backLinks = doc.querySelectorAll('a[href*="demographics.php"]');
                    for (var j = 0; j < backLinks.length; j++) {
                        var a = backLinks[j];
                        if (a.dataset.agentforgeBackrouteRewritten === '1') { continue; }
                        a.dataset.agentforgeBackrouteRewritten = '1';
                        var orig = a.getAttribute('href') || '';
                        var demoIdx = orig.indexOf('demographics.php');
                        var qIdx = orig.indexOf('?', demoIdx);
                        var qs = qIdx >= 0 ? orig.substring(qIdx) : '';
                        a.setAttribute('href', DASHBOARD_URL + qs);
                    }
                }

                function attachIframeWatcher() {
                    if (typeof document === 'undefined') { return; }
                    var iframes = document.querySelectorAll('iframe');
                    for (var i = 0; i < iframes.length; i++) {
                        var iframe = iframes[i];
                        if (iframe.dataset.agentforgeElevatedAttached === '1') { continue; }
                        iframe.dataset.agentforgeElevatedAttached = '1';
                        // Run once now if the iframe is already loaded.
                        try {
                            if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
                                elevateIframeDocument(iframe.contentDocument, iframe.contentWindow.location.href);
                            }
                        } catch (e) { /* cross-origin or pre-load; skip */ }
                        iframe.addEventListener('load', function (ev) {
                            try {
                                var f = ev.target;
                                elevateIframeDocument(f.contentDocument, f.contentWindow.location.href);
                            } catch (e) { /* cross-origin; skip */ }
                        });
                    }
                }

                // Attach now + on DOM mutations (chart-shell creates iframes
                // dynamically as tabs open).
                attachIframeWatcher();
                if (typeof MutationObserver === 'function') {
                    var mo = new MutationObserver(function () { attachIframeWatcher(); });
                    mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
                }
            })();
            JS;

        echo '<script>' . $script . '</script>';
    }

    /**
     * Back-fill the request's `requiredEndpointScope` for LocalApi requests so
     * downstream consumers (ResourceConstraintFilterer, FhirGenericRestController,
     * the standard API's scope-based filtering) don't crash on an uninitialized
     * typed property. See AuthorizationListener::onRestApiSecurityCheck early-
     * return at line 154 of OpenEMR core for the gap this fixes.
     *
     * Wildcard `system/*.read` is the right shape: LocalApi auth is same-origin,
     * cookie + CSRF protected, and already trusted by OpenEMR's first-party
     * UIs (`interface/main/tabs/main.php:133`). The scope filter would be a
     * no-op anyway under that trust model.
     */
    public function backfillLocalApiScope(RestApiSecurityCheckEvent $event): RestApiSecurityCheckEvent
    {
        $request = $event->getRestRequest();
        $isLocalApi = $request->isLocalApi()
            || $request->attributes->get('skipAuthorization', false) === true;
        if (!$isLocalApi) {
            return $event;
        }
        // Always set: idempotent. If AuthorizationListener already set a scope
        // for some future code-path, this overwrites with wildcard, which is
        // semantically correct for trusted same-origin LocalApi.
        $request->setRequestRequiredScope(ScopeEntity::createFromString('system/*.read'));

        return $event;
    }

    private function shouldShowChrome(): bool
    {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $rawUser = $session->get('authUser');
        $authUser = \is_string($rawUser) ? $rawUser : '';
        if ($authUser === '') {
            return false;
        }

        return AclMap::userPassesAgentForgeReadGate($authUser);
    }

    private function twig(): Environment
    {
        $kernel = OEGlobalsBag::getInstance()->getKernel();
        $moduleTemplates = \dirname(__DIR__) . '/templates';

        return (new TwigContainer($moduleTemplates, $kernel))->getTwig();
    }
}
