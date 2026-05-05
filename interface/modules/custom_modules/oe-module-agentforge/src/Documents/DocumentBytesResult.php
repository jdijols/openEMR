<?php

/**
 * W2 G2-MVP-22 — DocumentBytes lookup result (bytes + content-type metadata).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final readonly class DocumentBytesResult
{
    public function __construct(
        public string $bytes,
        public string $mimeType,
        public int $fileSize,
        public string $docType,
    ) {
    }
}
