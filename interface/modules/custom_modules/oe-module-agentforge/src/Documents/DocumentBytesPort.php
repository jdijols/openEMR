<?php

/**
 * W2 G2-MVP-22 — read-side port for fetching uploaded document bytes
 * keyed by FHIR DocumentReference UUID, scoped to the canonical bound chart.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

interface DocumentBytesPort
{
    /**
     * Fetch the document metadata + bytes for `$docrefUuid`. Returns null if
     * the DocRef does not exist; throws CrossPatientDocumentAccessException
     * if the DocRef's subject patient does not match the canonical bound
     * chart UUID (S1, S15).
     */
    public function fetch(string $docrefUuid, string $expectedPatientUuidCanonical): ?DocumentBytesResult;
}
