import Redis from "ioredis";
import type { Env } from "../env";

export function createRedis(env: Pick<Env, "REDIS_URL">): Redis {
  return new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
}
