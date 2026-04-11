#!/usr/bin/env bash
#
# dev-stack.sh — hosted-only local dev entrypoint (Stage 11.7).
#
# After local-mode retire the runner no longer exposes a localhost HTTP/WS
# server. The only supported development loop is:
#
#   1. backend (+ postgres + redis) running locally (docker compose or native)
#   2. a paired runner in hosted mode, outbound-connected to the local backend
#   3. web dev server connected to the same local backend as its hosted API
#
# This script is the canonical way to bring that stack up. It does NOT start
# docker compose — the user runs that separately — but it does start the
# runner in hosted mode and the web vite dev server.
#
# Required environment variables:
#   JASOJEON_BACKEND_URL   backend base URL (e.g. http://localhost:4000)
#   (The runner reads its device token from ~/.jasojeon/device-token.json,
#    so the runner must have been paired once before this script is useful.)
#
# Optional:
#   JASOJEON_WEB_PORT      web vite port (default 4124)
#   VITE_HOSTED_API_BASE   hosted API base the web bundle points at
#                          (default: mirrors JASOJEON_BACKEND_URL)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${ROOT_DIR}/scripts/harness-common.sh"

: "${JASOJEON_BACKEND_URL:?JASOJEON_BACKEND_URL is required (e.g. http://localhost:4000)}"
export JASOJEON_MODE="hosted"
export JASOJEON_BACKEND_URL
export VITE_HOSTED_API_BASE="${VITE_HOSTED_API_BASE:-${JASOJEON_BACKEND_URL}}"

ensure_harness_dirs

"${ROOT_DIR}/scripts/check.sh"
"${ROOT_DIR}/scripts/stop-dev-stack.sh"

# --- start the runner in hosted outbound mode -------------------------------
RUNNER_PID_FILE="${PID_DIR}/runner.pid"
RUNNER_LOG_FILE="${LOG_DIR}/runner.log"

if [ -f "${RUNNER_PID_FILE}" ]; then
  stop_pid_file "runner" "${RUNNER_PID_FILE}" || true
fi

: > "${RUNNER_LOG_FILE}"
setsid bash -lc '
  cd "$1"
  export JASOJEON_MODE="$5"
  export JASOJEON_BACKEND_URL="$6"
  exec "$2" "$3" watch "$4"
' _ \
  "${ROOT_DIR}/packages/runner" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
  "src/index.ts" \
  "${JASOJEON_MODE}" \
  "${JASOJEON_BACKEND_URL}" \
  < /dev/null >> "${RUNNER_LOG_FILE}" 2>&1 &
echo "$!" > "${RUNNER_PID_FILE}"

echo "[jasojeon] Runner (hosted mode) started; connecting to ${JASOJEON_BACKEND_URL}"
echo "[jasojeon] Runner log: ${RUNNER_LOG_FILE}"

# --- start the web vite dev server ------------------------------------------
"${ROOT_DIR}/scripts/start-dev-web.sh"
"${ROOT_DIR}/scripts/status-dev-stack.sh"

echo "[jasojeon] Hosted dev stack ready."
echo "[jasojeon]   backend : ${JASOJEON_BACKEND_URL}"
echo "[jasojeon]   web     : $(web_base_url)"
