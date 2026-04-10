#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs
stop_pid_file "web" "${WEB_PID_FILE}" || true
stop_pid_file "runner" "${RUNNER_PID_FILE}" || true
kill_matching_processes "web" "${ROOT_DIR}/node_modules/vite/bin/vite.js"
kill_matching_processes "web" "${ROOT_DIR}/node_modules/.bin/vite"
kill_matching_processes "runner" "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs watch src/index.ts"
kill_matching_processes "runner" "${ROOT_DIR}/node_modules/.bin/tsx watch src/index.ts"
kill_port_listeners "web" "${WEB_PORT}"
kill_port_listeners "runner" "$(runner_port)"

echo "[jafiction] Development stack stopped."
