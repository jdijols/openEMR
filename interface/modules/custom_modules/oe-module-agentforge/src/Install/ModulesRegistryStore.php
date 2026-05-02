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
     * if no row exists. Returned shape: ['mod_id' => int, 'mod_active' => int].
     *
     * @return array{mod_id: int, mod_active: int}|null
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
     *     mod_description: string,
     *     directory: string,
     *     type: int,
     *     sql_version: string,
     *     acl_version: string,
     * } $row
     */
    public function insertActive(array $row): void;
}
