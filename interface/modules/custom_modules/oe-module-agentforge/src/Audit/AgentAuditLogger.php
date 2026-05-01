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
     * Record a metadata-only AgentForge audit event with `log_from='agent'` (PRD §4.8, S10).
     *
     * Implementation note: we call `EventAuditLogger::recordLogItem` directly, **not**
     * `EventAuditLogger::newEvent`. `newEvent`'s non-portal branch silently drops the
     * `$log_from` argument when it forwards to `recordLogItem` (only 7 of the 8 positional
     * args are passed), which would coerce every agent event to `log_from='open-emr'` and
     * make the S10 / G4-10 done proof unverifiable from the database.
     *
     * `$failureReason` is restricted by callers to a known safe enum (e.g. 'encounter not found',
     * 'encounter invalid', 'write failed', 'provider_error', 'unsupported_write', 'acl_denied');
     * it is appended verbatim to the audit comments so an operator can see *why* a write
     * was rejected without inspecting raw clinical payload bodies.
     *
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
        array $payload = [],
        ?string $failureReason = null
    ): void {
        $comments = 'action=' . $action . ' target=' . $target . ' correlation_id=' . $correlationId;
        if ($payload !== []) {
            $comments .= ' payload_keys=' . implode(',', array_keys($payload));
        }
        if ($failureReason !== null && $failureReason !== '') {
            $comments .= ' failure_reason=' . $failureReason;
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

        EventAuditLogger::getInstance()->recordLogItem(
            $success ? 1 : 0,
            'agentforge',
            $authUser,
            $authProvider,
            $comments,
            $patientId,
            'agentforge',
            'agent'
        );
    }
}
