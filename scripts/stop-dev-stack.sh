#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

stop_all_containers=0

while [ $# -gt 0 ]; do
  case "$1" in
    --all) stop_all_containers=1 ;;
    *)
      echo "[jasojeon] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

ensure_harness_dirs

stop_pid_file "web" "${WEB_PID_FILE}" || true
kill_matching_processes "web" "${ROOT_DIR}/node_modules/vite/bin/vite.js"
kill_matching_processes "web" "${ROOT_DIR}/node_modules/.bin/vite"
kill_port_listeners "web" "${WEB_PORT}"

stop_pid_file "runner" "${RUNNER_PID_FILE}" || true

stop_pid_file "backend" "${BACKEND_PID_FILE}" || true
kill_port_listeners "backend" "4000"

if [ "${stop_all_containers}" -eq 1 ]; then
  echo "[jasojeon] Stopping dev containers..."
  docker compose -f "${DEV_COMPOSE_FILE}" down || true
fi

echo "[jasojeon] Development stack stopped."
