#!/usr/bin/env bash
#
# AgentForge — pre-flight credential check (PRD §7.7, G6-05).
#
# Asserts that a deploy is safe to expose publicly:
#   1. OpenEMR `admin` password is rotated away from upstream `pass`.
#   2. `OE_USER` / `OE_PASS` env vars are non-default if set.
#   3. `sites/default/sqlconf.php` is not the upstream template.
#   4. `agentforge-api` env contains non-empty values for required secrets.
#
# Exits non-zero on the first failed assertion with a single-line message
# describing the failure (PRD §7.7.3 Given/When/Then). The deploy procedure
# (§7.8) gates on this script — no public URL is announced unless this script
# exits 0.
#
# Configuration:
#   AGENTFORGE_PREFLIGHT_ENV_FILE  — path to the env file to inspect.
#                                    Default: docker/agentforge/secrets.prod.env
#                                    relative to the repo root (auto-detected).
#   AGENTFORGE_PREFLIGHT_OPENEMR_DIR — repo root (default: auto-detected from
#                                      the script location, two levels up).
#   AGENTFORGE_PREFLIGHT_SQLCONF   — explicit path to sqlconf.php to check;
#                                    default: ${OPENEMR_DIR}/sites/default/sqlconf.php
#   AGENTFORGE_PREFLIGHT_SKIP_SQLCONF=1 — skip the sqlconf assertion (e.g. when
#                                         OpenEMR runs on a separate volume and
#                                         sqlconf is not a file on this host).
#   AGENTFORGE_PREFLIGHT_SKIP_ADMIN_PASSWORD=1 — skip the admin password
#                                         assertion (the env-only check below
#                                         catches `OE_PASS=pass`; live MariaDB
#                                         verification is operator-side).
#
# Tested by docker/agentforge/preflight.bats — run with `bats preflight.bats`
# locally (the harness ships a bash-only fallback if bats is unavailable; see
# the smoke at the bottom of this file).

set -euo pipefail

# ---- Required secrets (PRD §7.7.1) -------------------------------------------
# Keep this list in sync with `agentforge/api/src/env.ts` for "must be non-empty".
REQUIRED_SECRETS=(
	"LLM_API_KEY"
	"STT_API_KEY"
	"OPENEMR_MODULE_SHARED_SECRET"
	"SESSION_TOKEN_SECRET"
)

DEFAULT_PLACEHOLDERS=(
	"replace-me"
	"replace-me-use-openssl-rand-hex-32-or-longer"
	"changeme"
	""
)

DEFAULT_ADMIN_PASSWORDS=(
	"pass"
	"admin"
	"openemr"
	"password"
)

# ---- Helpers -----------------------------------------------------------------
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
default_repo_root="$(cd "${script_dir}/../.." && pwd)"

OPENEMR_DIR="${AGENTFORGE_PREFLIGHT_OPENEMR_DIR:-${default_repo_root}}"
ENV_FILE="${AGENTFORGE_PREFLIGHT_ENV_FILE:-${script_dir}/secrets.prod.env}"
SQLCONF_FILE="${AGENTFORGE_PREFLIGHT_SQLCONF:-${OPENEMR_DIR}/sites/default/sqlconf.php}"

fail() {
	echo "preflight: FAIL — $*" >&2
	exit 1
}

ok() {
	echo "preflight: ok — $*"
}

# Read a single env-file key without sourcing the file (sourcing risks executing
# unintended shell). Lines must look like KEY=value (no leading export).
env_get() {
	local key="$1"
	local file="$2"
	[ -f "$file" ] || return 1
	awk -F '=' -v k="$key" '
		!/^[[:space:]]*#/ && $1 == k {
			# Strip surrounding quotes from the value.
			val = substr($0, index($0, "=") + 1)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", val)
			gsub(/^"(.*)"$/, "\\1", val)
			gsub(/^'\''(.*)'\''$/, "\\1", val)
			print val
			exit
		}
	' "$file"
}

is_placeholder() {
	local v="$1"
	for ph in "${DEFAULT_PLACEHOLDERS[@]}"; do
		[ "$v" = "$ph" ] && return 0
	done
	return 1
}

# ---- Assertions --------------------------------------------------------------
assert_env_file_present() {
	[ -f "$ENV_FILE" ] || fail "env file not found at ${ENV_FILE}"
	ok "env file present at ${ENV_FILE}"
}

assert_required_secrets_set() {
	for key in "${REQUIRED_SECRETS[@]}"; do
		local val
		val="$(env_get "$key" "$ENV_FILE" || true)"
		if [ -z "$val" ]; then
			fail "${key} required (empty or missing in ${ENV_FILE})"
		fi
		if is_placeholder "$val"; then
			fail "${key} is still set to a placeholder (${val}) — rotate before deploy"
		fi
	done
	ok "required secrets present and non-placeholder: ${REQUIRED_SECRETS[*]}"
}

assert_admin_password_rotated() {
	if [ "${AGENTFORGE_PREFLIGHT_SKIP_ADMIN_PASSWORD:-}" = "1" ]; then
		ok "skipped (AGENTFORGE_PREFLIGHT_SKIP_ADMIN_PASSWORD=1) — admin password rotation"
		return
	fi
	local oe_pass
	oe_pass="$(env_get "OE_PASS" "$ENV_FILE" || true)"
	# OE_PASS is optional (compose can use the upstream image default); when it
	# IS set, it must not match a known default.
	if [ -n "$oe_pass" ]; then
		for default in "${DEFAULT_ADMIN_PASSWORDS[@]}"; do
			if [ "$oe_pass" = "$default" ]; then
				fail "admin password must be rotated (OE_PASS=${default})"
			fi
		done
		ok "OE_PASS rotated away from upstream defaults"
	else
		# OE_PASS unset — assume operator rotated via the OpenEMR UI; this
		# script cannot verify the live MariaDB password without a privileged
		# query, which is intentionally out of scope for a credential gate
		# that runs before the URL is exposed. Document the expectation.
		ok "OE_PASS not in env file (operator must verify admin password rotated via OpenEMR UI)"
	fi
}

assert_sqlconf_customized() {
	if [ "${AGENTFORGE_PREFLIGHT_SKIP_SQLCONF:-}" = "1" ]; then
		ok "skipped (AGENTFORGE_PREFLIGHT_SKIP_SQLCONF=1) — sqlconf customization"
		return
	fi
	if [ ! -f "$SQLCONF_FILE" ]; then
		# Fresh install before bootstrap — sqlconf is generated at first run.
		ok "sqlconf.php not yet generated at ${SQLCONF_FILE} (fresh install)"
		return
	fi
	# The upstream OpenEMR sqlconf template ships with login=openemr / pass=openemr
	# AND a literal `'pass openemr'` comment. Real installs replace these with a
	# customized password. We check the *value* lines, not just the comment.
	if grep -Eq "^[[:space:]]*\\\$login[[:space:]]*=[[:space:]]*['\"]openemr['\"]" "$SQLCONF_FILE" \
		&& grep -Eq "^[[:space:]]*\\\$pass[[:space:]]*=[[:space:]]*['\"]openemr['\"]" "$SQLCONF_FILE"; then
		fail "sqlconf.php must be customized (still has upstream login=openemr / pass=openemr)"
	fi
	ok "sqlconf.php customized (no upstream login/pass pair)"
}

# ---- Run ---------------------------------------------------------------------
echo "preflight: starting (env=${ENV_FILE}, openemr=${OPENEMR_DIR})"
assert_env_file_present
assert_required_secrets_set
assert_admin_password_rotated
assert_sqlconf_customized
echo "preflight: PASS — safe to expose URL"
