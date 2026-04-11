#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_DIR="${ROOT_DIR}/.harness"
PID_DIR="${HARNESS_DIR}/pids"
LOG_DIR="${HARNESS_DIR}/logs"
RUNNER_PID_FILE="${PID_DIR}/runner.pid"
WEB_PID_FILE="${PID_DIR}/web.pid"
RUNNER_LOG_FILE="${LOG_DIR}/runner.log"
WEB_LOG_FILE="${LOG_DIR}/web.log"
WEB_PORT="${JASOJEON_WEB_PORT:-4124}"

ensure_harness_dirs() {
  mkdir -p "${PID_DIR}" "${LOG_DIR}"
}

runner_port() {
  "${ROOT_DIR}/scripts/with-node.sh" -e '
    const fs = require("node:fs");
    const configPath = process.argv[1];
    let port = 4123;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (Number.isInteger(raw.port) && raw.port > 0) {
        port = raw.port;
      }
    } catch {}
    process.stdout.write(String(port));
  ' "${HOME}/.jasojeon/runner.json"
}

runner_base_url() {
  printf 'http://127.0.0.1:%s' "$(runner_port)"
}

web_base_url() {
  printf 'http://127.0.0.1:%s' "${WEB_PORT}"
}

process_is_running() {
  local pid="$1"
  kill -0 "${pid}" >/dev/null 2>&1
}

listener_pid_for_port() {
  local port="$1"
  fuser -n tcp "${port}" 2>/dev/null | awk 'NF { print $1; exit }'
}

stop_pid_file() {
  local label="$1"
  local pid_file="$2"

  if [ ! -f "${pid_file}" ]; then
    return 0
  fi

  local pid
  pid="$(cat "${pid_file}")"
  if [ -n "${pid}" ] && process_is_running "${pid}"; then
    kill "${pid}" >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5; do
      if ! process_is_running "${pid}"; then
        break
      fi
      sleep 1
    done
    if process_is_running "${pid}"; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
  fi

  rm -f "${pid_file}"
  echo "[jasojeon] Stopped ${label} process."
}

http_ok() {
  local url="$1"
  local timeout_ms="${2:-2000}"
  "${ROOT_DIR}/scripts/with-node.sh" -e '
    const url = process.argv[1];
    const timeoutMs = Number(process.argv[2] || "2000");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, { signal: controller.signal })
      .then((response) => {
        clearTimeout(timer);
        process.exit(response.ok ? 0 : 1);
      })
      .catch(() => {
        clearTimeout(timer);
        process.exit(1);
      });
  ' "${url}" "${timeout_ms}"
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-30}"
  local deadline=$((SECONDS + timeout_seconds))
  while [ "${SECONDS}" -lt "${deadline}" ]; do
    if http_ok "${url}" 2500; then
      return 0
    fi
    sleep 1
  done
  return 1
}

kill_port_listeners() {
  local label="$1"
  local port="$2"
  if fuser "${port}/tcp" >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    sleep 1
    echo "[jasojeon] Cleared existing ${label} listener on port ${port}."
  fi
}

kill_matching_processes() {
  local label="$1"
  local pattern="$2"
  local found=0

  while IFS= read -r pid; do
    if [ -z "${pid}" ]; then
      continue
    fi
    found=1
    kill "${pid}" >/dev/null 2>&1 || true
  done < <(pgrep -f "${pattern}" || true)

  if [ "${found}" -eq 1 ]; then
    sleep 1
    while IFS= read -r pid; do
      if [ -z "${pid}" ]; then
        continue
      fi
      kill -9 "${pid}" >/dev/null 2>&1 || true
    done < <(pgrep -f "${pattern}" || true)
    echo "[jasojeon] Cleared stray ${label} processes matching ${pattern}."
  fi
}

print_log_tail() {
  local label="$1"
  local log_file="$2"
  if [ -f "${log_file}" ]; then
    echo "[jasojeon] Recent ${label} log output:" >&2
    tail -n 40 "${log_file}" >&2 || true
  fi
}
