#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs

if [ "${1:-}" = "--foreground" ]; then
  cd "${ROOT_DIR}/packages/web"
  exec "${ROOT_DIR}/scripts/with-node.sh" "${ROOT_DIR}/node_modules/vite/bin/vite.js" \
    --host "${JASOJEON_WEB_HOST:-0.0.0.0}" --port "${WEB_PORT}" --strictPort
fi

stop_pid_file "web" "${WEB_PID_FILE}" || true
kill_port_listeners "web" "${WEB_PORT}"

: > "${WEB_LOG_FILE}"
setsid bash -lc '
  cd "$1"
  exec "$2" "$3" --host "${JASOJEON_WEB_HOST:-0.0.0.0}" --port "$4" --strictPort
' _ \
  "${ROOT_DIR}/packages/web" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/node_modules/vite/bin/vite.js" \
  "${WEB_PORT}" \
  < /dev/null >> "${WEB_LOG_FILE}" 2>&1 &
echo "$!" > "${WEB_PID_FILE}"

web_pid="$(cat "${WEB_PID_FILE}")"

if ! wait_for_http "$(web_base_url)" 30; then
  print_log_tail "web" "${WEB_LOG_FILE}"
  echo "[jasojeon] Web dev server did not become ready." >&2
  exit 1
fi

echo "[jasojeon] Web dev server is ready at $(web_base_url) (pid ${web_pid})."
