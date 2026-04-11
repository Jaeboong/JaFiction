-- Phase 4 + Phase 5 initial schema
-- Includes: users, sessions (Phase 4) and devices (Phase 5).
-- projects_meta and runs_meta are defined in schema.ts for Phase 6 but omitted here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "users" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "google_sub"  TEXT NOT NULL UNIQUE,
  "email"       TEXT NOT NULL,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "sessions" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "cookie_hash"  TEXT NOT NULL,
  "expires_at"   TIMESTAMPTZ NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "sessions_expires_at_idx" ON "sessions" ("expires_at");

-- ---------------------------------------------------------------------------
-- devices  (Phase 5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "devices" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label"          TEXT NOT NULL,
  "workspace_root" TEXT NOT NULL,
  "token_hash"     TEXT NOT NULL,
  "revoked_at"     TIMESTAMPTZ,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_seen_at"   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "devices_user_id_idx" ON "devices" ("user_id");
