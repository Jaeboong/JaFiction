import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyWebsocket from "@fastify/websocket";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { Db } from "./db/client";
import type { SessionStore } from "./auth/session";
import { registerGoogleOauth } from "./auth/googleOauth";
import { registerHealthz } from "./routes/healthz";
import { registerAuth } from "./routes/auth";
import { registerMe } from "./routes/me";
import { registerPairing, createDrizzleDeviceStore } from "./routes/pairing";
import { registerRunnerSocket, createDrizzleRunnerSocketDeviceStore } from "./ws/runnerSocket";
import { registerBrowserEvents } from "./ws/browserEvents";
import { registerRpc, createDrizzleRpcDeviceStore } from "./routes/rpc";
import { createDeviceHub } from "./ws/deviceHub";
import type { DeviceHub } from "./ws/deviceHub";
import type { FetchGoogleUserInfo } from "./routes/auth";
import type { Env } from "./env";

export interface AppDeps {
  readonly pool: Pool;
  readonly redis: Redis;
  readonly db: Db;
  readonly store: SessionStore;
  readonly env: Env;
  readonly fetchGoogleUserInfo?: FetchGoogleUserInfo;
  readonly logger?: boolean | object;
  /** Optional pre-built hub — useful for tests that want direct hub access. */
  readonly deviceHub?: DeviceHub;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? (deps.env.NODE_ENV !== "test"),
  });

  // Plugins
  await app.register(fastifyCookie, {
    secret: deps.env.COOKIE_SECRET,
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Phase 9 will configure strict CSP
  });

  await app.register(fastifyWebsocket);

  // Google OAuth (start path + callback are both registered here)
  await registerGoogleOauth(app, deps.env);

  // Routes
  await registerHealthz(app, { pool: deps.pool, redis: deps.redis });

  await registerAuth(app, {
    db: deps.db,
    store: deps.store,
    env: deps.env,
    fetchGoogleUserInfo: deps.fetchGoogleUserInfo,
  });

  await registerMe(app, { store: deps.store, env: deps.env });

  await registerPairing(app, {
    deviceStore: createDrizzleDeviceStore(deps.db),
    redis: deps.redis,
    store: deps.store,
    env: deps.env,
  });

  // Phase 6 — runner ↔ backend relay + browser event fan-out
  const hub = deps.deviceHub ?? createDeviceHub({
    redis: deps.redis,
    logger: deps.env.NODE_ENV !== "test" ? {
      info: (msg, meta) => app.log.info(meta ?? {}, msg),
      warn: (msg, meta) => app.log.warn(meta ?? {}, msg),
      error: (msg, meta) => app.log.error(meta ?? {}, msg)
    } : undefined
  });

  await registerRunnerSocket(app, {
    deviceStore: createDrizzleRunnerSocketDeviceStore(deps.db),
    hub
  });

  await registerBrowserEvents(app, {
    store: deps.store,
    redis: deps.redis as unknown as import("./ws/browserEvents").SubscribeRedis
  });

  await registerRpc(app, {
    store: deps.store,
    hub,
    deviceStore: createDrizzleRpcDeviceStore(deps.db)
  });

  return app;
}
