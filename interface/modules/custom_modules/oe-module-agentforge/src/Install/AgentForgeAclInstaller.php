<?php

/**
 * Lazily registers module-owned GACL objects (PRD §4.9). Safe to call until ACOs exist.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Install;

use OpenEMR\Common\Acl\AclExtended;
use OpenEMR\Gacl\GaclApi;
use OpenEMR\Modules\AgentForge\Acl\AclMap;

final class AgentForgeAclInstaller
{
    private static bool $ran = false;

    public static function ensureRegistered(): void
    {
        if (self::$ran) {
            return;
        }

        if (AclExtended::acoExist(AclMap::MODULE_SECTION, AclMap::MODULE_ADMIN)) {
            self::$ran = true;

            return;
        }

        $gacl = new GaclApi();
        if (!$gacl->get_object_section_section_id(null, AclMap::MODULE_SECTION, 'ACO')) {
            $gacl->add_object_section('AgentForge', AclMap::MODULE_SECTION, 100, 0, 'ACO');
        }

        $acos = [
            [AclMap::PROPOSE_WRITE, 'AgentForge propose write'],
            [AclMap::MODULE_ADMIN, 'AgentForge module admin'],
        ];

        foreach ($acos as [$value, $title]) {
            if (!$gacl->get_object_id(AclMap::MODULE_SECTION, $value, 'ACO')) {
                $gacl->add_object(AclMap::MODULE_SECTION, $title, $value, 10, 0, 'ACO');
            }
        }

        self::$ran = true;
    }
}
