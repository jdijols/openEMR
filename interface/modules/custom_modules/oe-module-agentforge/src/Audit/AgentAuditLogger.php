<?php

/**
 * Agent-scoped audit metadata (PRD §4.8, S10 — no PHI in comments).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Audit;

use OpenEMR\Common\Logging\EventAuditLogger;

final class AgentAuditLogger
{
    /** @var null|callable(array<string, mixed>):void */
    private static $testSink = null;

    /**
     * @param callable(array<string, mixed>):void|null $sink
     */
    public static function setTestSink(?callable $sink): void
    {
        self::$testSink = $sink;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public static function recordAgentEvent(
        string $authUser,
        string $authProvider,
        ?int $patientId,
        string $action,
        string $target,
        string $correlationId,
        bool $success = true,
        array $payload = []
    ): void {
        $comments = 'action=' . $action . ' target=' . $target . ' correlation_id=' . $correlationId;
        if ($payload !== []) {
            $comments .= ' payload_keys=' . implode(',', array_keys($payload));
        }

        if (self::$testSink !== null) {
            (self::$testSink)([
                'event' => 'agentforge',
                'user' => $authUser,
                'group' => $authProvider,
                'success' => $success ? 1 : 0,
                'comments' => $comments,
                'patient_id' => $patientId,
                'log_from' => 'agent',
            ]);

            return;
        }

        EventAuditLogger::getInstance()->newEvent(
            'agentforge',
            $authUser,
            $authProvider,
            $success ? 1 : 0,
            $comments,
            $patientId,
            'agent'
        );
    }
}
