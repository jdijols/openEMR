#!/usr/bin/env node
/**
 * G2-MVP-58 dev helper — mint a SessionToken for curl-based smoke testing.
 *
 * Production session tokens are minted by the OpenEMR module's
 * handshake_redeem.php after a launch-code redemption. For headless smoke
 * testing we re-implement the HMAC payload here using the same
 * SESSION_TOKEN_SECRET so the token verifies against the live API.
 *
 * Usage:
 *   node scripts/mint-dev-session-token.mjs <patient_uuid> [user_id] [ttl_sec]
 *
 * Example:
 *   node scripts/mint-dev-session-token.mjs 11111111-2222-4333-a444-aaaaaaaaaaaa
 */

import { createHmac } from 'node:crypto';

const [, , patientUuidArg, userIdArg, ttlArg] = process.argv;

if (!patientUuidArg) {
  console.error('Usage: node scripts/mint-dev-session-token.mjs <patient_uuid> [user_id] [ttl_sec]');
  process.exit(1);
}

const secret = process.env.SESSION_TOKEN_SECRET;
if (!secret || secret.length < 32) {
  console.error('SESSION_TOKEN_SECRET missing or shorter than 32 chars. Run via:');
  console.error('  npx dotenv -e ../../docker/agentforge/secrets.dev.env -- node scripts/mint-dev-session-token.mjs <uuid>');
  process.exit(1);
}

const userId = Number.parseInt(userIdArg ?? '1', 10);
const ttlSec = Number.parseInt(ttlArg ?? '3600', 10);
const nowSec = Math.floor(Date.now() / 1000);

const payload = {
  user_id: userId,
  patient_uuid: patientUuidArg,
  encounter_id: null,
  facility_tz: null,
  iat: nowSec,
  exp: nowSec + ttlSec,
};

const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
const sig = createHmac('sha256', secret).update(payloadB64).digest('base64url');
const token = `${payloadB64}.${sig}`;

// Print the bare token to stdout so callers can capture it cleanly.
process.stdout.write(token);
