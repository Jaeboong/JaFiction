import { loadEnv } from "./env";
import { createPgPool, createDrizzle } from "./db/client";
import { createRedis } from "./redis/client";
import { createSessionStore } from "./auth/session";
import { buildApp } from "./app";

async function main(): Promise<void> {
  const env = loadEnv();

  const pool = createPgPool(env);
  const db = createDrizzle(pool);
  const redis = createRedis(env);

  await redis.connect();

  const store = createSessionStore(db, env);

  const app = await buildApp({ pool, redis, db, store, env });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err: unknown) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
