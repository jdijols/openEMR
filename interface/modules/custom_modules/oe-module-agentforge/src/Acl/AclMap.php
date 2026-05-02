<?php

/**
 * ACL identifiers used by AgentForge (PRD §4.9).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Acl;

use OpenEMR\Common\Acl\AclMain;

final class AclMap
{
    public const CHART_READ_SECTION = 'patients';

    public const CHART_READ_VALUE = 'demo';

    public const MODULE_SECTION = 'agentforge';

    /**
     * Product-level gate for the Clinical Co-Pilot UX (rail, launch, Context Service reads).
     * Chart access ({@see CHART_READ_VALUE}) remains a separate floor enforced first.
     */
    public const USE_COPILOT = 'use';

    public const PROPOSE_WRITE = 'propose_write';

    public const MODULE_ADMIN = 'module_admin';

    public static function userPassesAgentForgeReadGate(string $authUser): bool
    {
        return AclMain::aclCheckCore(self::CHART_READ_SECTION, self::CHART_READ_VALUE, $authUser)
            && AclMain::aclCheckCore(self::MODULE_SECTION, self::USE_COPILOT, $authUser);
    }

    /**
     * Full gate for proposing / confirming AgentForge writes (`public/write/`).
     */
    public static function userPassesAgentForgeProposeWriteGate(string $authUser): bool
    {
        return self::userPassesAgentForgeReadGate($authUser)
            && AclMain::aclCheckCore(self::MODULE_SECTION, self::PROPOSE_WRITE, $authUser);
    }
}
