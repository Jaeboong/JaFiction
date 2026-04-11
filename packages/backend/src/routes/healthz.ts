import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type Redis from "ioredis";

export interface HealthzDeps {
  readonly pool: Pool;
  readonly redis: Redis;
}

export async function registerHealthz(
  app: FastifyInstance,
  deps: HealthzDeps
): Promise<void> {
  app.get("/healthz", async (_request, reply) => {
    let pg = false;
    let redis = false;

    try {
      const client = await deps.pool.connect();
      await client.query("SELECT 1");
      client.release();
      pg = true;
    } catch {
      pg = false;
    }

    try {
      await deps.redis.ping();
      redis = true;
    } catch {
      redis = false;
    }

    const ok = pg && redis;
    await reply.code(ok ? 200 : 503).send({ ok, pg, redis });
  });
}
