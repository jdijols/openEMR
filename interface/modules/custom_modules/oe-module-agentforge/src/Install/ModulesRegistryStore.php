<?php

/**
 * Storage interface for the OpenEMR `modules` table — abstracted so unit tests
 * can use an in-memory implementation while production uses QueryUtils
 * (PRD §7.7, §7.8; G6-18).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Install;

interface ModulesRegistryStore
{
    /**
     * Returns the existing module row for the given mod_directory, or null
     * if no row exists. Display fields are returned alongside mod_active so
     * the registrar can detect drift and refresh stale labels (e.g. after a
     * brand rename) without admin intervention.
     *
     * @return array{
     *     mod_id: int,
     *     mod_active: int,
     *     mod_name: string,
     *     mod_ui_name: string,
     *     mod_nick_name: string,
     *     mod_description: string,
     * }|null
     */
    public function findByDirectory(string $modDirectory): ?array;

    /**
     * Inserts a new module row with the given canonical fields. Implementations
     * should INSERT a single row with mod_active=1 + the given metadata. Failure
     * (constraint, schema mismatch) should throw a Throwable so the caller can
     * decide whether to swallow it.
     *
     * @param array{
     *     mod_name: string,
     *     mod_directory: string,
     *     mod_relative_link: string,
     *     mod_ui_name: string,
     *     mod_nick_name: string,
     *     mod_description: string,
     *     directory: string,
     *     type: int,
     *     sql_version: string,
     *     acl_version: string,
     * } $row
     */
    public function insertActive(array $row): void;

    /**
     * Refreshes only display strings on an existing row. Leaves mod_active,
     * sql_version, acl_version, and other operational fields untouched so the
     * admin's enable/disable decision and any installer state are preserved.
     *
     * The WHERE clause must scope by both `mod_id` AND `mod_directory` because
     * the table's PRIMARY KEY is the composite `(mod_id, mod_directory)` —
     * `mod_id` alone is NOT unique. Scoping by `mod_id` only would silently
     * clobber another module that happened to share the same auto-increment
     * value (observed in the wild on stock installs that include Laminas
     * fixture rows).
     *
     * @param array{
     *     mod_name: string,
     *     mod_ui_name: string,
     *     mod_nick_name: string,
     *     mod_description: string,
     * } $fields
     */
    public function updateDisplayFields(int $modId, string $modDirectory, array $fields): void;
}
