<?php

/**
 * Production adapter for {@see DocumentReclassifyPort} — moves a document's
 * `categories_to_documents` row from the AgentForge inbox to a stock
 * OpenEMR category by name lookup. Names are looked up rather than
 * hardcoded so the adapter survives installs where the demo dataset
 * reordered the seeded ids.
 *
 * If a target category is missing on this install, the reclassify is
 * skipped (returns null). The caller treats this as "leave it in the
 * Clinical Copilot inbox", which is the safe default.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

use OpenEMR\Common\Database\QueryUtils;

final class OpenEmrDocumentReclassifyAdapter implements DocumentReclassifyPort
{
    public function __construct(private readonly DocumentUploadPort $uploadPort)
    {
    }

    public function reclassify(string $docrefUuid, string $targetCategory): ?int
    {
        if (!\in_array($targetCategory, self::SUPPORTED_TARGETS, true)) {
            return null;
        }

        $oeDocumentId = $this->uploadPort->findOpenEmrDocumentId($docrefUuid);
        if ($oeDocumentId === null) {
            return null;
        }

        $categoryId = $this->resolveCategoryId($targetCategory);
        if ($categoryId === null) {
            return null;
        }

        try {
            // The legacy upload path uses `REPLACE INTO categories_to_documents`
            // (on the (category_id, document_id) join). To MOVE a document into
            // a different category we have to clear any pre-existing rows for
            // this document first, then insert the chosen one — a single
            // REPLACE wouldn't remove rows under a different category_id.
            QueryUtils::sqlStatementThrowException(
                'DELETE FROM `categories_to_documents` WHERE `document_id` = ?',
                [$oeDocumentId],
            );
            QueryUtils::sqlStatementThrowException(
                'INSERT INTO `categories_to_documents` (`category_id`, `document_id`) VALUES (?, ?)',
                [$categoryId, $oeDocumentId],
            );
        } catch (\Throwable $e) {
            \error_log('agentforge.reclassify_failed: ' . $e->getMessage());
            return null;
        }

        return $categoryId;
    }

    private function resolveCategoryId(string $targetCategory): ?int
    {
        if ($targetCategory === self::TARGET_CLINICAL_COPILOT) {
            try {
                return ClinicalCopilotCategoryInstaller::ensureCategoryExists();
            } catch (\Throwable $e) {
                \error_log('agentforge.reclassify_category_install_failed: ' . $e->getMessage());
                return null;
            }
        }

        $name = match ($targetCategory) {
            self::TARGET_LAB_REPORT => 'Lab Report',
            self::TARGET_PATIENT_INFORMATION => 'Patient Information',
            // Unreachable — guarded by the SUPPORTED_TARGETS check in reclassify().
        };

        $id = QueryUtils::fetchSingleValue(
            'SELECT `id` FROM `categories` WHERE `name` = ? ORDER BY `id` ASC LIMIT 1',
            'id',
            [$name],
        );
        if (\is_numeric($id) && (int) $id > 0) {
            return (int) $id;
        }

        return null;
    }
}
