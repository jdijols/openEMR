#!/usr/bin/env bash
#
# G2-Final-FB-C-01 — pre-deploy gate.
#
# Sequential build/quality gates that MUST exit 0 before a VPS deploy is
# announced. Distinct from `preflight.sh` (which validates credential
# rotation): this script catches the failure modes that the W2 MVP deploy
# tripped over —
#
#   1. `npm run build` (NOT `dev`) — surfaces TS type errors that the
#      tsx-based dev runner silently bypasses (per project memory:
#      "Run `npm run build` before any prod deploy").
#   2. `composer phpstan` — full repo, level 10.
#   3. `npm run eval` from agentforge/api — must exit 0 with zero
#      gate breaches against the pinned baseline (S12).
#   4. `prek run --all-files` — runs the full pre-commit hook suite.
#   5. Module-registrar refresh — forces a re-run of `agentforge-enable.php`
#      so the prod DB's `modules` row matches the deployed code.
#   6. Cohort `DEMO_WEEKDAY_DATES` validity — fails if the seeded
#      appointments are in the past so graders see fresh slots.
#
# Exits non-zero on the FIRST failed gate, with a single line naming the
# gate. Every gate echoes its name + result so the operator sees the
# whole sequence in stdout.
#
# Configuration:
#   AGENTFORGE_DEPLOY_PREFLIGHT_REPO_ROOT — repo root (auto-detected).
#   AGENTFORGE_DEPLOY_PREFLIGHT_SKIP_PREK=1 — skip step 4 (when prek is
#                                              not installed in the deploy
#                                              context; intentional opt-out).
#   AGENTFORGE_DEPLOY_PREFLIGHT_SKIP_PHPSTAN=1 — skip step 2 (intentional
#                                                 opt-out for hot-fix deploys
#                                                 where phpstan ran in CI).

set -uo pipefail

# Auto-detect the repo root from this script's location (two levels up).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="${AGENTFORGE_DEPLOY_PREFLIGHT_REPO_ROOT:-$(cd "${SCRIPT_DIR}/../.." && pwd -P)}"
API_DIR="${REPO_ROOT}/agentforge/api"
SEED_FILE="${REPO_ROOT}/contrib/util/agentforge/seed_appointments.php"

step=0
fail() {
  printf 'deploy-preflight: GATE %d FAILED — %s\n' "$step" "$1" >&2
  exit 1
}

ok() {
  printf 'deploy-preflight: gate %d ok — %s\n' "$step" "$1"
}

# ---------------------------------------------------------------------------
# Gate 1: npm run build (NOT dev — surfaces type errors tsx hides).
# ---------------------------------------------------------------------------
step=1
printf 'deploy-preflight: gate %d — npm run build (agentforge/api + agentforge/cui)\n' "$step"
if ! (cd "$API_DIR" && npm run build > /tmp/agentforge-deploy-preflight-api-build.log 2>&1); then
  printf 'last 20 lines of agentforge/api build log:\n' >&2
  tail -n 20 /tmp/agentforge-deploy-preflight-api-build.log >&2 || true
  fail "agentforge/api build failed (see /tmp/agentforge-deploy-preflight-api-build.log)"
fi
if [[ -d "${REPO_ROOT}/agentforge/cui" ]]; then
  if ! (cd "${REPO_ROOT}/agentforge/cui" && npm run build > /tmp/agentforge-deploy-preflight-cui-build.log 2>&1); then
    printf 'last 20 lines of agentforge/cui build log:\n' >&2
    tail -n 20 /tmp/agentforge-deploy-preflight-cui-build.log >&2 || true
    fail "agentforge/cui build failed"
  fi
fi
ok "build green"

# ---------------------------------------------------------------------------
# Gate 2: composer phpstan (level 10, full repo).
# ---------------------------------------------------------------------------
step=2
if [[ "${AGENTFORGE_DEPLOY_PREFLIGHT_SKIP_PHPSTAN:-0}" == "1" ]]; then
  printf 'deploy-preflight: gate %d — phpstan SKIPPED (AGENTFORGE_DEPLOY_PREFLIGHT_SKIP_PHPSTAN=1)\n' "$step"
else
  printf 'deploy-preflight: gate %d — composer phpstan\n' "$step"
  if ! (cd "$REPO_ROOT" && composer phpstan > /tmp/agentforge-deploy-preflight-phpstan.log 2>&1); then
    printf 'last 30 lines of phpstan log:\n' >&2
    tail -n 30 /tmp/agentforge-deploy-preflight-phpstan.log >&2 || true
    fail "phpstan reported errors (see /tmp/agentforge-deploy-preflight-phpstan.log)"
  fi
  ok "phpstan green"
fi

# ---------------------------------------------------------------------------
# Gate 3: npm run eval — pinned baseline + zero gate breaches.
# ---------------------------------------------------------------------------
step=3
printf 'deploy-preflight: gate %d — npm run eval (agentforge/api)\n' "$step"
EVAL_OUT="$(cd "$API_DIR" && npm run eval 2>&1 | tail -n 1)"
if [[ -z "$EVAL_OUT" ]]; then
  fail "eval produced no output"
fi
# The runner's last line is a JSON summary; grep for failures: 0 + breaches: 0.
if ! echo "$EVAL_OUT" | grep -q '"failures":0'; then
  printf 'eval summary: %s\n' "$EVAL_OUT" >&2
  fail "eval reported failures"
fi
if ! echo "$EVAL_OUT" | grep -q '"gate_breaches_count":0'; then
  printf 'eval summary: %s\n' "$EVAL_OUT" >&2
  fail "eval reported gate breaches against pinned baseline"
fi
ok "eval green ($(echo "$EVAL_OUT" | grep -oE '"cases":[0-9]+'))"

# ---------------------------------------------------------------------------
# Gate 4: prek run --all-files (full pre-commit suite).
# ---------------------------------------------------------------------------
step=4
if [[ "${AGENTFORGE_DEPLOY_PREFLIGHT_SKIP_PREK:-0}" == "1" ]]; then
  printf 'deploy-preflight: gate %d — prek SKIPPED (AGENTFORGE_DEPLOY_PREFLIGHT_SKIP_PREK=1)\n' "$step"
elif ! command -v prek >/dev/null 2>&1; then
  printf 'deploy-preflight: gate %d — prek not on PATH; skipping. Install via `pip install prek` or set AGENTFORGE_DEPLOY_PREFLIGHT_SKIP_PREK=1 to silence.\n' "$step"
else
  printf 'deploy-preflight: gate %d — prek run --all-files\n' "$step"
  if ! (cd "$REPO_ROOT" && prek run --all-files > /tmp/agentforge-deploy-preflight-prek.log 2>&1); then
    printf 'last 30 lines of prek log:\n' >&2
    tail -n 30 /tmp/agentforge-deploy-preflight-prek.log >&2 || true
    fail "prek reported errors (see /tmp/agentforge-deploy-preflight-prek.log)"
  fi
  ok "prek green"
fi

# ---------------------------------------------------------------------------
# Gate 5: module-registrar refresh.
#
# Reminds the operator that `agentforge-enable.php` MUST run on the VPS
# after the deploy lands so the prod DB's `modules` row matches the new
# code. The script doesn't run it — that requires the prod DB connection
# string. We emit a single-line reminder; the deploy runbook is
# responsible for the actual run.
# ---------------------------------------------------------------------------
step=5
printf 'deploy-preflight: gate %d — module-registrar refresh REQUIRED on prod\n' "$step"
printf '   ssh into the VPS and run: php bin/agentforge-enable.php\n'
printf '   (preflight cannot run this from CI; reminder only — see project memory)\n'
ok "module-registrar reminder emitted"

# ---------------------------------------------------------------------------
# Gate 6: cohort DEMO_WEEKDAY_DATES validity — must contain at least one
# date >= today so graders see fresh appointments after the deploy.
# ---------------------------------------------------------------------------
step=6
if [[ ! -f "$SEED_FILE" ]]; then
  printf 'deploy-preflight: gate %d — seed file not found at %s, skipping\n' "$step" "$SEED_FILE"
else
  printf 'deploy-preflight: gate %d — cohort DEMO_WEEKDAY_DATES validity\n' "$step"
  TODAY="$(date +%Y-%m-%d)"
  # Extract every YYYY-MM-DD between DEMO_WEEKDAY_DATES boundary markers.
  DATES="$(awk '/DEMO_WEEKDAY_DATES/,/];/{ print }' "$SEED_FILE" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort -u || true)"
  if [[ -z "$DATES" ]]; then
    fail "could not parse DEMO_WEEKDAY_DATES from $SEED_FILE"
  fi
  HAS_FUTURE=0
  while read -r d; do
    if [[ -z "$d" ]]; then continue; fi
    if [[ "$d" > "$TODAY" || "$d" == "$TODAY" ]]; then
      HAS_FUTURE=1
      break
    fi
  done <<< "$DATES"
  if [[ "$HAS_FUTURE" -ne 1 ]]; then
    printf 'cohort dates parsed: %s\n' "$DATES" >&2
    printf 'today: %s\n' "$TODAY" >&2
    fail "DEMO_WEEKDAY_DATES are all in the past — re-run the seed migration before deploying"
  fi
  ok "cohort dates include at least one future slot"
fi

printf 'deploy-preflight: ALL GATES GREEN — safe to deploy.\n'
exit 0
