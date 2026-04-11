#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs

backend_url="${JASOJEON_BACKEND_URL:-http://localhost:4000}"

# Parse optional --backend-url flag
while [ $# -gt 0 ]; do
  case "$1" in
    --backend-url)
      backend_url="$2"
      shift 2
      ;;
    *)
      echo "[jasojeon] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# --- 1. Idempotent: stop existing runner if running --------------------------
if [ -f "${RUNNER_PID_FILE}" ]; then
  existing_pid="$(cat "${RUNNER_PID_FILE}")"
  if [ -n "${existing_pid}" ] && process_is_running "${existing_pid}"; then
    echo "[jasojeon] Runner already running (pid ${existing_pid}), stopping first..."
    stop_pid_file "runner" "${RUNNER_PID_FILE}" || true
  else
    rm -f "${RUNNER_PID_FILE}"
  fi
fi

# --- 2. Check for existing device token --------------------------------------
if ! "${ROOT_DIR}/scripts/with-node.sh" \
     "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
     "${ROOT_DIR}/packages/runner/src/hosted/checkToken.ts" 2>/dev/null; then

  echo ""
  echo "  → Open ${backend_url} in your browser, sign in, and go to Settings → Devices → Add device."
  echo ""

  if [ -n "${JASOJEON_PAIRING_CODE:-}" ]; then
    pairing_code="${JASOJEON_PAIRING_CODE}"
    echo "  → Using pairing code from \$JASOJEON_PAIRING_CODE."
  else
    printf "  → Paste the 8-character pairing code here: "
    read -r pairing_code
  fi

  echo ""
  echo "[jasojeon] Pairing runner..."
  if ! JASOJEON_MODE=pair \
       JASOJEON_BACKEND_URL="${backend_url}" \
       JASOJEON_PAIRING_CODE="${pairing_code}" \
       "${ROOT_DIR}/scripts/with-node.sh" \
       "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
       "${ROOT_DIR}/packages/runner/src/index.ts"; then
    echo "[jasojeon] Pairing failed." >&2
    exit 1
  fi

  echo "[jasojeon] Paired. Starting runner..."
fi

# --- 3. Start runner under supervisor ----------------------------------------
: > "${RUNNER_LOG_FILE}"

setsid bash -lc '
  export JASOJEON_MODE="hosted"
  export JASOJEON_BACKEND_URL="$1"
  exec "$2" "$3" \
    --label runner \
    --pidfile "$4" \
    --logfile "$5" \
    -- "$6" "$7" "$8"
' _ \
  "${backend_url}" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/scripts/lib/supervise.mjs" \
  "${RUNNER_PID_FILE}" \
  "${RUNNER_LOG_FILE}" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
  "${ROOT_DIR}/packages/runner/src/index.ts" \
  < /dev/null >> "${RUNNER_LOG_FILE}" 2>&1 &

echo "[jasojeon] Runner supervisor started."
echo "[jasojeon] Runner log: ${RUNNER_LOG_FILE}"

# --- 4. Wait for runner to connect to backend --------------------------------
echo "[jasojeon] Waiting for runner to connect (30s)..."
deadline=$((SECONDS + 30))
connected=0
while [ "${SECONDS}" -lt "${deadline}" ]; do
  if [ -f "${RUNNER_LOG_FILE}" ] && grep -q "hosted mode — connecting to" "${RUNNER_LOG_FILE}" 2>/dev/null; then
    connected=1
    break
  fi
  sleep 1
done

if [ "${connected}" -eq 0 ]; then
  print_log_tail "runner" "${RUNNER_LOG_FILE}"
  echo "[jasojeon] Runner did not connect within 30s." >&2
  exit 1
fi

echo "[jasojeon] Runner is connected to ${backend_url} (pid $(cat "${RUNNER_PID_FILE}" 2>/dev/null || echo unknown))."
