#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs
runner_port_value="$(runner_port)"

if [ "${1:-}" = "--foreground" ]; then
  cd "${ROOT_DIR}/packages/web"
  exec env VITE_RUNNER_PORT="${runner_port_value}" \
    "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/vite/bin/vite.js" \
    --host 127.0.0.1 --port "${WEB_PORT}" --strictPort
fi

stop_pid_file "web" "${WEB_PID_FILE}" || true
kill_port_listeners "web" "${WEB_PORT}"

: > "${WEB_LOG_FILE}"
setsid bash -lc '
  cd "$1"
  export VITE_RUNNER_PORT="$2"
  exec "$3" "$4" --host 127.0.0.1 --port "$5" --strictPort
' _ \
  "${ROOT_DIR}/packages/web" \
  "${runner_port_value}" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/node_modules/vite/bin/vite.js" \
  "${WEB_PORT}" \
  < /dev/null >> "${WEB_LOG_FILE}" 2>&1 &
echo "$!" > "${WEB_PID_FILE}"

web_pid="$(cat "${WEB_PID_FILE}")"

if ! wait_for_http "$(web_base_url)" 30; then
  print_log_tail "web" "${WEB_LOG_FILE}"
  echo "[jafiction] Web dev server did not become ready." >&2
  exit 1
fi

echo "[jafiction] Web dev server is ready at $(web_base_url) (pid ${web_pid})."
