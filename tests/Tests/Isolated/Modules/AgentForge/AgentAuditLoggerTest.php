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

    /** Failure-reason field surfaces in audit comments so write_rejected rows name the cause. */
    public function testFailureReasonAppearsInComments(): void
    {
        $captured = null;
        AgentAuditLogger::setTestSink(static function (array $row) use (&$captured): void {
            $captured = $row;
        });

        AgentAuditLogger::recordAgentEvent(
            'reynolds',
            'Default',
            123,
            'write_rejected',
            'chief_complaint',
            'corr-test-2',
            false,
            ['reason' => 'provider_error'],
            'encounter invalid'
        );

        self::assertIsArray($captured);
        self::assertSame('agent', $captured['log_from']);
        self::assertSame(0, $captured['success']);
        $comments = (string) $captured['comments'];
        self::assertStringContainsString('action=write_rejected', $comments);
        self::assertStringContainsString('target=chief_complaint', $comments);
        self::assertStringContainsString('correlation_id=corr-test-2', $comments);
        self::assertStringContainsString('failure_reason=encounter invalid', $comments);
    }

    /** Default behavior unchanged when no failure_reason supplied (no trailing field). */
    public function testFailureReasonOmittedWhenNull(): void
    {
        $captured = null;
        AgentAuditLogger::setTestSink(static function (array $row) use (&$captured): void {
            $captured = $row;
        });

        AgentAuditLogger::recordAgentEvent(
            'reynolds',
            'Default',
            null,
            'write_apply',
            'vitals',
            'corr-test-3',
            true,
            []
        );

        self::assertIsArray($captured);
        self::assertStringNotContainsString('failure_reason=', (string) $captured['comments']);
    }
}
