<?php

/**
 * Idempotent installer for the "Clinical Copilot" `categories` row that hosts
 * AgentForge-uploaded source documents on first arrival in chat. Acts as the
 * inbox category until the post-extraction reclassify hook moves the
 * `categories_to_documents` join to a stock OpenEMR folder (Lab Report,
 * Patient Information, ...). Falling back to "Clinical Copilot" when the
 * agent's classification is uncertain is the safe default — operators see
 * the file in the chart with provenance, never silently misfiled.
 *
 * The categories table is a Modified Preorder Tree Traversal (MPTT) nested
 * set: every insert under the root (id=1) MUST shift the lft/rght of every
 * sibling rightward by 2. We recreate that delta in raw SQL rather than
 * loading the legacy CategoryTree class (whose add_node() calls die() on
 * existing names — non-idempotent for an installer that runs every upload).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Documents;

use OpenEMR\Common\Database\QueryUtils;
use OpenEMR\Core\OEGlobalsBag;

final class ClinicalCopilotCategoryInstaller
{
    public const CATEGORY_NAME = 'Clinical Copilot';
    public const ROOT_PARENT_ID = 1;
    public const ACO_SPEC = 'patients|docs';

    private static ?int $cachedCategoryId = null;

    /**
     * Returns the category id for "Clinical Copilot", creating it lazily on
     * first call. Idempotent — the SELECT-then-INSERT under transaction
     * collapses safely under concurrent calls (any racing insert wins, the
     * loser falls into the existence branch on the next attempt).
     *
     * Allocation strategy mirrors {@see \Tree::add_node()}: ADODB's
     * `GenID('categories_seq')` provides the next id (categories.id is NOT
     * AUTO_INCREMENT — it uses an ADODB-managed sequence row), the lft/rght
     * shift updates run BEFORE the insert, and the whole thing wraps a
     * transaction so a thrown insert rolls back the tree shift instead of
     * corrupting the MPTT invariant.
     */
    public static function ensureCategoryExists(): int
    {
        if (self::$cachedCategoryId !== null) {
            return self::$cachedCategoryId;
        }

        $existing = self::lookupExistingId();
        if ($existing !== null) {
            self::$cachedCategoryId = $existing;
            return $existing;
        }

        return QueryUtils::inTransaction(static function (): int {
            // Re-check under transaction — a parallel request may have inserted
            // between our pre-check and now.
            $raced = self::lookupExistingId();
            if ($raced !== null) {
                self::$cachedCategoryId = $raced;
                return $raced;
            }

            $rootRght = QueryUtils::fetchSingleValue(
                'SELECT `rght` FROM `categories` WHERE `id` = ? LIMIT 1',
                'rght',
                [self::ROOT_PARENT_ID],
            );
            if (!\is_numeric($rootRght)) {
                throw new \RuntimeException('Document categories root row missing — cannot install Clinical Copilot category.');
            }

            $insertAt = (int) $rootRght;

            QueryUtils::sqlStatementThrowException(
                'UPDATE `categories` SET `rght` = `rght` + 2 WHERE `rght` >= ?',
                [$insertAt],
            );
            QueryUtils::sqlStatementThrowException(
                'UPDATE `categories` SET `lft` = `lft` + 2 WHERE `lft` >= ?',
                [$insertAt],
            );

            $newId = self::allocateNextCategoryId();
            if ($newId <= 0) {
                throw new \RuntimeException('Failed to allocate categories sequence id — GenID returned ' . $newId);
            }

            QueryUtils::sqlStatementThrowException(
                'INSERT INTO `categories` (`id`, `name`, `value`, `parent`, `lft`, `rght`, `aco_spec`, `codes`) '
                . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $newId,
                    self::CATEGORY_NAME,
                    '',
                    self::ROOT_PARENT_ID,
                    $insertAt,
                    $insertAt + 1,
                    self::ACO_SPEC,
                    '',
                ],
            );

            self::$cachedCategoryId = $newId;
            return $newId;
        });
    }

    /**
     * Look up an existing "Clinical Copilot" row under the document-categories
     * root. Returns null when missing OR when the only match has id=0 — the
     * latter is the corrupt-row marker left behind by a previous broken
     * installer attempt and must NOT be returned (the ledger / FK joins would
     * silently break on the bogus id).
     */
    private static function lookupExistingId(): ?int
    {
        $row = QueryUtils::fetchSingleValue(
            'SELECT `id` FROM `categories` WHERE `parent` = ? AND `name` = ? AND `id` > 0 LIMIT 1',
            'id',
            [self::ROOT_PARENT_ID, self::CATEGORY_NAME],
        );
        if (\is_numeric($row) && (int) $row > 0) {
            return (int) $row;
        }
        return null;
    }

    /**
     * Allocate the next `categories.id` via ADODB's GenID — same path the
     * legacy {@see \Tree::add_node()} uses on this table, so we never collide
     * with manually-seeded fixture rows or the upgrade installer's allocations.
     */
    private static function allocateNextCategoryId(): int
    {
        $adodb = OEGlobalsBag::getInstance()->get('adodb');
        if (!\is_array($adodb) || !isset($adodb['db'])) {
            throw new \RuntimeException('OpenEMR ADODB connection not available — cannot allocate categories id.');
        }
        $db = $adodb['db'];
        if (!\is_object($db) || !\method_exists($db, 'GenID')) {
            throw new \RuntimeException('ADODB connection does not expose GenID() — cannot allocate categories id.');
        }
        // `categories_seq` (NOT the global `sequences` pool) — same allocation
        // path Tree::add_node uses on this table, so we never collide with
        // ids already taken by stock seed rows or future legacy add_node calls.
        return (int) $db->GenID('categories_seq');
    }

    /**
     * Test seam — clears the in-process memo. Production never calls this.
     */
    public static function resetForTests(): void
    {
        self::$cachedCategoryId = null;
    }
}
