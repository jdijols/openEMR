<?php

/**
 * W2 G2-MVP-22 — thrown when a DocumentReference UUID does not resolve to
 * a stored document. HTTP layer translates to 404.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class DocumentNotFoundException extends \RuntimeException
{
    public function __construct(string $message = 'document_not_found')
    {
        parent::__construct($message);
    }
}
