<?php

/**
 * Gate 1 — Agent audit metadata only (PRD §4.8, S10).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

require_once __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Audit/AgentAuditLogger.php';

use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use PHPUnit\Framework\TestCase;

final class AgentAuditLoggerTest extends TestCase
{
    protected function tearDown(): void
    {
        AgentAuditLogger::setTestSink(null);
        parent::tearDown();
    }

    public function testSinkReceivesAgentLogFromAndMetadataOnly(): void
    {
        $captured = null;
        AgentAuditLogger::setTestSink(static function (array $row) use (&$captured): void {
            $captured = $row;
        });

        AgentAuditLogger::recordAgentEvent(
            'reynolds',
            'Default',
            123,
            'context_read',
            'identity',
            'corr-test-1',
            true,
            []
        );

        self::assertIsArray($captured);
        self::assertSame('agent', $captured['log_from']);
        self::assertStringContainsString('correlation_id=corr-test-1', (string) $captured['comments']);
        self::assertStringNotContainsString('DOB', (string) $captured['comments']);
        self::assertStringNotContainsString('Penicillin', (string) $captured['comments']);
        self::assertStringNotContainsString('120/80', (string) $captured['comments']);
        self::assertStringNotContainsString('Jane', (string) $captured['comments']);
    }
}
