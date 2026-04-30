<?php

/**
 * PDO/SQLite implementation for isolated PHPUnit (Gate 1).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Modules\AgentForge\Security;

final class PdoLaunchCodeStore implements LaunchCodeStore
{
    public function __construct(private readonly \PDO $pdo)
    {
    }

    public static function createSqliteMemory(): self
    {
        $pdo = new \PDO('sqlite::memory:');
        $pdo->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
        $pdo->exec(
            <<<SQL
            CREATE TABLE agentforge_launch_code (
                code TEXT PRIMARY KEY NOT NULL,
                user_id INTEGER NOT NULL,
                patient_uuid TEXT NULL,
                encounter_id INTEGER NULL,
                issued_at TEXT NOT NULL,
                redeemed_at TEXT NULL
            );
            SQL
        );

        return new self($pdo);
    }

    public function insert(string $code, int $userId, ?string $patientUuid, ?int $encounterId, string $issuedAtMysql): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO agentforge_launch_code (code, user_id, patient_uuid, encounter_id, issued_at) VALUES (?, ?, ?, ?, ?)'
        );
        $stmt->execute([$code, $userId, $patientUuid, $encounterId, $issuedAtMysql]);
    }

    public function fetchRow(string $code): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM agentforge_launch_code WHERE code = ?');
        $stmt->execute([$code]);
        $row = $stmt->fetch(\PDO::FETCH_ASSOC);

        return $row === false ? null : $row;
    }

    public function tryMarkRedeemed(string $code, string $redeemedAtMysql, string $nowMysql, int $ttlSeconds): int
    {
        $stmt = $this->pdo->prepare(
            <<<SQL
            UPDATE agentforge_launch_code
            SET redeemed_at = ?
            WHERE code = ?
              AND redeemed_at IS NULL
              AND CAST((julianday(?) - julianday(issued_at)) * 86400 AS INTEGER) <= ?
            SQL
        );
        $stmt->execute([$redeemedAtMysql, $code, $nowMysql, $ttlSeconds]);

        return $stmt->rowCount();
    }
}
