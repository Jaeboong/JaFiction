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

  return app;
}
