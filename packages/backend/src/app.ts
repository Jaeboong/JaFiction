import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import { registerStrictSecurityHeaders } from "./security/csp";
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
import { registerRunnerDownload } from "./routes/runnerDownload";
import { createSubscribeAdapter } from "./redis/subscribeAdapter";
import { createDeviceHub } from "./ws/deviceHub";
import type { DeviceHub } from "./ws/deviceHub";
import type { FetchGoogleUserInfo } from "./routes/auth";
import type { Env } from "./env";
import { makeRequireSession } from "./auth/session";

export interface AppDeps {
  readonly pool: Pool;
  readonly redis: Redis;
  /** Dedicated Redis connection for subscribe-mode channels (browserEvents). */
  readonly redisSub?: Redis;
  readonly db: Db;
  readonly store: SessionStore;
  readonly env: Env;
  readonly fetchGoogleUserInfo?: FetchGoogleUserInfo;
  readonly logger?: boolean | object;
  /** Optional pre-built hub — useful for tests that want direct hub access. */
  readonly deviceHub?: DeviceHub;
}

/**
 * Pino redaction paths for the backend logger. Every field here is masked
 * wherever it appears in an object that the logger serializes, so leaks
 * from accidental `log.info({ body: req.body })` or from future ad-hoc
 * diagnostic logging cannot surface the raw secret.
 *
 * Keep in sync with runner-side `redactForLog` in
 * `packages/runner/src/hosted/rpcDispatcher.ts` — both ends of the RPC
 * boundary must redact the same shapes.
 */
export const BACKEND_LOG_REDACT_PATHS: readonly string[] = [
  // save_provider_api_key payload
  "payload.key",
  "req.body.payload.key",
  "body.payload.key",
  // notion_connect payload
  "payload.token",
  "req.body.payload.token",
  "body.payload.token",
  // opendart_save_key payload
  "payload.apiKey",
  "req.body.payload.apiKey",
  "body.payload.apiKey",
  // Session cookie echoed into logs
  "req.headers.cookie",
  "headers.cookie"
];

function defaultLoggerConfig(): object {
  return {
    redact: {
      paths: [...BACKEND_LOG_REDACT_PATHS],
      censor: "[REDACTED]"
    }
  };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger ?? (deps.env.NODE_ENV !== "test" ? defaultLoggerConfig() : false),
    bodyLimit: 20 * 1024 * 1024,
  });

  // Plugins
  await app.register(fastifyCookie, {
    secret: deps.env.COOKIE_SECRET,
  });

  await registerStrictSecurityHeaders(app);

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

  await registerMe(app, { store: deps.store, env: deps.env, db: deps.db });

  // Phase 6 — runner ↔ backend relay + browser event fan-out
  // Hub must be created before registerPairing so the approve handler can
  // auto-connect new browser sessions to an already-connected runner.
  const hub = deps.deviceHub ?? createDeviceHub({
    redis: deps.redis,
    logger: deps.env.NODE_ENV !== "test" ? {
      info: (msg, meta) => app.log.info(meta ?? {}, msg),
      warn: (msg, meta) => app.log.warn(meta ?? {}, msg),
      error: (msg, meta) => app.log.error(meta ?? {}, msg)
    } : undefined
  });

  await registerPairing(app, {
    deviceStore: createDrizzleDeviceStore(deps.db),
    redis: deps.redis,
    store: deps.store,
    env: deps.env,
    hub,
  });

  await registerRunnerSocket(app, {
    deviceStore: createDrizzleRunnerSocketDeviceStore(deps.db),
    hub
  });

  await registerBrowserEvents(app, {
    store: deps.store,
    redis: createSubscribeAdapter(deps.redisSub ?? deps.redis)
  });

  await registerRpc(app, {
    store: deps.store,
    hub,
    deviceStore: createDrizzleRpcDeviceStore(deps.db)
  });

  registerRunnerDownload(app);

  // Lightweight session probe — lets the web client verify session validity
  // over HTTP before opening a WebSocket (JS cannot read WS 401 directly).
  const requireSession = makeRequireSession(deps.store);
  app.get("/api/ws-probe", { preHandler: requireSession }, async (_request, reply) => {
    return reply.code(200).send({ ok: true });
  });

  return app;
}
