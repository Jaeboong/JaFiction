#!/bin/sh
# Runs drizzle migrations against DATABASE_URL before starting the backend.
# On failure, exits non-zero so Docker restarts the container — compose will
# keep retrying until postgres is healthy and the migration succeeds.
set -eu

cd /app/packages/backend

echo "[entrypoint] applying drizzle migrations..."
# Drizzle-kit migrate can fail with "relation already exists" (42P07) when the
# __drizzle_migrations journal state disagrees with the actual schema (e.g.
# after a restored DB, or a hash mismatch). The schema is the source of truth
# at runtime, so we log the error and continue rather than crash-looping.
MIGRATE_OUT=$(node ../../node_modules/.bin/drizzle-kit migrate 2>&1) || {
  if echo "$MIGRATE_OUT" | grep -q 'already exists'; then
    echo "[entrypoint] migrate reported existing relation — continuing"
    echo "$MIGRATE_OUT" | tail -5
  else
    echo "$MIGRATE_OUT"
    exit 1
  fi
}

echo "[entrypoint] starting backend: $*"
cd /app
exec "$@"
