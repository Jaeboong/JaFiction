#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs

# Support multiple backend URLs via JASOJEON_BACKEND_URLS (comma-separated)
# or a single URL via JASOJEON_BACKEND_URL.
# Default: localhost + hosted backend (both simultaneously).
backend_urls="${JASOJEON_BACKEND_URLS:-${JASOJEON_BACKEND_URL:-http://localhost:4000,https://xn--9l4b13i8j.com}}"

# Parse optional flags
foreground=0
while [ $# -gt 0 ]; do
  case "$1" in
    --foreground)
      foreground=1
      shift
      ;;
    --backend-url)
      backend_urls="$2"
      shift 2
      ;;
    --backend-urls)
      backend_urls="$2"
      shift 2
      ;;
    *)
      echo "[jasojeon] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

stop_pid_file "runner" "${RUNNER_PID_FILE}" || true
: > "${RUNNER_LOG_FILE}"

if [ "${foreground}" -eq 1 ]; then
  export JASOJEON_MODE="hosted"
  export JASOJEON_BACKEND_URLS="${backend_urls}"
  exec "${ROOT_DIR}/scripts/with-node.sh" \
    "${ROOT_DIR}/scripts/lib/supervise.mjs" \
    --label runner \
    --pidfile "${RUNNER_PID_FILE}" \
    --logfile "${RUNNER_LOG_FILE}" \
    -- "${ROOT_DIR}/scripts/with-node.sh" \
    "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
    --watch \
    "${ROOT_DIR}/packages/runner/src/index.ts"
fi

# Runner auto-claims on first boot — no pairing prompt.
setsid bash -lc '
  export JASOJEON_MODE="hosted"
  export JASOJEON_BACKEND_URLS="$1"
  exec "$2" "$3" \
    --label runner \
    --pidfile "$4" \
    --logfile "$5" \
    -- "$6" "$7" "$8"
' _ \
  "${backend_urls}" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/scripts/lib/supervise.mjs" \
  "${RUNNER_PID_FILE}" \
  "${RUNNER_LOG_FILE}" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
  --watch \
  "${ROOT_DIR}/packages/runner/src/index.ts" \
  < /dev/null >> "${RUNNER_LOG_FILE}" 2>&1 &

echo "[jasojeon] Runner supervisor started."
echo "[jasojeon] Runner log: ${RUNNER_LOG_FILE}"

# Wait for runner to either connect (already paired) or start the auto-claim
# poll (first boot). Both log "hosted mode — connecting to" or "Waiting for approval".
echo "[jasojeon] Waiting for runner to start (30s)..."
deadline=$((SECONDS + 30))
started=0
while [ "${SECONDS}" -lt "${deadline}" ]; do
  if [ -f "${RUNNER_LOG_FILE}" ] && grep -qE "hosted mode — connecting to|Waiting for approval" "${RUNNER_LOG_FILE}" 2>/dev/null; then
    started=1
    break
  fi
  sleep 1
done

if [ "${started}" -eq 0 ]; then
  print_log_tail "runner" "${RUNNER_LOG_FILE}"
  echo "[jasojeon] Runner did not start within 30s." >&2
  exit 1
fi

echo "[jasojeon] Runner started (pid $(cat "${RUNNER_PID_FILE}" 2>/dev/null || echo unknown))."
