<?php

/**
 * W2 G2-MVP-22 — DocumentBytesAction: returns the bytes for an uploaded
 * document, scoped to the canonical bound chart.
 *
 * Cross-patient defense in depth (S1, S15): even if a caller smuggles a
 * DocRef UUID that belongs to another patient, the port refuses and we
 * raise CrossPatientDocumentAccessException.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class DocumentBytesAction
{
    public function __construct(private readonly DocumentBytesPort $port)
    {
    }

    /**
     * @return DocumentBytesResult The metadata + bytes payload for the caller.
     * @throws CrossPatientDocumentAccessException
     * @throws DocumentNotFoundException
     */
    public function execute(string $docrefUuid, string $patientUuidCanonical): DocumentBytesResult
    {
        $result = $this->port->fetch($docrefUuid, $patientUuidCanonical);
        if ($result === null) {
            throw new DocumentNotFoundException();
        }

        return $result;
    }
}
