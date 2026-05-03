<?php

/**
 * G6-18 — AgentForge module auto-registration is idempotent and
 * operator-respectful.
 *
 * Asserts:
 *   1. On a fresh schema (no row), ensureRegistered() inserts the row with
 *      mod_active=1.
 *   2. On a re-run with a row already present + mod_active=1 + canonical
 *      display fields, no write happens (returns Unchanged).
 *   3. On a row with mod_active=0, no insert / no UPDATE happens (returns
 *      OperatorDisabled). The admin's disable decision is preserved — even
 *      when display strings are stale (a brand rename does not override a
 *      manual disable).
 *   4. On a row with mod_active=1 but stale display strings (e.g. left over
 *      from a brand rename), updateDisplayFields() is called once with the
 *      canonical values (returns Refreshed). mod_active and version columns
 *      are not touched.
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
    /**
     * @var array<string, array{
     *     mod_id: int,
     *     mod_active: int,
     *     mod_name: string,
     *     mod_ui_name: string,
     *     mod_nick_name: string,
     *     mod_description: string,
     * }>
     */
    private array $rows = [];

    public int $insertCount = 0;
    public int $updateCount = 0;
    /** @var list<array{mod_directory: string, mod_active: int}> */
    public array $insertedRows = [];
    /**
     * @var list<array{
     *     mod_id: int,
     *     mod_directory: string,
     *     fields: array{
     *         mod_name: string,
     *         mod_ui_name: string,
     *         mod_nick_name: string,
     *         mod_description: string,
     *     },
     * }>
     */
    public array $updates = [];

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
            'mod_name' => $row['mod_name'],
            'mod_ui_name' => $row['mod_ui_name'],
            'mod_nick_name' => $row['mod_nick_name'],
            'mod_description' => $row['mod_description'],
        ];
    }

    public function updateDisplayFields(int $modId, string $modDirectory, array $fields): void
    {
        $this->updateCount++;
        $this->updates[] = ['mod_id' => $modId, 'mod_directory' => $modDirectory, 'fields' => $fields];
        $existing = $this->rows[$modDirectory] ?? null;
        if ($existing !== null && $existing['mod_id'] === $modId) {
            $this->rows[$modDirectory] = array_merge($existing, $fields);
        }
    }

    /**
     * Seed an existing row. Display fields default to the canonical constants
     * so tests that don't care about brand drift keep working; pass an explicit
     * `$displayFields` array to simulate stale labels (e.g. a pre-rename row).
     *
     * @param array{
     *     mod_name?: string,
     *     mod_ui_name?: string,
     *     mod_nick_name?: string,
     *     mod_description?: string,
     * } $displayFields
     */
    public function setRow(string $modDirectory, int $modActive, array $displayFields = []): void
    {
        $this->rows[$modDirectory] = [
            'mod_id' => count($this->rows) + 1,
            'mod_active' => $modActive,
            'mod_name' => $displayFields['mod_name'] ?? AgentForgeModuleRegistrar::MOD_NAME,
            'mod_ui_name' => $displayFields['mod_ui_name'] ?? AgentForgeModuleRegistrar::MOD_UI_NAME,
            'mod_nick_name' => $displayFields['mod_nick_name'] ?? AgentForgeModuleRegistrar::MOD_NICK_NAME,
            'mod_description' => $displayFields['mod_description'] ?? AgentForgeModuleRegistrar::MOD_DESCRIPTION,
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

            public function updateDisplayFields(int $modId, string $modDirectory, array $fields): void
            {
                // No-op: this fixture only exercises the insert path.
            }
        };

        $registrar = new AgentForgeModuleRegistrar($store);
        $registrar->ensureRegistered();

        self::assertSame(AgentForgeModuleRegistrar::MOD_NAME, $store->captured['mod_name']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_UI_NAME, $store->captured['mod_ui_name']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_NICK_NAME, $store->captured['mod_nick_name']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_DESCRIPTION, $store->captured['mod_description']);
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

    public function testStaleDisplayFieldsOnActiveRowAreRefreshed(): void
    {
        $store = new InMemoryModulesRegistryStore();
        $store->setRow(AgentForgeModuleRegistrar::MOD_DIRECTORY, 1, [
            'mod_name' => 'AgentForge Clinical Co-Pilot',
            'mod_ui_name' => 'AgentForge',
            'mod_nick_name' => 'agentforge',
            'mod_description' => 'old description',
        ]);
        $registrar = new AgentForgeModuleRegistrar($store);

        $outcome = $registrar->ensureRegistered();

        self::assertSame(RegisterOutcome::Refreshed, $outcome);
        self::assertSame(0, $store->insertCount);
        self::assertSame(1, $store->updateCount);

        $update = $store->updates[0];
        self::assertSame(AgentForgeModuleRegistrar::MOD_DIRECTORY, $update['mod_directory']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_NAME, $update['fields']['mod_name']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_UI_NAME, $update['fields']['mod_ui_name']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_NICK_NAME, $update['fields']['mod_nick_name']);
        self::assertSame(AgentForgeModuleRegistrar::MOD_DESCRIPTION, $update['fields']['mod_description']);
    }

    public function testRefreshIsIdempotentOnSecondRun(): void
    {
        $store = new InMemoryModulesRegistryStore();
        $store->setRow(AgentForgeModuleRegistrar::MOD_DIRECTORY, 1, [
            'mod_name' => 'AgentForge Clinical Co-Pilot',
            'mod_ui_name' => 'AgentForge',
            'mod_nick_name' => 'agentforge',
            'mod_description' => 'old description',
        ]);
        $registrar = new AgentForgeModuleRegistrar($store);

        $registrar->ensureRegistered();
        $secondOutcome = $registrar->ensureRegistered();

        self::assertSame(RegisterOutcome::Unchanged, $secondOutcome);
        self::assertSame(1, $store->updateCount, 'Second run must not re-issue UPDATE');
    }

    public function testStaleDisplayFieldsOnDisabledRowAreNotRefreshed(): void
    {
        // OperatorDisabled wins: a brand rename must not silently re-enable
        // or even mutate a row the admin manually disabled (G6-17 rollback).
        $store = new InMemoryModulesRegistryStore();
        $store->setRow(AgentForgeModuleRegistrar::MOD_DIRECTORY, 0, [
            'mod_name' => 'AgentForge Clinical Co-Pilot',
            'mod_ui_name' => 'AgentForge',
            'mod_nick_name' => 'agentforge',
            'mod_description' => 'old description',
        ]);
        $registrar = new AgentForgeModuleRegistrar($store);

        $outcome = $registrar->ensureRegistered();

        self::assertSame(RegisterOutcome::OperatorDisabled, $outcome);
        self::assertSame(0, $store->updateCount, 'Disabled rows must not be auto-updated');
        self::assertSame(0, $store->insertCount);
    }
}
