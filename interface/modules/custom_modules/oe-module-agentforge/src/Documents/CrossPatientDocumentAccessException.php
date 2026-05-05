<?php

/**
 * W2 G2-MVP-22 — thrown when a caller attempts to fetch a DocumentReference
 * whose subject patient differs from the canonical active-chart binding
 * (S1, S15).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class CrossPatientDocumentAccessException extends \RuntimeException
{
    public function __construct(string $message = 'cross_patient_document_access')
    {
        parent::__construct($message);
    }
}
