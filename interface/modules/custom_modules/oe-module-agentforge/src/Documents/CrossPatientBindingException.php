<?php

/**
 * W2 G2-MVP-20 — thrown when a document upload's claimed patient UUID does
 * not match the canonical bound UUID from the active chart context (S1, S15).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class CrossPatientBindingException extends \RuntimeException
{
    public function __construct(string $message = 'active_chart_mismatch')
    {
        parent::__construct($message);
    }
}
