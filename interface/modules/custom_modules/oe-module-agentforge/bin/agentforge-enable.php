<?php

/**
 * CLI: idempotent registration of the AgentForge module on a fresh OpenEMR DB.
 *
 * Run from the repo root after the OpenEMR DB is initialized (post-installer,
 * typically inside the deploy procedure §7.8 just before opening the URL):
 *
 *   docker compose exec openemr php interface/modules/custom_modules/oe-module-agentforge/bin/agentforge-enable.php
 *
 * Or on the host (requires PHP 8.2 + access to the OpenEMR sqlconf.php):
 *
 *   php interface/modules/custom_modules/oe-module-agentforge/bin/agentforge-enable.php
 *
 * Exit codes:
 *   0  — module is registered + active (Inserted), already active
 *        (Unchanged), or operator-disabled (OperatorDisabled, deploy continues).
 *   2  — DB error or missing sqlconf.php; deploy should halt and investigate.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from the CLI.\n");
    exit(2);
}

// Bootstrap into OpenEMR's autoloader + DB stack via the sites/default/sqlconf.php.
$repoRoot = (string) realpath(__DIR__ . '/../../../../..');
if ($repoRoot === '') {
    fwrite(STDERR, "agentforge-enable: could not locate repo root from " . __FILE__ . "\n");
    exit(2);
}

$sqlconf = $repoRoot . '/sites/default/sqlconf.php';
if (!is_readable($sqlconf)) {
    fwrite(STDERR, "agentforge-enable: sqlconf.php not found or not readable at {$sqlconf}\n");
    exit(2);
}

// Loading globals.php pulls in Composer autoload + DB primitives. We use the
// CLI flag $sessionAllowWrite=false to avoid touching the user session.
$_SERVER['HTTP_HOST'] ??= 'localhost';
$_SERVER['REQUEST_URI'] ??= '/';
$_SERVER['SCRIPT_NAME'] ??= '/agentforge-enable.php';
$ignoreAuth = true;
$sessionAllowWrite = false;

require_once $repoRoot . '/interface/globals.php';

use OpenEMR\Modules\AgentForge\Install\AgentForgeModuleRegistrar;
use OpenEMR\Modules\AgentForge\Install\QueryUtilsModulesRegistryStore;
use OpenEMR\Modules\AgentForge\Install\RegisterOutcome;

try {
    $registrar = new AgentForgeModuleRegistrar(new QueryUtilsModulesRegistryStore());
    $outcome = $registrar->ensureRegistered();
} catch (Throwable $e) {
    fwrite(STDERR, "agentforge-enable: FAIL — " . $e->getMessage() . "\n");
    exit(2);
}

$messages = [
    RegisterOutcome::Inserted->value => 'INSERTED — AgentForge module is now Active in modules table.',
    RegisterOutcome::Unchanged->value => 'OK — AgentForge module already registered + Active (no change).',
    RegisterOutcome::OperatorDisabled->value => 'NOTE — AgentForge module exists but mod_active=0 (operator disabled).'
        . ' Re-enable via Modules → Manage Modules → AgentForge → Enable.',
];

echo "agentforge-enable: " . ($messages[$outcome->value] ?? $outcome->value) . PHP_EOL;
exit(0);
