#!/bin/sh
# Runs drizzle migrations against DATABASE_URL before starting the backend.
# On failure, exits non-zero so Docker restarts the container — compose will
# keep retrying until postgres is healthy and the migration succeeds.
set -eu

cd /app/packages/backend

echo "[entrypoint] applying drizzle migrations..."
node ../../node_modules/.bin/drizzle-kit migrate

echo "[entrypoint] starting backend: $*"
cd /app
exec "$@"
