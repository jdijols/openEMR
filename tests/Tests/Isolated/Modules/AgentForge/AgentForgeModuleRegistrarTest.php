<?php

/**
 * G6-18 — AgentForge module auto-registration is idempotent and
 * operator-respectful.
 *
 * Asserts:
 *   1. On a fresh schema (no row), ensureRegistered() inserts the row with
 *      mod_active=1.
 *   2. On a re-run with a row already present + mod_active=1, no insert
 *      happens (returns Unchanged).
 *   3. On a row with mod_active=0, no insert / no UPDATE happens (returns
 *      OperatorDisabled). The admin's disable decision is preserved.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Install/ModulesRegistryStore.php';
require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Install/AgentForgeModuleRegistrar.php';

use OpenEMR\Modules\AgentForge\Install\AgentForgeModuleRegistrar;
use OpenEMR\Modules\AgentForge\Install\ModulesRegistryStore;
use OpenEMR\Modules\AgentForge\Install\RegisterOutcome;
use PHPUnit\Framework\TestCase;

/**
 * In-memory ModulesRegistryStore for tests. Records every operation so the
 * test can assert on idempotency (no spurious INSERTs / UPDATEs).
 */
final class InMemoryModulesRegistryStore implements ModulesRegistryStore
{
    /** @var array<string, array{mod_id: int, mod_active: int}> */
    private array $rows = [];

    public int $insertCount = 0;
    /** @var list<array{mod_directory: string, mod_active: int}> */
    public array $insertedRows = [];

    public function findByDirectory(string $modDirectory): ?array
    {
        return $this->rows[$modDirectory] ?? null;
    }

    public function insertActive(array $row): void
    {
        $this->insertCount++;
        $this->insertedRows[] = [
            'mod_directory' => $row['mod_directory'],
            'mod_active' => 1,
        ];
        $this->rows[$row['mod_directory']] = [
            'mod_id' => count($this->rows) + 1,
            'mod_active' => 1,
        ];
    }

    public function setRow(string $modDirectory, int $modActive): void
    {
        $this->rows[$modDirectory] = [
            'mod_id' => count($this->rows) + 1,
            'mod_active' => $modActive,
        ];
    }
}

final class AgentForgeModuleRegistrarTest extends TestCase
{
    public function testFreshSchemaInsertsActiveRow(): void
    {
        $store = new InMemoryModulesRegistryStore();
        $registrar = new AgentForgeModuleRegistrar($store);

        $outcome = $registrar->ensureRegistered();

        self::assertSame(RegisterOutcome::Inserted, $outcome);
        self::assertSame(1, $store->insertCount);
        self::assertSame('oe-module-agentforge', $store->insertedRows[0]['mod_directory']);
        self::assertSame(1, $store->insertedRows[0]['mod_active']);
    }

    public function testRerunWithActiveRowIsNoop(): void
    {
        $store = new InMemoryModulesRegistryStore();
        $store->setRow(AgentForgeModuleRegistrar::MOD_DIRECTORY, 1);
        $registrar = new AgentForgeModuleRegistrar($store);

        $outcome = $registrar->ensureRegistered();

        self::assertSame(RegisterOutcome::Unchanged, $outcome);
        self::assertSame(0, $store->insertCount);
    }

    public function testOperatorDisabledRowIsPreserved(): void
    {
        // Operator disabled AgentForge via Manage Modules (e.g. for a G6-17
        // rollback). Re-running the registrar must NOT silently re-enable —
        // that would clobber the operator's safety decision.
        $store = new InMemoryModulesRegistryStore();
        $store->setRow(AgentForgeModuleRegistrar::MOD_DIRECTORY, 0);
        $registrar = new AgentForgeModuleRegistrar($store);

        $outcome = $registrar->ensureRegistered();

        self::assertSame(RegisterOutcome::OperatorDisabled, $outcome);
        self::assertSame(0, $store->insertCount);

        // Confirm the row is still mod_active=0 — i.e. we did not flip it.
        $row = $store->findByDirectory(AgentForgeModuleRegistrar::MOD_DIRECTORY);
        self::assertNotNull($row);
        self::assertSame(0, $row['mod_active']);
    }

    public function testInsertCarriesCanonicalMetadata(): void
    {
        $store = new class implements ModulesRegistryStore {
            /** @var array<string, mixed> */
            public array $captured = [];

            public function findByDirectory(string $modDirectory): ?array
            {
                return null;
            }

            public function insertActive(array $row): void
            {
                $this->captured = $row;
            }
        };

        $registrar = new AgentForgeModuleRegistrar($store);
        $registrar->ensureRegistered();

        self::assertSame(AgentForgeModuleRegistrar::MOD_NAME, $store->captured['mod_name']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_DIRECTORY, $store->captured['mod_directory']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_DIRECTORY, $store->captured['directory']);
        self::assertSame(
            'custom_modules/' . AgentForgeModuleRegistrar::MOD_DIRECTORY,
            $store->captured['mod_relative_link'],
        );
        self::assertSame(AgentForgeModuleRegistrar::MODULE_TYPE_CUSTOM, $store->captured['type']);
        self::assertNotEmpty($store->captured['sql_version']);
        self::assertNotEmpty($store->captured['acl_version']);
    }
}
