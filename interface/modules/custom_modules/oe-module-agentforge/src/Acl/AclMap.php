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

final class AclMap
{
    public const CHART_READ_SECTION = 'patients';

    public const CHART_READ_VALUE = 'demo';

    public const MODULE_SECTION = 'agentforge';

    public const PROPOSE_WRITE = 'propose_write';

    public const MODULE_ADMIN = 'module_admin';
}
