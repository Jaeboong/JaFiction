import {
  pgTable,
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
// devices  (Phase 5 — defined here so schema file is stable)
// ---------------------------------------------------------------------------
export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  workspace_root: text("workspace_root").notNull(),
  token_hash: text("token_hash").notNull(),
  revoked_at: timestamp("revoked_at"),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  last_seen_at: timestamp("last_seen_at"),
});

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
