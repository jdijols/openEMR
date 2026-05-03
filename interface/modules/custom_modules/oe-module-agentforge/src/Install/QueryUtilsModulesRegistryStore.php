<?php

/**
 * QueryUtils-backed ModulesRegistryStore — the production implementation.
 * Talks to the live OpenEMR MariaDB `modules` table.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Install;

use OpenEMR\Common\Database\QueryUtils;

final class QueryUtilsModulesRegistryStore implements ModulesRegistryStore
{
    public function findByDirectory(string $modDirectory): ?array
    {
        $rows = QueryUtils::fetchRecords(
            "SELECT mod_id, mod_active, mod_name, mod_ui_name, mod_nick_name, mod_description
             FROM modules
             WHERE mod_directory = ?
             LIMIT 1",
            [$modDirectory],
        );

        if ($rows === []) {
            return null;
        }

        $row = $rows[0];

        return [
            'mod_id' => (int) $row['mod_id'],
            'mod_active' => (int) $row['mod_active'],
            'mod_name' => (string) ($row['mod_name'] ?? ''),
            'mod_ui_name' => (string) ($row['mod_ui_name'] ?? ''),
            'mod_nick_name' => (string) ($row['mod_nick_name'] ?? ''),
            'mod_description' => (string) ($row['mod_description'] ?? ''),
        ];
    }

    public function updateDisplayFields(int $modId, string $modDirectory, array $fields): void
    {
        QueryUtils::sqlStatementThrowException(
            "UPDATE modules SET
                mod_name = ?,
                mod_ui_name = ?,
                mod_nick_name = ?,
                mod_description = ?
             WHERE mod_id = ? AND mod_directory = ?",
            [
                $fields['mod_name'],
                $fields['mod_ui_name'],
                $fields['mod_nick_name'],
                $fields['mod_description'],
                $modId,
                $modDirectory,
            ],
        );
    }

    public function insertActive(array $row): void
    {
        QueryUtils::sqlInsert(
            "INSERT INTO modules SET
                mod_name = ?,
                mod_directory = ?,
                mod_relative_link = ?,
                mod_ui_name = ?,
                mod_nick_name = ?,
                mod_description = ?,
                mod_active = 1,
                mod_ui_active = 1,
                mod_type = '',
                mod_parent = '',
                directory = ?,
                type = ?,
                date = NOW(),
                sql_run = 1,
                sql_version = ?,
                acl_version = ?",
            [
                $row['mod_name'],
                $row['mod_directory'],
                $row['mod_relative_link'],
                $row['mod_ui_name'],
                $row['mod_nick_name'],
                $row['mod_description'],
                $row['directory'],
                $row['type'],
                $row['sql_version'],
                $row['acl_version'],
            ],
        );
    }
}
