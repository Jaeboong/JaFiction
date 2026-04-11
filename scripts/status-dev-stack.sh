#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs
status=0

# --- Postgres container -------------------------------------------------------
pg_cid="$(docker compose -f "${DEV_COMPOSE_FILE}" ps -q postgres 2>/dev/null || true)"
if [ -n "${pg_cid}" ]; then
  pg_health="$(docker inspect --format='{{.State.Health.Status}}' "${pg_cid}" 2>/dev/null || true)"
  if [ "${pg_health}" = "healthy" ]; then
    echo "[ok] postgres: running (localhost:5433, ${pg_health})"
  else
    echo "[fail] postgres: container exists but not healthy (${pg_health:-unknown})"
    status=1
  fi
else
  echo "[fail] postgres: container not running"
  status=1
fi

# --- Redis container ----------------------------------------------------------
redis_cid="$(docker compose -f "${DEV_COMPOSE_FILE}" ps -q redis 2>/dev/null || true)"
if [ -n "${redis_cid}" ]; then
  redis_health="$(docker inspect --format='{{.State.Health.Status}}' "${redis_cid}" 2>/dev/null || true)"
  if [ "${redis_health}" = "healthy" ]; then
    echo "[ok] redis: running (localhost:6380, ${redis_health})"
  else
    echo "[fail] redis: container exists but not healthy (${redis_health:-unknown})"
    status=1
  fi
else
  echo "[fail] redis: container not running"
  status=1
fi

# --- Backend ------------------------------------------------------------------
if [ -f "${BACKEND_PID_FILE}" ] && process_is_running "$(cat "${BACKEND_PID_FILE}")"; then
  backend_pid="$(cat "${BACKEND_PID_FILE}")"
  if http_ok "http://localhost:4000/healthz" 2500; then
    echo "[ok] backend: pid ${backend_pid}, http://localhost:4000/healthz OK"
  else
    echo "[warn] backend: pid ${backend_pid} running but /healthz not OK"
  fi
else
  echo "[fail] backend: not running"
  status=1
fi

# --- Runner -------------------------------------------------------------------
if [ -f "${RUNNER_PID_FILE}" ] && process_is_running "$(cat "${RUNNER_PID_FILE}")"; then
  runner_pid="$(cat "${RUNNER_PID_FILE}")"
  if [ -f "${RUNNER_LOG_FILE}" ] && grep -q "hosted mode — connecting to" "${RUNNER_LOG_FILE}" 2>/dev/null; then
    echo "[ok] runner: pid ${runner_pid}, connected"
  else
    echo "[warn] runner: pid ${runner_pid} running but no connect log yet"
  fi
else
  echo "[fail] runner: not running"
  status=1
fi

# --- Web ----------------------------------------------------------------------
web_url="$(web_base_url)"
web_listener_pid="$(listener_pid_for_port "${WEB_PORT}" || true)"

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

echo "[info] web log: ${WEB_LOG_FILE}"

exit "${status}"
