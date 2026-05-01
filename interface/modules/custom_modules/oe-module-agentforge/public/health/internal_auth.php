<?php

/**
 * Internal-auth round-trip probe for the AgentForge API `/health` endpoint.
 *
 * Returns 200 `{ok: true}` when the inbound `X-Internal-Auth` header matches the
 * `OPENEMR_MODULE_SHARED_SECRET` env var — i.e., the agentforge-api process and the
 * PHP runtime agree on the shared secret. Returns 401 `{error: 'invalid_internal_auth'}`
 * otherwise (mismatch, missing header, or missing env var).
 *
 * This makes the post-deploy "Confirm returns denied/failed" failure mode (P1
 * shared-secret drift between the `openemr` and `agentforge-api` containers)
 * surface in `GET /health` instead of as an opaque rail error after dictation.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

\agentforge_require_post();

if (!\agentforge_verify_internal_auth()) {
    \agentforge_emit_json(401, ['error' => 'invalid_internal_auth']);
}

\agentforge_emit_json(200, ['ok' => true]);
