#!/usr/bin/env bash
#
# AgentForge — CUI bundle freshness hook.
#
# Wired into `.pre-commit-config.yaml` so that any commit touching CUI
# source files (`agentforge/cui/src/`, build inputs, etc.) automatically
# rebuilds the bundle the panel iframe actually loads:
#
#   interface/modules/custom_modules/oe-module-agentforge/public/cui/
#     ├── agentforge-cui.js
#     └── agentforge-cui-index.css
#
# Without this, source edits compile cleanly and tests pass while the
# bundled artifact in the OpenEMR module stays stale — the iframe keeps
# loading the previous build, which surfaces as "the fix didn't ship."
# `panel.php` cache-busts via `?v=<filehash>`, so as long as the bundle
# on disk is current, the next chart reload picks it up automatically.
#
# Behaviour:
#   * Rebuilds the bundle (`npm run build` in `agentforge/cui/`).
#   * `git add -A`s the bundle directory so the commit succeeds first
#     try with the fresh artifact included.
#   * If `node_modules/` is missing (fresh clone), runs `npm install`
#     once before building so the hook is self-bootstrapping.
#
# Bypass: `git commit --no-verify` skips the hook (and ships a stale
# bundle). Don't.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CUI_DIR="$REPO_ROOT/agentforge/cui"
BUNDLE_DIR="$REPO_ROOT/interface/modules/custom_modules/oe-module-agentforge/public/cui"

if ! command -v npm >/dev/null 2>&1; then
    echo "agentforge-cui: npm not found on PATH — install Node 20+ to commit CUI changes." >&2
    exit 1
fi

if [ ! -d "$CUI_DIR/node_modules" ]; then
    echo "agentforge-cui: installing npm dependencies (one-time)…"
    (cd "$CUI_DIR" && npm install --silent)
fi

echo "agentforge-cui: rebuilding bundle for $BUNDLE_DIR"
(cd "$CUI_DIR" && npm run --silent build)

# `-A` stages adds + deletes — the build uses `emptyOutDir: true`, so
# any chunk file that's no longer emitted needs to be removed from the
# index too, not just the entry bundle.
git add -A "$BUNDLE_DIR"
