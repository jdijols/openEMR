<?php

/**
 * Header icon + right-rail shim for the Clinical Co-Pilot (PRD §4.1, §4.2 — Gate 2).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge;

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Twig\TwigContainer;
use OpenEMR\Core\OEGlobalsBag;
use OpenEMR\Events\Main\Tabs\RenderEvent;
use OpenEMR\Modules\AgentForge\Acl\AclMap;
use OpenEMR\Modules\AgentForge\Install\AgentForgeAclInstaller;
use Symfony\Component\EventDispatcher\EventDispatcherInterface;
use Twig\Environment;

final class Bootstrap
{
    private const RAIL_WIDTH_PX = 420;

    public function __construct(
        private readonly EventDispatcherInterface $eventDispatcher
    ) {
    }

    public function subscribeToEvents(): void
    {
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_NAV, $this->injectHeaderIcon(...));
        $this->eventDispatcher->addListener(RenderEvent::EVENT_BODY_RENDER_POST, $this->injectRailContainer(...));
    }

    public function injectHeaderIcon(): void
    {
        if (!$this->shouldShowChrome()) {
            return;
        }

        AgentForgeAclInstaller::ensureRegistered();
        echo $this->twig()->render('header_icon.html.twig', []);
    }

    public function injectRailContainer(): void
    {
        if (!$this->shouldShowChrome()) {
            return;
        }

        AgentForgeAclInstaller::ensureRegistered();
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

    private function shouldShowChrome(): bool
    {
        $session = SessionWrapperFactory::getInstance()->getActiveSession();
        $rawUser = $session->get('authUser');
        $authUser = \is_string($rawUser) ? $rawUser : '';
        if ($authUser === '') {
            return false;
        }

        return AclMain::aclCheckCore(AclMap::CHART_READ_SECTION, AclMap::CHART_READ_VALUE, $authUser);
    }

    private function twig(): Environment
    {
        $kernel = OEGlobalsBag::getInstance()->getKernel();
        $moduleTemplates = \dirname(__DIR__) . '/templates';

        return (new TwigContainer($moduleTemplates, $kernel))->getTwig();
    }
}
