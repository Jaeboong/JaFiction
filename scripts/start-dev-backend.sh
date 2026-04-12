#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/harness-common.sh"

ensure_harness_dirs

ENV_DEV="${ROOT_DIR}/packages/backend/.env.dev"
ENV_EXAMPLE="${ROOT_DIR}/packages/backend/.env.dev.example"

# --- 1. Ensure .env.dev exists -----------------------------------------------
if [ ! -f "${ENV_DEV}" ]; then
  cp "${ENV_EXAMPLE}" "${ENV_DEV}"
  echo "[jasojeon] Created packages/backend/.env.dev from template." >&2
  echo "" >&2
  echo "  Fill in the following values before continuing:" >&2
  echo "    GOOGLE_CLIENT_ID    — from Google Cloud Console (OAuth 2.0 client)" >&2
  echo "    GOOGLE_CLIENT_SECRET — same client" >&2
  echo "    COOKIE_SECRET        — run: openssl rand -hex 32" >&2
  echo "" >&2
  echo "  Then re-run: ./scripts/start-dev-backend.sh" >&2
  exit 1
fi

# --- 2. Bring up dev compose and wait for healthchecks -----------------------
echo "[jasojeon] Starting dev infrastructure (postgres + redis)..."
docker compose -f "${DEV_COMPOSE_FILE}" up -d

echo "[jasojeon] Waiting for postgres and redis healthchecks (60s)..."
deadline=$((SECONDS + 60))
while [ "${SECONDS}" -lt "${deadline}" ]; do
  pg_status="$(docker compose -f "${DEV_COMPOSE_FILE}" ps -q postgres 2>/dev/null | xargs -r docker inspect --format='{{.State.Health.Status}}' 2>/dev/null || true)"
  redis_status="$(docker compose -f "${DEV_COMPOSE_FILE}" ps -q redis 2>/dev/null | xargs -r docker inspect --format='{{.State.Health.Status}}' 2>/dev/null || true)"
  if [ "${pg_status}" = "healthy" ] && [ "${redis_status}" = "healthy" ]; then
    echo "[jasojeon] Postgres and Redis are healthy."
    break
  fi
  sleep 2
done

pg_status="$(docker compose -f "${DEV_COMPOSE_FILE}" ps -q postgres 2>/dev/null | xargs -r docker inspect --format='{{.State.Health.Status}}' 2>/dev/null || true)"
redis_status="$(docker compose -f "${DEV_COMPOSE_FILE}" ps -q redis 2>/dev/null | xargs -r docker inspect --format='{{.State.Health.Status}}' 2>/dev/null || true)"
if [ "${pg_status}" != "healthy" ] || [ "${redis_status}" != "healthy" ]; then
  echo "[jasojeon] Timed out waiting for infra healthchecks (pg=${pg_status:-unknown}, redis=${redis_status:-unknown})." >&2
  exit 1
fi

# --- 3. Run DB migrations ----------------------------------------------------
echo "[jasojeon] Running database migrations..."
set -a
# shellcheck disable=SC1090
source "${ENV_DEV}"
set +a
"${ROOT_DIR}/scripts/with-npm.sh" run db:migrate -w packages/backend

# --- 4. Start backend under supervisor (idempotent) --------------------------
if [ -f "${BACKEND_PID_FILE}" ]; then
  existing_pid="$(cat "${BACKEND_PID_FILE}")"
  if [ -n "${existing_pid}" ] && process_is_running "${existing_pid}"; then
    echo "[jasojeon] Backend already running (pid ${existing_pid}), stopping first..."
    stop_pid_file "backend" "${BACKEND_PID_FILE}" || true
  else
    rm -f "${BACKEND_PID_FILE}"
  fi
fi

: > "${BACKEND_LOG_FILE}"

setsid bash -lc '
  set -a
  # shellcheck disable=SC1090
  source "$1"
  set +a
  exec "$2" "$3" \
    --label backend \
    --pidfile "$4" \
    --logfile "$5" \
    -- "$6" "$7" --watch "$8"
' _ \
  "${ENV_DEV}" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/scripts/lib/supervise.mjs" \
  "${BACKEND_PID_FILE}" \
  "${BACKEND_LOG_FILE}" \
  "${ROOT_DIR}/scripts/with-node.sh" \
  "${ROOT_DIR}/node_modules/tsx/dist/cli.mjs" \
  "${ROOT_DIR}/packages/backend/src/index.ts" \
  < /dev/null >> "${BACKEND_LOG_FILE}" 2>&1 &

backend_launcher_pid="$!"
# Wait briefly so supervise.mjs can write its own pid to the pidfile
sleep 1

echo "[jasojeon] Backend supervisor started (launcher pid ${backend_launcher_pid})."
echo "[jasojeon] Backend log: ${BACKEND_LOG_FILE}"

# --- 5. Wait for /healthz -----------------------------------------------------
if ! wait_for_http "http://localhost:4000/healthz" 30; then
  print_log_tail "backend" "${BACKEND_LOG_FILE}"
  echo "[jasojeon] Backend did not become ready at http://localhost:4000/healthz." >&2
  exit 1
fi

echo "[jasojeon] Backend is ready at http://localhost:4000 (pid $(cat "${BACKEND_PID_FILE}" 2>/dev/null || echo unknown))."
