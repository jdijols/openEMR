<?php

/**
 * Gate 1 G1-01 — module SQL documents launch_code table + log correlation_id column.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class AgentForgeModuleSchemaTest extends TestCase
{
    public function testTableSqlDeclaresLaunchCodeColumns(): void
    {
        $path = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/sql/table.sql';
        $sql = file_get_contents($path);
        self::assertNotFalse($sql);
        self::assertStringContainsString('agentforge_launch_code', $sql);
        self::assertStringContainsString('`code`', $sql);
        self::assertStringContainsString('`user_id`', $sql);
        self::assertStringContainsString('`patient_uuid`', $sql);
        self::assertStringContainsString('`encounter_id`', $sql);
        self::assertStringContainsString('`issued_at`', $sql);
        self::assertStringContainsString('`redeemed_at`', $sql);
        self::assertStringContainsString('correlation_id', $sql);
    }
}
