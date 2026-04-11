#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs
stop_pid_file "web" "${WEB_PID_FILE}" || true
kill_matching_processes "web" "${ROOT_DIR}/node_modules/vite/bin/vite.js"
kill_matching_processes "web" "${ROOT_DIR}/node_modules/.bin/vite"
kill_port_listeners "web" "${WEB_PORT}"

echo "[jasojeon] Development stack stopped."
