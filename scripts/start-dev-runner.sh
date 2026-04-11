#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs
export JASOJEON_DRAFTER_DEBUG=1
export JASOJEON_DRAFTER_DEBUG_FILE="${ROOT_DIR}/.harness/logs/drafter-debug.jsonl"

if [ "${1:-}" = "--foreground" ]; then
  cd "${ROOT_DIR}/packages/runner"
  exec "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" watch src/index.ts
fi

runner_port_value="$(runner_port)"
stop_pid_file "runner" "${RUNNER_PID_FILE}" || true
kill_port_listeners "runner" "${runner_port_value}"

: > "${RUNNER_LOG_FILE}"
setsid bash -lc '
  cd "$1"
  exec env \
    JASOJEON_DRAFTER_DEBUG="$JASOJEON_DRAFTER_DEBUG" \
    JASOJEON_DRAFTER_DEBUG_FILE="$JASOJEON_DRAFTER_DEBUG_FILE" \
    "$2" "$3" watch src/index.ts
' _ \
  "${ROOT_DIR}/packages/runner" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
  < /dev/null >> "${RUNNER_LOG_FILE}" 2>&1 &
echo "$!" > "${RUNNER_PID_FILE}"

runner_pid="$(cat "${RUNNER_PID_FILE}")"

if ! wait_for_http "$(runner_base_url)/api/session" 30; then
  print_log_tail "runner" "${RUNNER_LOG_FILE}"
  echo "[jasojeon] Runner dev server did not become ready." >&2
  exit 1
fi

echo "[jasojeon] Runner dev server is ready at $(runner_base_url) (pid ${runner_pid})."
