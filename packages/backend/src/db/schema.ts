import {
  pgTable,
  primaryKey,
  uuid,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  google_sub: text("google_sub").unique().notNull(),
  email: text("email").notNull(),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
});

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  cookie_hash: text("cookie_hash").notNull(),
  expires_at: timestamp("expires_at").notNull(),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  last_seen_at: timestamp("last_seen_at").notNull().default(sql`now()`),
});

// ---------------------------------------------------------------------------
// devices  (Phase 5 — extended in Stage 11.9 with hostname/os/runner_version)
// ---------------------------------------------------------------------------
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  label: text("label").notNull(),
  hostname: text("hostname"),
  os: text("os"),
  runner_version: text("runner_version"),
  workspace_root: text("workspace_root"),
  token_hash: text("token_hash").notNull(),
  revoked_at: timestamp("revoked_at"),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  last_seen_at: timestamp("last_seen_at"),
});

export const device_users = pgTable(
  "device_users",
  {
    device_id: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").notNull().default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.device_id, t.user_id] }),
  })
);

// ---------------------------------------------------------------------------
// projects_meta  (Phase 6)
// ---------------------------------------------------------------------------
export const projects_meta = pgTable(
  "projects_meta",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    device_id: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    company_name: text("company_name"),
    updated_at: timestamp("updated_at").notNull().default(sql`now()`),
  },
  (t) => ({ uniq: unique().on(t.user_id, t.device_id, t.slug) })
);

// ---------------------------------------------------------------------------
// runs_meta  (Phase 6)
// ---------------------------------------------------------------------------
export const runs_meta = pgTable(
  "runs_meta",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    device_id: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    project_slug: text("project_slug").notNull(),
    run_id: text("run_id").notNull(),
    status: text("status").notNull(),
    review_mode: text("review_mode").notNull(),
    started_at: timestamp("started_at").notNull(),
    finished_at: timestamp("finished_at"),
  },
  (t) => ({ uniq: unique().on(t.device_id, t.project_slug, t.run_id) })
);
