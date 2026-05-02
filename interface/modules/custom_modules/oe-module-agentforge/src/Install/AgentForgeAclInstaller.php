<?php

/**
 * Lazily registers module-owned GACL objects (PRD §4.9) and seeds conservative
 * default ACL grants so only clinical-oriented OpenEMR groups reach AgentForge by default.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/open/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Install;

use OpenEMR\Common\Acl\AclExtended;
use OpenEMR\Gacl\GaclApi;
use OpenEMR\Modules\AgentForge\Acl\AclMap;

final class AgentForgeAclInstaller
{
    private static bool $ran = false;

    /**
     * OpenEMR stock ARO group `value` identifiers (Installer::install_gacl).
     *
     * @see \Installer::install_gacl()
     */
    private const DEFAULT_PRIVILEGED_GROUP_VALUES = ['admin', 'doc', 'clin', 'breakglass'];

    public static function ensureRegistered(): void
    {
        if (self::$ran) {
            return;
        }

        $gacl = new GaclApi();

        self::ensureAcosRegistered($gacl);
        self::ensureDefaultAclGrants($gacl);

        self::$ran = true;
    }

    private static function ensureAcosRegistered(GaclApi $gacl): void
    {
        if (!$gacl->get_object_section_section_id(null, AclMap::MODULE_SECTION, 'ACO')) {
            $gacl->add_object_section('AgentForge', AclMap::MODULE_SECTION, 100, 0, 'ACO');
        }

        $acos = [
            [AclMap::USE_COPILOT, 'AgentForge use clinical co-pilot'],
            [AclMap::PROPOSE_WRITE, 'AgentForge propose write'],
            [AclMap::MODULE_ADMIN, 'AgentForge module admin'],
        ];

        foreach ($acos as [$value, $title]) {
            if (!$gacl->get_object_id(AclMap::MODULE_SECTION, $value, 'ACO')) {
                $gacl->add_object(AclMap::MODULE_SECTION, $title, $value, 10, 0, 'ACO');
            }
        }

        /*
         * Back-compat marker: installs before the `use` ACO relied on detecting
         * MODULE_ADMIN existence only — those DBs skip `ensureRegistered` until
         * MODULE_ADMIN existed. We retain AclExtended visibility for admins.
         */
        if (
            !AclExtended::acoExist(AclMap::MODULE_SECTION, AclMap::MODULE_ADMIN)
            && !AclExtended::acoExist(AclMap::MODULE_SECTION, AclMap::PROPOSE_WRITE)
        ) {
            // Defensive branch only; add_object loops above populate all three ACOS normally.
            return;
        }
    }

    /**
     * Idempotent grants: Administrators, Physicians, Clinicians, and Emergency Login
     * (`admin`, `doc`, `clin`, `breakglass`) receive Clinical Co-Pilot use + propose_write.
     * Front Office (`front`), Accounting (`back`), parent `users`, custom groups: no implicit grant.
     */
    private static function ensureDefaultAclGrants(GaclApi $gacl): void
    {
        foreach (self::DEFAULT_PRIVILEGED_GROUP_VALUES as $groupValue) {
            $groupId = $gacl->get_group_id($groupValue, null);
            if ($groupId === false) {
                continue;
            }

            $row = $gacl->get_group_data((int) $groupId);
            if (!\is_array($row)) {
                continue;
            }

            $groupDisplayNameRaw = $row['name'] ?? '';
            $groupDisplayName = \is_string($groupDisplayNameRaw) ? $groupDisplayNameRaw : '';
            if ($groupDisplayName === '') {
                continue;
            }

            self::grantAcoIfMissing(
                $gacl,
                (int) $groupId,
                $groupDisplayName,
                AclMap::USE_COPILOT,
            );
            self::grantAcoIfMissing(
                $gacl,
                (int) $groupId,
                $groupDisplayName,
                AclMap::PROPOSE_WRITE,
            );
        }
    }

    private static function grantAcoIfMissing(
        GaclApi $gacl,
        int $aroGroupNumericId,
        string $aroGroupDisplayName,
        string $acoValue,
    ): void {
        /*
         * Ninth argument FALSE disables return_value filtering in search_acl
         * (otherwise NULL mismatches seeded `write` rows).
         */
        $existent = $gacl->search_acl(
            AclMap::MODULE_SECTION,
            $acoValue,
            false,
            false,
            $aroGroupDisplayName,
            false,
            false,
            false,
            false,
        );

        if (\is_array($existent) && $existent !== []) {
            return;
        }

        $gacl->add_acl(
            [AclMap::MODULE_SECTION => [$acoValue]],
            null,
            [$aroGroupNumericId],
            null,
            null,
            1,
            1,
            'write',
            'AgentForge default entitlement (' . $acoValue . '); adjust in ACL admin',
            'system',
        );
    }
}
