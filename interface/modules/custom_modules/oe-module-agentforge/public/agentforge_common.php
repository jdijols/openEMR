<?php

/**
 * Shared HTTP helpers for AgentForge public endpoints (Gate 1).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

use OpenEMR\Common\Uuid\UuidRegistry;

/**
 * Bootstrap OpenEMR globals from a script in public/.
 */
function agentforge_require_globals(bool $ignoreAuthForRequest = false): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }

    if ($ignoreAuthForRequest) {
        $ignoreAuth = true;
    }

    $globals = \dirname(__DIR__, 4) . '/globals.php';
    if (!\is_readable($globals)) {
        throw new \RuntimeException('OpenEMR globals.php not found');
    }

    require_once $globals;
    $loaded = true;
}

/**
 * @return array<string, mixed>
 */
function agentforge_json_input(): array
{
    $raw = \file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return [];
    }

    try {
        $decoded = \json_decode($raw, true, 512, \JSON_THROW_ON_ERROR);
    } catch (\JsonException) {
        return [];
    }

    return \is_array($decoded) ? $decoded : [];
}

/**
 * @param array<string, mixed> $body
 */
function agentforge_emit_json(int $status, array $body): never
{
    \http_response_code($status);
    \header('Content-Type: application/json; charset=utf-8');
    echo \json_encode($body, \JSON_THROW_ON_ERROR);
    exit;
}

function agentforge_emit_html(int $status, string $html): never
{
    \http_response_code($status);
    \header('Content-Type: text/html; charset=utf-8');
    echo $html;
    exit;
}

/**
 * Correlation id for agent audit + API log alignment (PRD §5.1 / §11.4).
 */
function agentforge_incoming_correlation_id(): string
{
    $h = $_SERVER['HTTP_X_CORRELATION_ID'] ?? '';
    if (\is_string($h) && $h !== '' && \strlen($h) <= 128) {
        return $h;
    }

    return \bin2hex(\random_bytes(16));
}

function agentforge_require_post(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if ($method !== 'POST') {
        agentforge_emit_json(405, ['error' => 'method_not_allowed']);
    }
}

function agentforge_verify_internal_auth(): bool
{
    $secret = \getenv('OPENEMR_MODULE_SHARED_SECRET') ?: '';
    if ($secret === '') {
        return false;
    }

    $hdr = $_SERVER['HTTP_X_INTERNAL_AUTH'] ?? '';
    if (!\is_string($hdr) || $hdr === '') {
        return false;
    }

    return \hash_equals($secret, $hdr);
}

function agentforge_session_token_secret(): string
{
    $s = \getenv('SESSION_TOKEN_SECRET') ?: '';
    if ($s === '' || \strlen($s) < 32) {
        agentforge_emit_json(500, ['error' => 'misconfigured_module']);
    }

    return $s;
}

/**
 * Patient FHIR-style UUID string for an OpenEMR pid, or null.
 */
function agentforge_pid_to_uuid_string(int $pid): ?string
{
    if ($pid <= 0) {
        return null;
    }

    $row = \sqlQuery('SELECT `uuid` FROM `patient_data` WHERE `pid` = ?', [$pid]);
    if ($row === false || empty($row['uuid'])) {
        return null;
    }

    return UuidRegistry::uuidToString($row['uuid']);
}
