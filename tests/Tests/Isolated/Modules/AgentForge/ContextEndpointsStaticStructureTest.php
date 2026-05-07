<?php

/**
 * Gate 3 (G3-01) + Gate 6 (G6-20) — structural contract enforcement for the
 * Context Service PHP endpoints (PRD §4.4–§4.5, §4.8).
 *
 * Why structural and not HTTP integration:
 *
 * G6-20 is tier-6 backfill ("Med" criticality, Docker / integration harness).
 * Spinning up MariaDB + an authenticated OpenEMR session per endpoint per
 * scenario is real infrastructure work the gate explicitly tags as cuttable.
 * Instead, this file enforces the *structural invariants* that an HTTP-matrix
 * test would assert after the fact:
 *
 *   1. **401 / 403** — every endpoint authorizes through the shared ingress
 *      helper (`agentforge_context_service_ingress`) or the legacy
 *      `ChartContextGate::authorizeFromGlobals` path. Both helpers fail closed
 *      with `401 unauthorized` / `403 active_chart_mismatch` (covered by
 *      `ChartContextGate` unit tests).
 *   2. **200 + §4.5 envelope** — every endpoint emits its happy-path response
 *      via `agentforge_emit_json(200, ['ok' => true, ...])`.
 *   3. **Audit row written** — every endpoint records the read attempt via
 *      `AgentAuditLogger::recordAgentEvent` (PRD §4.8).
 *   4. **No `SELECT *`** — already enforced (PRD §4.4 / AUDIT Performance-7).
 *
 * If a future endpoint regresses any of these, the test fails *before* the
 * code reaches the security baseline (`security_baseline.sh`) or a live URL.
 *
 * Full HTTP-matrix integration tests remain open as part of the same G6-20
 * line in `clinical-copilot-task-list.md` once the Docker test harness lands.
 *
 * @package OpenEMR
 * @license https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

namespace OpenEMR\Tests\Isolated\Modules\AgentForge;

use PHPUnit\Framework\TestCase;

final class ContextEndpointsStaticStructureTest extends TestCase
{
    /** Endpoints predating G3-01 that still use the older `ChartContextGate` ingress. */
    private const LEGACY_GATE_ENDPOINTS = ['identity.php', 'allergies.php'];

    /** @return list<string> */
    private function contextPhpFiles(): array
    {
        $dir = __DIR__ . '/../../../../../interface/modules/custom_modules/oe-module-agentforge/public/context';
        self::assertDirectoryExists($dir);
        /** @var list<string> */
        return glob($dir . '/*.php') ?: [];
    }

    private function readContents(string $file): string
    {
        $contents = file_get_contents($file);
        self::assertNotFalse($contents, basename($file));
        return $contents;
    }

    public function testContextPhpScriptsAvoidLiteralSelectStar(): void
    {
        foreach ($this->contextPhpFiles() as $file) {
            $base = basename($file);
            $contents = $this->readContents($file);
            self::assertStringNotContainsStringIgnoringCase(
                'select *',
                $contents,
                $base . ' must not SELECT * (AUDIT Performance-7 / PRD §4.4).'
            );
        }
    }

    public function testContextPhpScriptsAuthorizeViaSharedIngressExceptLegacyIdentityAllergiesStillUseGatePattern(): void
    {
        foreach ($this->contextPhpFiles() as $file) {
            $base = basename($file);
            $contents = $this->readContents($file);

            if (\in_array($base, self::LEGACY_GATE_ENDPOINTS, true)) {
                self::assertStringContainsString(
                    'ChartContextGate::authorizeFromGlobals',
                    $contents,
                    $base . ' must authorize via ChartContextGate (legacy gate pattern).'
                );
                continue;
            }

            self::assertStringContainsString(
                'agentforge_context_service_ingress',
                $contents,
                $base . ' must authorize via agentforge_context_service_ingress (shared ingress).'
            );
        }
    }

    /**
     * G6-20: every endpoint must record the read attempt in the audit log
     * (PRD §4.8). Without this, an HTTP integration test would still observe
     * a 200 but the audit baseline (§8.9) would silently regress.
     */
    public function testEveryContextEndpointWritesToAgentAuditLogger(): void
    {
        foreach ($this->contextPhpFiles() as $file) {
            $base = basename($file);
            $contents = $this->readContents($file);
            self::assertStringContainsString(
                'AgentAuditLogger::recordAgentEvent',
                $contents,
                $base . ' must call AgentAuditLogger::recordAgentEvent for the read attempt (PRD §4.8 / G6-20).'
            );
        }
    }

    /**
     * G6-20: every endpoint emits its successful response through the shared
     * JSON helper with HTTP 200 — the same envelope an HTTP-matrix test would
     * assert after a real request.
     */
    public function testEveryContextEndpointEmitsHappyPathJsonEnvelope(): void
    {
        foreach ($this->contextPhpFiles() as $file) {
            $base = basename($file);
            $contents = $this->readContents($file);
            self::assertMatchesRegularExpression(
                "/agentforge_emit_json\\(\\s*200\\s*,/m",
                $contents,
                $base . " must emit agentforge_emit_json(200, ...) on the happy path (PRD §4.5 / G6-20)."
            );
            // The response envelope must include `ok => true` (PRD §4.5).
            self::assertMatchesRegularExpression(
                "/'ok'\\s*=>\\s*true/m",
                $contents,
                $base . " must include 'ok' => true in the 200 response body (PRD §4.5 / G6-20)."
            );
        }
    }

    /**
     * Sanity check on the test itself — if any endpoint is removed or the dir
     * is empty, all of the above pass vacuously. Lock the floor at the ten
     * Context Service endpoints (PRD §4.4 plus clinical_notes added in W2).
     */
    public function testAllContextServiceEndpointsAreStillPresent(): void
    {
        $expected = [
            'allergies.php',
            'clinical_notes.php',
            'encounters.php',
            'identity.php',
            'labs.php',
            'meds.php',
            'notes_metadata.php',
            'problems.php',
            'social_history.php',
            'vitals.php',
        ];
        $actual = array_map('basename', $this->contextPhpFiles());
        sort($actual);
        self::assertSame(
            $expected,
            $actual,
            'Context Service endpoint set drifted from the expected ten-endpoint list.'
        );
    }
}
