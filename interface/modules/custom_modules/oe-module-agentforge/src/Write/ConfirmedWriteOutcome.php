<?php

/**
 * Shared UC-B §4.7.2 response shape ({accepted}|{accepted:false,reason}) for module write handlers.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Write;

final class ConfirmedWriteOutcome
{
    public const KIND_ACCEPTED = 'accepted';

    public const KIND_OPENEMR_REJECTED = 'openemr_rejected';

    private function __construct(
        public readonly string $kind,
        /** PRD parity field; EncounterService/EventAuditLogger do not reliably expose numeric log pk here. */
        public readonly int $auditRowId,
        private readonly ?string $safeReason,
    ) {
    }

    public static function accepted(int $auditRowId): self
    {
        return new self(self::KIND_ACCEPTED, $auditRowId, null);
    }

    public static function openemrRejected(string $safeReason): self
    {
        return new self(self::KIND_OPENEMR_REJECTED, 0, $safeReason);
    }

    public function isAccepted(): bool
    {
        return $this->kind === self::KIND_ACCEPTED;
    }

    public function failureReason(): string
    {
        return $this->safeReason ?? 'write failed';
    }
}
