<?php

/**
 * W2 G2-MVP-20 — result of a document upload (DocRef UUID + idempotency flag).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final readonly class DocumentUploadResult
{
    public function __construct(
        public string $docrefUuid,
        public bool $wasReUpload,
    ) {
    }

    public static function created(string $docrefUuid): self
    {
        return new self($docrefUuid, false);
    }

    public static function existing(string $docrefUuid): self
    {
        return new self($docrefUuid, true);
    }
}
