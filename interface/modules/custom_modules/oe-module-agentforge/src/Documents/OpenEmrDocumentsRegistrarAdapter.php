<?php

/**
 * Production adapter for {@see OpenEmrDocumentsRegistrarPort} — pushes the
 * upload through the canonical legacy `\Document::createDocument()` path.
 *
 * What this gives us, beyond the agentforge_w2/ sidecar that the agent
 * reads from:
 *
 *   - A row in `documents` (with sha3-512 hash, owner, mimetype, size).
 *   - A row in `categories_to_documents` linking it to "Clinical Copilot".
 *   - The bytes written to `sites/.../documents/<pid>/<uuid>` with
 *     drive_encryption applied if globally enabled.
 *   - Visibility in OpenEMR's Documents tab + FHIR DocumentReference.
 *
 * This is best-effort: any exception from the legacy path becomes a `null`
 * return + error_log, so the agent can still extract from the sidecar copy
 * even if the OpenEMR write fails (e.g. CouchDB outage, encryption key
 * unavailable, etc).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

final class OpenEmrDocumentsRegistrarAdapter implements OpenEmrDocumentsRegistrarPort
{
    public function documentExistsForPatient(int $oeDocumentId, int $patientPid): bool
    {
        if ($oeDocumentId <= 0 || $patientPid <= 0) {
            return false;
        }
        try {
            $found = \OpenEMR\Common\Database\QueryUtils::fetchSingleValue(
                "SELECT `id` FROM `documents` WHERE `id` = ? AND `foreign_id` = ? LIMIT 1",
                'id',
                [$oeDocumentId, $patientPid],
            );
        } catch (\Throwable $e) {
            \error_log('agentforge.oe_docs_registrar.exists_check_failed: ' . $e->getMessage());
            return false;
        }
        return $found !== null;
    }

    public function register(
        int $patientPid,
        string $filename,
        string $mimeType,
        string $fileBytes,
    ): ?int {
        if ($patientPid <= 0) {
            return null;
        }

        try {
            $categoryId = ClinicalCopilotCategoryInstaller::ensureCategoryExists();
        } catch (\Throwable $e) {
            \error_log('agentforge.oe_docs_registrar.category_install_failed: ' . $e->getMessage());
            return null;
        }

        try {
            $document = new \Document();
            // createDocument() takes $data by reference + may rewrite the
            // bytes (encryption). Local var keeps the caller's payload pure.
            $bytes = $fileBytes;
            $err = $document->createDocument(
                $patientPid,
                $categoryId,
                $filename,
                $mimeType,
                $bytes,
                /* higher_level_path */ '',
                /* path_depth        */ 1,
                /* owner             */ 0,        // 0 = use authUserID from session
            );
        } catch (\Throwable $e) {
            \error_log('agentforge.oe_docs_registrar.create_threw: ' . $e->getMessage());
            return null;
        }

        if (\is_string($err) && $err !== '') {
            \error_log('agentforge.oe_docs_registrar.create_failed: ' . $err);
            return null;
        }

        $docId = $document->get_id();
        if (!\is_numeric($docId) || (int) $docId <= 0) {
            \error_log('agentforge.oe_docs_registrar.create_returned_no_id');
            return null;
        }

        return (int) $docId;
    }
}
