<?php

/**
 * Shared HTTP helpers for AgentForge public endpoints (Gate 1).
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Common\Uuid\UuidRegistry;
use OpenEMR\Modules\AgentForge\Audit\AgentAuditLogger;
use OpenEMR\Modules\AgentForge\Context\ChartContextAuthorizationException;
use OpenEMR\Modules\AgentForge\Context\ChartContextGate;
use OpenEMR\Services\PatientService;

/**
 * Bootstrap OpenEMR globals from a script in public/.
 */
/**
 * QA-pass — silence ADODB's `outp` channel. ADODB's mysqli driver dumps
 * the offending SQL via `echo $msg;` when prepare() fails (see
 * `vendor/adodb/adodb-php/adodb.inc.php::outp` and
 * `drivers/adodb-mysqli.inc.php::outp_throw`). Stock OpenEMR core occasionally
 * trips this against patient-uuid searches (`Column 'uuid' is ambiguous`,
 * `Unknown column 'patient.uuid'`) and the dumped SQL ends up prepended to
 * our JSON response, breaking the agent's `openemr_invalid_json` parse.
 *
 * Routing through the `ADODB_OUTP` hook redirects the message into
 * `error_log` instead of stdout — the diagnostic stays available for ops
 * (unlike just throwing it away), but the response body stays clean.
 */
function agentforge_silent_adodb_outp($msg, $newline = true): void
{
    $clean = \strip_tags(\is_string($msg) ? $msg : (string) $msg);
    // Collapse to a single line so the error log stays grep-friendly.
    $clean = \preg_replace('/\s+/', ' ', $clean) ?? $clean;
    \error_log('agentforge.adodb_outp: ' . $clean);
}

function agentforge_require_globals(bool $ignoreAuthForRequest = false): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }

    // Claim the ADODB output hook BEFORE loading OpenEMR globals so the
    // stock `echo $msg;` path in adodb.inc.php is bypassed entirely. Must
    // be a constant (not a global) — ADODB checks `defined('ADODB_OUTP')`
    // first and short-circuits when present.
    if (!\defined('ADODB_OUTP')) {
        \define('ADODB_OUTP', 'agentforge_silent_adodb_outp');
    }

    // Defense-in-depth — start an output buffer so any other framework
    // output (PHP deprecation notices, third-party `echo`s) is captured
    // and can be discarded by `agentforge_emit_json` /
    // `agentforge_emit_html` before they send the Content-Type header.
    \ob_start();

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
    // Discard any output captured by `agentforge_require_globals`'s
    // ob_start so the Content-Type header can still be sent. ADODB and
    // assorted OpenEMR framework code occasionally emit deprecation
    // notices / warnings via direct echo (see adodb.inc.php:862 — known
    // offender on PHP 8.x); without this drain the JSON body is
    // corrupted by leading text and the agent reports the call as
    // `openemr_invalid_json`.
    while (\ob_get_level() > 0) {
        \ob_end_clean();
    }

    \http_response_code($status);
    \header('Content-Type: application/json; charset=utf-8');
    echo \json_encode($body, \JSON_THROW_ON_ERROR);
    exit;
}

function agentforge_emit_html(int $status, string $html): never
{
    // Same drain pattern as `agentforge_emit_json` — see comment there.
    while (\ob_get_level() > 0) {
        \ob_end_clean();
    }

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

/**
 * One-line label for the CUI header when a chart is open: "First Last, 9F".
 *
 * Age is whole years from DOB to today; sex suffix is M or F when `sex` is
 * clearly male or female (as stored in patient_data / list options).
 *
 * @return non-empty-string|null Null when pid is invalid, row missing, or name empty.
 */
function agentforge_patient_copilot_header_title(int $pid): ?string
{
    if ($pid <= 0) {
        return null;
    }

    $row = \sqlQuery(
        'SELECT `fname`, `lname`, `DOB`, `sex` FROM `patient_data` WHERE `pid` = ?',
        [$pid],
    );
    if ($row === false) {
        return null;
    }

    $fname = \trim((string) ($row['fname'] ?? ''));
    $lname = \trim((string) ($row['lname'] ?? ''));
    $name = \trim(\preg_replace('/\s+/', ' ', $fname . ' ' . $lname) ?? '');
    if ($name === '') {
        return null;
    }

    $ageDigits = '';
    $dobRaw = $row['DOB'] ?? '';
    if (\is_string($dobRaw) && $dobRaw !== '') {
        try {
            $dob = new \DateTimeImmutable($dobRaw);
            $today = new \DateTimeImmutable('today');
            $ageDigits = (string) $dob->diff($today)->y;
        } catch (\Throwable) {
            $ageDigits = '';
        }
    }

    $sexRaw = $row['sex'] ?? null;
    $sexStr = \is_string($sexRaw) ? \strtolower(\trim($sexRaw)) : '';
    $sexSuffix = '';
    if ($sexStr !== '' && \str_starts_with($sexStr, 'f')) {
        $sexSuffix = 'F';
    } elseif ($sexStr !== '' && \str_starts_with($sexStr, 'm')) {
        $sexSuffix = 'M';
    }

    $tail = $ageDigits . $sexSuffix;
    if ($tail === '') {
        return $name;
    }

    return $name . ', ' . $tail;
}

/**
 * Gate 3 — shared Context Service ingress: JSON body parse, correlation id, ChartContextGate bind, PID resolution,
 * capped window.limit (defaults 10, max 50).
 *
 * @return array{
 *   correlation_id: string,
 *   patient_uuid: string,
 *   session_token: string,
 *   pid: int,
 *   ctx: array<string, mixed>,
 *   window_limit: int,
 * }
 */
function agentforge_context_service_ingress(string $contextAuditKey): array
{
    $body = agentforge_json_input();
    $sessionToken = isset($body['session_token']) && \is_string($body['session_token']) ? \trim($body['session_token']) : '';
    $patientUuid = isset($body['patient_uuid']) && \is_string($body['patient_uuid']) ? \trim($body['patient_uuid']) : '';
    if ($sessionToken === '' || $patientUuid === '') {
        agentforge_emit_json(400, ['error' => 'invalid_request']);
    }

    $windowLimit = 10;
    if (isset($body['window']) && \is_array($body['window'])) {
        $l = $body['window']['limit'] ?? null;
        if (\is_int($l)) {
            $windowLimit = \max(1, \min(50, $l));
        } elseif (\is_string($l) && \is_numeric($l)) {
            $windowLimit = \max(1, \min(50, (int) $l));
        }
    }

    $correlationId = agentforge_incoming_correlation_id();

    try {
        $ctx = ChartContextGate::authorizeFromGlobals($sessionToken, $patientUuid);
    } catch (ChartContextAuthorizationException $e) {
        if ($e->httpStatus === 403 && $e->errorCode === 'active_chart_mismatch') {
            $session = SessionWrapperFactory::getInstance()->getActiveSession();
            $rawAu = $session->get('authUser');
            $au = \is_string($rawAu) ? $rawAu : '';
            if ($au !== '') {
                $rawProv = $session->get('authProvider');
                $prov = \is_string($rawProv) && $rawProv !== '' ? $rawProv : 'Default';
                $rawPid = $session->get('pid');
                $p = \is_int($rawPid) ? $rawPid : (\is_string($rawPid) && \is_numeric($rawPid) ? (int) $rawPid : 0);
                AgentAuditLogger::recordAgentEvent(
                    $au,
                    $prov,
                    $p > 0 ? $p : null,
                    'context_read',
                    $contextAuditKey,
                    $correlationId,
                    false,
                    ['reason' => $e->errorCode],
                );
            }
        }

        agentforge_emit_json($e->httpStatus, ['error' => $e->errorCode, 'correlation_id' => $correlationId]);
    }

    $pid = (int) $ctx['pid'];
    if ($pid <= 0) {
        $probe = (new PatientService())->getOne($patientUuid);
        $first = $probe->getFirstDataResult();
        if (!\is_array($first)) {
            agentforge_emit_json(404, ['error' => 'not_found', 'correlation_id' => $correlationId]);
        }

        $rawPid = $first['pid'] ?? null;
        $pid = \is_int($rawPid) ? $rawPid : (\is_string($rawPid) && \is_numeric($rawPid) ? (int) $rawPid : 0);
    }

    return [
        'correlation_id' => $correlationId,
        'patient_uuid' => $patientUuid,
        'session_token' => $sessionToken,
        'pid' => $pid,
        'ctx' => $ctx,
        'window_limit' => $windowLimit,
    ];
}

/**
 * @param array<mixed>|string|null $maybeBytesUuid
 */
function agentforge_normalize_uuid_payload($maybeBytesUuid): string
{
    if (!\is_string($maybeBytesUuid) || $maybeBytesUuid === '') {
        return '';
    }

    if (\strlen($maybeBytesUuid) === 16) {
        return UuidRegistry::uuidToString($maybeBytesUuid);
    }

    return $maybeBytesUuid;
}
