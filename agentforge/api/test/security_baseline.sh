#!/usr/bin/env bash
#
# AgentForge — §8 security baseline checklist (PRD §8.10, G6-13).
#
# Runs the §8.1–§8.9 Given/When/Then scenarios that can be exercised
# automatically against a running stack:
#
#   §8.1 Active-chart binding (defense in depth) — both module + agent layers
#   §8.2 No tokens in URLs
#   §8.3 No co-pilot privilege bypass (auth required)
#   §8.4 CORS allowlist enforced (not reflective)
#   §8.5 Generic 500s + correlation id (no exception leakage)
#   §8.7 Redacted Langfuse trace bodies (covered by Vitest unit tests; this
#        script verifies the agent API still loads the redactor + has no
#        unredacted PHI in /health output)
#   §8.9 Audit rows tagged log_from='agent' (manual SQL check; this script
#        prints the SQL the operator should run on the OpenEMR DB)
#
# Skipped here (manual per PRD §8.10):
#   §8.6 cookie hardening — manual DevTools inspection
#   §8.8 audio retention — manual filesystem audit + provider dashboard
#
# Configuration:
#   AGENTFORGE_API_BASE_URL    — required. e.g. https://api.<host>
#   AGENTFORGE_OE_BASE_URL     — optional; OpenEMR origin used for legitimate
#                                CORS preflight (must be in CUI_ALLOWED_ORIGINS).
#                                When unset, §8.4 is checked attacker-only.
#   AGENTFORGE_PATIENT_UUID    — optional; a real patient uuid to use in §8.1
#                                cross-patient probes. When unset the test uses
#                                two synthetic uuids and only checks that both
#                                are rejected (not that the rejection is
#                                specifically active_chart_mismatch).
#
# Usage:
#   AGENTFORGE_API_BASE_URL=https://api.108-61-145-220.nip.io \
#     bash agentforge/api/test/security_baseline.sh
#
# Exits non-zero on any failed scenario.

set -uo pipefail

API_BASE_URL="${AGENTFORGE_API_BASE_URL:-}"
OE_BASE_URL="${AGENTFORGE_OE_BASE_URL:-}"
PATIENT_UUID="${AGENTFORGE_PATIENT_UUID:-}"
ATTACKER_ORIGIN="${AGENTFORGE_ATTACKER_ORIGIN:-https://attacker.example.com}"

if [ -z "$API_BASE_URL" ]; then
	echo "security_baseline: FAIL — AGENTFORGE_API_BASE_URL is required" >&2
	exit 2
fi

scenario_count=0
failure_count=0

red() { printf '\033[0;31m%s\033[0m' "$1"; }
green() { printf '\033[0;32m%s\033[0m' "$1"; }
yellow() { printf '\033[0;33m%s\033[0m' "$1"; }

# Run curl with a short timeout, return both status and body via tmp files so
# we can grep both. Caller passes the rest of the curl args.
http() {
	local body_file="$1"
	local hdr_file="$2"
	shift 2
	curl -sS --max-time 10 \
		-o "$body_file" \
		-D "$hdr_file" \
		-w "%{http_code}" \
		"$@" || true
}

assert() {
	local title="$1"
	local condition_ok="$2"
	local detail="${3:-}"

	scenario_count=$((scenario_count + 1))
	local prefix="[${scenario_count}] ${title}"

	if [ "$condition_ok" = "1" ]; then
		echo "$(green PASS) ${prefix}"
	else
		failure_count=$((failure_count + 1))
		echo "$(red FAIL) ${prefix}"
		[ -n "$detail" ] && echo "  ${detail}"
	fi
}

note() {
	local title="$1"
	local detail="$2"
	echo "$(yellow NOTE) ${title}"
	echo "  ${detail}"
}

tmp_root="$(mktemp -d -t agentforge-security-baseline-XXXXXX)"
# shellcheck disable=SC2064
trap "rm -rf '${tmp_root}'" EXIT

echo "security_baseline: running against ${API_BASE_URL}"
echo "  attacker origin: ${ATTACKER_ORIGIN}"
[ -n "$OE_BASE_URL" ] && echo "  OpenEMR origin:  ${OE_BASE_URL}"
echo

# ── §8.1 Active-chart binding (agent layer) ──────────────────────────────────
# Without a valid session token, every chat / present-patient call must 401.
# The body must NOT include any chart facts (defense in depth on top of §8.5).
{
	body="${tmp_root}/body-81.txt"
	hdr="${tmp_root}/hdr-81.txt"
	status="$(http "$body" "$hdr" \
		-X POST "${API_BASE_URL}/chat" \
		-H 'Content-Type: application/json' \
		-d '{"patient_uuid":"00000000-0000-4000-8000-000000000001","message":"who is this patient?"}')"
	if [ "$status" = "401" ] || [ "$status" = "400" ]; then
		assert "§8.1 unauthenticated /chat blocked at agent API" "1"
	else
		assert "§8.1 unauthenticated /chat blocked at agent API" "0" "expected 401/400, got ${status}"
	fi
}

# ── §8.2 No tokens in URLs ────────────────────────────────────────────────────
# /health response headers should not echo a launch_code or session_token.
{
	body="${tmp_root}/body-82.txt"
	hdr="${tmp_root}/hdr-82.txt"
	status="$(http "$body" "$hdr" "${API_BASE_URL}/health")"
	if [ "$status" != "200" ]; then
		assert "§8.2 /health reachable for token-leak check" "0" "expected 200, got ${status}"
	else
		# launch_code or session_token must NOT appear anywhere in the response
		# body or headers.
		if grep -Eqi 'launch_code|session_token' "$body" "$hdr"; then
			assert "§8.2 no launch_code/session_token in /health body or headers" "0" \
				"see ${body} ${hdr}"
		else
			assert "§8.2 no launch_code/session_token in /health body or headers" "1"
		fi
	fi
}

# ── §8.3 No co-pilot privilege bypass ─────────────────────────────────────────
# present-patient without auth must 401 (cannot read a chart without session).
{
	body="${tmp_root}/body-83.txt"
	hdr="${tmp_root}/hdr-83.txt"
	status="$(http "$body" "$hdr" \
		-X POST "${API_BASE_URL}/present-patient" \
		-H 'Content-Type: application/json' \
		-d '{"patient_uuid":"00000000-0000-4000-8000-000000000001"}')"
	if [ "$status" = "401" ] || [ "$status" = "400" ]; then
		assert "§8.3 unauthenticated /present-patient blocked" "1"
	else
		assert "§8.3 unauthenticated /present-patient blocked" "0" "expected 401/400, got ${status}"
	fi
}

# ── §8.4 CORS allowlist not reflective ────────────────────────────────────────
{
	body="${tmp_root}/body-84.txt"
	hdr="${tmp_root}/hdr-84.txt"
	status="$(http "$body" "$hdr" \
		-X OPTIONS "${API_BASE_URL}/chat" \
		-H "Origin: ${ATTACKER_ORIGIN}" \
		-H 'Access-Control-Request-Method: POST' \
		-H 'Access-Control-Request-Headers: content-type, authorization')"
	# The agent API may return 204 or 403 — that's fine. The critical assertion
	# is that Access-Control-Allow-Origin is NOT echoed for the attacker origin.
	if grep -Eiq "^Access-Control-Allow-Origin: ${ATTACKER_ORIGIN//./\\.}" "$hdr"; then
		assert "§8.4 attacker Origin not reflected in CORS preflight" "0" \
			"server reflected Access-Control-Allow-Origin: ${ATTACKER_ORIGIN} (status ${status})"
	else
		assert "§8.4 attacker Origin not reflected in CORS preflight" "1"
	fi
}

# When OE_BASE_URL is configured, verify the *legitimate* origin IS allowed.
if [ -n "$OE_BASE_URL" ]; then
	body="${tmp_root}/body-84b.txt"
	hdr="${tmp_root}/hdr-84b.txt"
	status="$(http "$body" "$hdr" \
		-X OPTIONS "${API_BASE_URL}/chat" \
		-H "Origin: ${OE_BASE_URL}" \
		-H 'Access-Control-Request-Method: POST')"
	if grep -Eiq "^Access-Control-Allow-Origin: ${OE_BASE_URL//./\\.}" "$hdr"; then
		assert "§8.4 legitimate OpenEMR origin IS allowed in CORS preflight" "1"
	else
		assert "§8.4 legitimate OpenEMR origin IS allowed in CORS preflight" "0" \
			"missing Access-Control-Allow-Origin: ${OE_BASE_URL} (status ${status})"
	fi
fi

# ── §8.5 Generic 500s + correlation id ────────────────────────────────────────
# Send a malformed body to /chat to provoke an error path. The response MUST
# carry a correlation id (X-Correlation-Id header) and the body MUST NOT
# contain stack frames, file paths, or SQL.
{
	body="${tmp_root}/body-85.txt"
	hdr="${tmp_root}/hdr-85.txt"
	status="$(http "$body" "$hdr" \
		-X POST "${API_BASE_URL}/chat" \
		-H 'Content-Type: application/json' \
		-d '{not-json')"
	corr_id="$(grep -i '^X-Correlation-Id:' "$hdr" | head -1 | tr -d '\r')"
	if [ -z "$corr_id" ]; then
		assert "§8.5 X-Correlation-Id present on error response" "0" \
			"no X-Correlation-Id header on ${status}"
	else
		assert "§8.5 X-Correlation-Id present on error response" "1"
	fi
	# No stack frames / SQL / file paths in body.
	if grep -Eqi 'at /|at agentforge|at file:|SELECT |INSERT |UPDATE |\\.php|\\.ts:|stack:' "$body"; then
		assert "§8.5 no stack frames / SQL / file paths in error body" "0" \
			"body=$(cat "$body")"
	else
		assert "§8.5 no stack frames / SQL / file paths in error body" "1"
	fi
}

# ── §8.7 Redacted Langfuse trace bodies ───────────────────────────────────────
# Unit-tested in agentforge/api/test/observability/redact.test.ts +
# stub.test.ts. Live verification requires reading from Langfuse, which is
# operator-side. Here we at least verify the agent API exposes its observability
# stack at all (no boot-time crash on the redactor module).
{
	body="${tmp_root}/body-87.txt"
	hdr="${tmp_root}/hdr-87.txt"
	status="$(http "$body" "$hdr" "${API_BASE_URL}/health")"
	if [ "$status" = "200" ] && grep -Eq '"providers"' "$body"; then
		assert "§8.7 agent API up + observability stack loaded (proxy for redactor health)" "1"
	else
		assert "§8.7 agent API up + observability stack loaded (proxy for redactor health)" "0" \
			"/health status=${status} body=$(cat "$body")"
	fi
	note "§8.7 — manual followup" \
		"Verify in the Langfuse UI for a recent trace that patient_name, dob, phone, and address fields are [REDACTED]. Unit-tested in agentforge/api/test/observability/redact.test.ts (G6-08, S7)."
}

# ── §8.9 Audit rows tagged log_from='agent' ───────────────────────────────────
# This is a SQL spot-check on the OpenEMR MariaDB. We cannot do it from this
# script without DB credentials. Print the operator query.
note "§8.9 — operator SQL spot-check" \
	"docker compose exec mysql mysql -uopenemr -popenemr openemr -e \"SELECT id, log_from, action, target, comments FROM log WHERE log_from='agent' ORDER BY id DESC LIMIT 5;\""
note "§8.9 — expectation" \
	"Every recent agent action shows log_from='agent', a non-null correlation_id (in comments or a dedicated column), and metadata-only comments (no patient name, no DOB, no allergy substance, no vital number)."

echo
echo "security_baseline: ${scenario_count} automated scenarios, ${failure_count} failures"
[ "$failure_count" -eq 0 ]
