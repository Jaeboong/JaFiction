#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs
status=0

runner_url="$(runner_base_url)"
web_url="$(web_base_url)"
runner_listener_pid="$(listener_pid_for_port "$(runner_port)" || true)"
web_listener_pid="$(listener_pid_for_port "${WEB_PORT}" || true)"

if [ -f "${RUNNER_PID_FILE}" ] && process_is_running "$(cat "${RUNNER_PID_FILE}")"; then
  echo "[ok] runner process: pid $(cat "${RUNNER_PID_FILE}")"
else
  echo "[fail] runner process: not running"
  status=1
fi

if http_ok "${runner_url}/api/session" 2500; then
  if [ -n "${runner_listener_pid}" ]; then
    echo "[ok] runner endpoint: ${runner_url}/api/session (listener pid ${runner_listener_pid})"
  else
    echo "[ok] runner endpoint: ${runner_url}/api/session"
  fi
else
  echo "[fail] runner endpoint: ${runner_url}/api/session"
  status=1
fi

if [ -f "${WEB_PID_FILE}" ] && process_is_running "$(cat "${WEB_PID_FILE}")"; then
  echo "[ok] web process: pid $(cat "${WEB_PID_FILE}")"
else
  echo "[fail] web process: not running"
  status=1
fi

if http_ok "${web_url}" 2500; then
  if [ -n "${web_listener_pid}" ]; then
    echo "[ok] web endpoint: ${web_url} (listener pid ${web_listener_pid})"
  else
    echo "[ok] web endpoint: ${web_url}"
  fi
else
  echo "[fail] web endpoint: ${web_url}"
  status=1
fi

echo "[info] runner log: ${RUNNER_LOG_FILE}"
echo "[info] web log: ${WEB_LOG_FILE}"

exit "${status}"
