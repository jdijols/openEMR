<?php

/**
 * Idempotent registration of the AgentForge module in the OpenEMR `modules`
 * table on fresh installs (PRD §7.7, §7.8; G6-18).
 *
 * Without this, a fresh OpenEMR DB requires an admin to navigate to
 * Modules → Manage Modules and click "Register" + "Install" + "Enable" before
 * AgentForge boots. Run from a CLI script (`bin/agentforge-enable.php`) at
 * deploy time.
 *
 * Behavior (idempotent — safe to run on every deploy):
 *   - If no row for `mod_directory='oe-module-agentforge'` exists, INSERT one
 *     with mod_active=1, type=MODULE_TYPE_CUSTOM (0).
 *   - If a row exists with mod_active=1, no-op (RegisterOutcome::Unchanged).
 *   - If a row exists with mod_active=0, do NOT clobber it — that means an
 *     admin intentionally disabled AgentForge (e.g. for an incident rollback
 *     per G6-17). The CLI script reports OperatorDisabled and exits 0 so the
 *     deploy continues.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Install;

enum RegisterOutcome: string
{
    case Inserted = 'inserted';
    case Unchanged = 'unchanged';
    case OperatorDisabled = 'operator_disabled';
}

final readonly class AgentForgeModuleRegistrar
{
    /** PRD §3.4 — directory name relative to interface/modules/custom_modules/. */
    public const MOD_DIRECTORY = 'oe-module-agentforge';

    /** Display name shown in the Module Manager UI. */
    public const MOD_NAME = 'AgentForge Clinical Co-Pilot';

    /** Custom module type discriminator (mirrors InstModuleTable::MODULE_TYPE_CUSTOM). */
    public const MODULE_TYPE_CUSTOM = 0;

    /** Module description shown in Manage Modules. */
    public const MOD_DESCRIPTION
        = 'V1 embedded co-pilot: rail CUI, Context Service, Agent API handoff (PRD AgentForge).';

    /** Schema version stamp recorded on install. */
    public const SQL_VERSION = '0.1.0-gate6';

    /** ACL fixture version stamp recorded on install. */
    public const ACL_VERSION = '0.1.0-gate6';

    public function __construct(
        private ModulesRegistryStore $store,
    ) {
    }

    /**
     * Registers the AgentForge module idempotently. Returns the outcome so
     * callers (CLI script, tests) can report it without inferring from logs.
     */
    public function ensureRegistered(): RegisterOutcome
    {
        $existing = $this->store->findByDirectory(self::MOD_DIRECTORY);

        if ($existing === null) {
            $this->store->insertActive([
                'mod_name' => self::MOD_NAME,
                'mod_directory' => self::MOD_DIRECTORY,
                'mod_relative_link' => 'custom_modules/' . self::MOD_DIRECTORY,
                'mod_ui_name' => self::MOD_NAME,
                'mod_description' => self::MOD_DESCRIPTION,
                'directory' => self::MOD_DIRECTORY,
                'type' => self::MODULE_TYPE_CUSTOM,
                'sql_version' => self::SQL_VERSION,
                'acl_version' => self::ACL_VERSION,
            ]);

            return RegisterOutcome::Inserted;
        }

        if ($existing['mod_active'] === 0) {
            return RegisterOutcome::OperatorDisabled;
        }

        return RegisterOutcome::Unchanged;
    }
}
