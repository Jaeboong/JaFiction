import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import type { Env } from "../env";

export type Db = NodePgDatabase<typeof schema>;

export function createPgPool(env: Pick<Env, "DATABASE_URL">): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });
}

export function createDrizzle(pool: Pool): Db {
  return drizzle(pool, { schema });
}
