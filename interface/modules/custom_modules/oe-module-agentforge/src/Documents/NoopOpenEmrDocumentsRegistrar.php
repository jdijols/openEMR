<?php

/**
 * Test-default {@see OpenEmrDocumentsRegistrarPort} — always returns null,
 * exercising the "OE registration skipped" branch of {@see DocumentUploadAction}.
 * Production code wires {@see OpenEmrDocumentsRegistrarAdapter} instead.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class NoopOpenEmrDocumentsRegistrar implements OpenEmrDocumentsRegistrarPort
{
    public function register(
        int $patientPid,
        string $filename,
        string $mimeType,
        string $fileBytes,
    ): ?int {
        return null;
    }
}
