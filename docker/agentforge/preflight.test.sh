#!/usr/bin/env bash
#
# AgentForge — preflight.sh test harness (PRD §7.7.3, G6-05).
#
# Bash-only harness so the test runs anywhere preflight.sh runs (no bats / no
# extra deps). Each scenario builds a temp env file, invokes preflight.sh
# against it, and asserts on exit code + a substring of stdout/stderr.
#
# Run:
#   docker/agentforge/preflight.test.sh
#
# Exits non-zero on any failed scenario.

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
preflight="${script_dir}/preflight.sh"

if [ ! -x "$preflight" ]; then
	echo "preflight.test: FAIL — preflight.sh missing or not executable at ${preflight}" >&2
	exit 2
fi

# ----- Test infrastructure ----------------------------------------------------
tmp_root="$(mktemp -d -t agentforge-preflight-test-XXXXXX)"
# shellcheck disable=SC2064
trap "rm -rf '${tmp_root}'" EXIT

scenario_count=0
failure_count=0

red() { printf '\033[0;31m%s\033[0m' "$1"; }
green() { printf '\033[0;32m%s\033[0m' "$1"; }

# Render a complete env file with the required keys filled. Caller passes
# overrides as `KEY=value` args (each becomes a final-line that wins over the
# defaults in awk-based env_get).
make_env_file() {
	local env_path="$1"
	shift
	cat >"$env_path" <<'EOF'
# Test fixture. Includes every required key from REQUIRED_SECRETS.
LLM_API_KEY=real-key-1234567890
STT_API_KEY=real-key-0987654321
OPENEMR_MODULE_SHARED_SECRET=12c3f5a9b3aabbccddeeff00112233445566778899aabbccddeeff0011223344
SESSION_TOKEN_SECRET=12c3f5a9b3aabbccddeeff00112233445566778899aabbccddeeff0011223344
OE_USER=admin
OE_PASS=rotated-strong-password-12345
EOF
	# Apply overrides — each replaces the matching key (last write wins).
	for kv in "$@"; do
		local key="${kv%%=*}"
		# Use `|` as sed delimiter so URL/path values don't break it.
		sed -i.bak "/^${key}=/d" "$env_path" && rm -f "${env_path}.bak"
		echo "$kv" >>"$env_path"
	done
}

# Run preflight with a given env file + optional skip flags. Captures combined
# output for substring assertions.
run_preflight() {
	local env_file="$1"
	shift
	# Discard any operator env that might leak into the run.
	env -i \
		PATH="/usr/local/bin:/usr/bin:/bin" \
		HOME="$tmp_root" \
		AGENTFORGE_PREFLIGHT_ENV_FILE="$env_file" \
		AGENTFORGE_PREFLIGHT_SKIP_SQLCONF="${SKIP_SQLCONF:-1}" \
		AGENTFORGE_PREFLIGHT_OPENEMR_DIR="${tmp_root}" \
		"$@" \
		bash "$preflight" 2>&1
}

assert_scenario() {
	local title="$1"
	local expected_exit="$2"
	local expected_substring="$3"
	local actual_exit="$4"
	local actual_output="$5"

	scenario_count=$((scenario_count + 1))
	local prefix="[${scenario_count}] ${title}"

	if [ "$actual_exit" != "$expected_exit" ]; then
		failure_count=$((failure_count + 1))
		echo "$(red FAIL) ${prefix}: expected exit ${expected_exit}, got ${actual_exit}"
		echo "  output: ${actual_output}"
		return
	fi

	if ! grep -qF "$expected_substring" <<<"$actual_output"; then
		failure_count=$((failure_count + 1))
		echo "$(red FAIL) ${prefix}: output missing substring '${expected_substring}'"
		echo "  output: ${actual_output}"
		return
	fi

	echo "$(green PASS) ${prefix}"
}

# ----- Scenarios (PRD §7.7.3) -------------------------------------------------

# 1. Happy path — all required secrets present, OE_PASS rotated, sqlconf
#    skipped (no real OpenEMR install in the test harness).
run_happy() {
	local env="${tmp_root}/happy.env"
	make_env_file "$env"
	out="$(run_preflight "$env")"
	rc=$?
	assert_scenario "happy path passes" "0" "preflight: PASS" "$rc" "$out"
}

# 2. PRD §7.7.3 Scenario "Missing LLM key blocks deploy".
run_missing_llm_key() {
	local env="${tmp_root}/no-llm-key.env"
	make_env_file "$env" "LLM_API_KEY="
	out="$(run_preflight "$env")"
	rc=$?
	assert_scenario "missing LLM_API_KEY blocks deploy" "1" "LLM_API_KEY required" "$rc" "$out"
}

# 3. PRD §7.7.3 Scenario "Default admin password blocks deploy".
run_default_admin_password() {
	local env="${tmp_root}/default-admin.env"
	make_env_file "$env" "OE_PASS=pass"
	out="$(run_preflight "$env")"
	rc=$?
	assert_scenario "OE_PASS=pass blocks deploy" "1" "admin password must be rotated" "$rc" "$out"
}

# 4. PRD §7.7.3 Scenario "Pristine sqlconf blocks deploy".
run_pristine_sqlconf() {
	local env="${tmp_root}/with-sqlconf.env"
	make_env_file "$env"
	# Build a fake repo root with the upstream sqlconf template contents.
	local sites_dir="${tmp_root}/sites/default"
	mkdir -p "$sites_dir"
	cat >"${sites_dir}/sqlconf.php" <<'PHP'
<?php
$host   = 'localhost';
$port   = '3306';
$login  = 'openemr';
$pass   = 'openemr';
$dbase  = 'openemr';
PHP
	# Use SKIP_SQLCONF=0 just for this run.
	out="$(SKIP_SQLCONF=0 run_preflight "$env")"
	rc=$?
	assert_scenario "pristine sqlconf blocks deploy" "1" "sqlconf.php must be customized" "$rc" "$out"
}

# 5. Placeholder secret left in env file blocks deploy.
run_placeholder_secret() {
	local env="${tmp_root}/placeholder.env"
	make_env_file "$env" "STT_API_KEY=replace-me"
	out="$(run_preflight "$env")"
	rc=$?
	assert_scenario "placeholder STT_API_KEY blocks deploy" "1" "STT_API_KEY is still set to a placeholder" "$rc" "$out"
}

# 6. Env file missing entirely.
run_missing_env_file() {
	out="$(run_preflight "${tmp_root}/does-not-exist.env")"
	rc=$?
	assert_scenario "missing env file blocks deploy" "1" "env file not found" "$rc" "$out"
}

run_happy
run_missing_llm_key
run_default_admin_password
run_pristine_sqlconf
run_placeholder_secret
run_missing_env_file

echo
echo "preflight.test: ${scenario_count} scenarios, ${failure_count} failures"
[ "$failure_count" -eq 0 ]
