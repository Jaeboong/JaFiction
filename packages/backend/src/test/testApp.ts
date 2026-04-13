/**
 * Test app builder — replaces @fastify/oauth2 with stubs so no real Google
 * credentials or network are needed.
 */
import Fastify, { type FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import { registerStrictSecurityHeaders } from "../security/csp";
import type { Pool } from "pg";
import type Redis from "ioredis";
import type { SessionStore } from "../auth/session";
import {
  setSessionCookie,
  clearSessionCookie,
  SESSION_COOKIE,
  makeRequireSession,
} from "../auth/session";
import type { AuthenticatedRequest } from "../auth/session";
import { registerHealthz } from "../routes/healthz";
import { registerMe } from "../routes/me";
import { registerPairing } from "../routes/pairing";
import type { DeviceStore } from "../routes/pairing";
import type { Env } from "../env";
import type { GoogleUserInfo } from "../routes/auth";

export const TEST_ENV: Env = {
  DATABASE_URL: "postgres://fake",
  REDIS_URL: "redis://fake",
  GOOGLE_CLIENT_ID: "fake-client-id",
  GOOGLE_CLIENT_SECRET: "fake-client-secret",
  COOKIE_SECRET: "test-cookie-secret-32-chars-minimum!",
  PORT: 3099,
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "http://localhost:3099",
  DART_API_KEY: "test-dart-api-key",
};

export interface TestAppDeps {
  readonly pool: Pool;
  readonly redis: Redis;
  readonly store: SessionStore;
  /**
   * Called when /auth/google/callback is hit with ?simulate_user=<json>.
   * The test controls what "Google" returns.
   */
  readonly resolveGoogleUser?: (query: Record<string, string>) => GoogleUserInfo | null;
  /**
   * Map of userId -> UserRow for creating sessions.
   * Tests call POST /test/seed-user to pre-create users in the store.
   */
  readonly userMap: Map<string, { id: string; email: string; google_sub: string }>;
  /**
   * Optional device store for pairing tests.
   * If provided, pairing routes are registered.
   */
  readonly deviceStore?: DeviceStore;
}

export async function buildTestApp(deps: TestAppDeps): Promise<FastifyInstance> {
  const env = TEST_ENV;
  const app = Fastify({ logger: false });

  await app.register(fastifyCookie, {
    secret: env.COOKIE_SECRET,
  });

  await registerStrictSecurityHeaders(app);
  await app.register(fastifyWebsocket);

  // Healthz
  await registerHealthz(app, { pool: deps.pool, redis: deps.redis });

  // Stub OAuth start route
  app.get("/auth/google", async (_request, reply) => {
    await reply.redirect("https://accounts.google.com/o/oauth2/auth?stub=1");
  });

  // Stub OAuth callback — the test passes ?google_sub=x&email=y
  app.get("/auth/google/callback", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const googleSub = query["google_sub"];
    const email = query["email"];

    if (!googleSub || !email) {
      await reply.code(400).send({ error: "Missing google_sub or email" });
      return;
    }

    // S12: destroy any pre-existing session before issuing a new one
    const existingRaw = request.cookies[SESSION_COOKIE];
    if (existingRaw) {
      try {
        await deps.store.destroySession(existingRaw);
      } catch {
        // best-effort
      }
    }

    // Find or create user in userMap
    let userId: string | undefined;
    for (const [id, u] of deps.userMap.entries()) {
      if (u.google_sub === googleSub) {
        userId = id;
        break;
      }
    }

    if (!userId) {
      userId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      deps.userMap.set(userId, { id: userId, email, google_sub: googleSub });
    }

    const { raw } = await deps.store.createSession(userId);
    setSessionCookie(reply, raw, env);
    await reply.redirect(env.PUBLIC_BASE_URL);
  });

  // Logout routes
  const requireSession = makeRequireSession(deps.store);

  app.post("/auth/logout", { preHandler: requireSession }, async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) await deps.store.destroySession(raw);
    clearSessionCookie(reply);
    await reply.send({ ok: true });
  });

  app.get("/auth/logout", async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      try { await deps.store.destroySession(raw); } catch { /* best-effort */ }
    }
    clearSessionCookie(reply);
    await reply.redirect(env.PUBLIC_BASE_URL);
  });

  // /api/me
  await registerMe(app, { store: deps.store, env });

  // /auth/device-claim + /api/device-claim/approve + /api/devices (only when a device store is provided)
  if (deps.deviceStore) {
    await registerPairing(app, {
      deviceStore: deps.deviceStore,
      redis: deps.redis,
      store: deps.store,
      env,
    });
  }

  return app;
}
