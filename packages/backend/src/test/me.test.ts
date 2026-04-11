import * as assert from "node:assert/strict";
import test from "node:test";
import {
  makeFakePool,
  makeFakeRedis,
  makeInMemorySessionStore,
} from "./fakes";
import { buildTestApp } from "./testApp";

test("GET /api/me without cookie returns 401", async () => {
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);
  const app = await buildTestApp({
    pool: makeFakePool(),
    redis: makeFakeRedis(),
    store,
    userMap,
  });

  const res = await app.inject({ method: "GET", url: "/api/me" });
  assert.equal(res.statusCode, 401);

  await app.close();
});

test("GET /api/me with invalid cookie returns 401", async () => {
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);
  const app = await buildTestApp({
    pool: makeFakePool(),
    redis: makeFakeRedis(),
    store,
    userMap,
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: "jf_sid=totally-invalid-session-token" },
  });
  assert.equal(res.statusCode, 401);

  await app.close();
});

test("GET /api/me with valid session returns user shape { id, email }", async () => {
  const userId = "user-me-test-1";
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>([
    [userId, { id: userId, email: "me@example.com", google_sub: "sub-me-1" }],
  ]);
  const store = makeInMemorySessionStore(userMap);
  const app = await buildTestApp({
    pool: makeFakePool(),
    redis: makeFakeRedis(),
    store,
    userMap,
  });

  // Create a session directly in the store
  const { raw } = await store.createSession(userId);

  const res = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: `jf_sid=${raw}` },
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { user: { id: string; email: string } };
  assert.equal(body.user.id, userId);
  assert.equal(body.user.email, "me@example.com");

  // Response should only contain id and email, not google_sub or other internals
  assert.ok(!("google_sub" in body.user), "Response should not expose google_sub");

  await app.close();
});

test("GET /api/me with expired session returns 401", async () => {
  const userId = "user-me-expired";
  const userMap = new Map<string, { id: string; email: string; google_sub: string }>([
    [userId, { id: userId, email: "expired@example.com", google_sub: "sub-expired" }],
  ]);

  // Create a store and manually inject an expired session
  const store = makeInMemorySessionStore(userMap);
  const { raw } = await store.createSession(userId);

  // Force-expire it by mutating the internal map
  const cookieHash = (await import("../auth/session")).hashRaw(raw);
  const record = store.sessions.get(cookieHash);
  assert.ok(record);
  // Replace the record with an expired one
  store.sessions.set(cookieHash, {
    ...record,
    expiresAt: new Date(Date.now() - 1000),
  });

  const app = await buildTestApp({
    pool: makeFakePool(),
    redis: makeFakeRedis(),
    store,
    userMap,
  });

  const res = await app.inject({
    method: "GET",
    url: "/api/me",
    headers: { cookie: `jf_sid=${raw}` },
  });

  assert.equal(res.statusCode, 401);

  await app.close();
});

// B4: requireSession must not emit FST_ERR_REP_ALREADY_SENT after a 401 response.
// We verify this by enabling Fastify logging to a collector and asserting no such
// error key appears after an unauthenticated request.
test("B4: requireSession — no FST_ERR_REP_ALREADY_SENT after unauthenticated /api/me", async () => {
  const errorMessages: string[] = [];

  const userMap = new Map<string, { id: string; email: string; google_sub: string }>();
  const store = makeInMemorySessionStore(userMap);

  // Build app with a custom logger that captures error output
  const { default: Fastify } = await import("fastify");
  const fastifyCookie = (await import("@fastify/cookie")).default;
  const fastifyHelmet = (await import("@fastify/helmet")).default;
  const fastifyWebsocket = (await import("@fastify/websocket")).default;
  const { registerMe } = await import("../routes/me");
  const { TEST_ENV } = await import("./testApp");

  const app = Fastify({
    logger: {
      level: "error",
      transport: undefined,
      // Use a custom serializer so we can capture log output in-process
    },
  });

  // Patch the logger to capture error logs
  const originalError = app.log.error.bind(app.log);
  app.log.error = ((...args: unknown[]) => {
    const msg = typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
    errorMessages.push(msg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (originalError as (...a: unknown[]) => any)(...args);
  }) as typeof app.log.error;

  await app.register(fastifyCookie, { secret: TEST_ENV.COOKIE_SECRET });
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });
  await app.register(fastifyWebsocket);
  await registerMe(app, { store, env: TEST_ENV });

  const res = await app.inject({ method: "GET", url: "/api/me" });
  assert.equal(res.statusCode, 401);

  // No FST_ERR_REP_ALREADY_SENT should have been logged
  const hasDoubleReply = errorMessages.some((m) => m.includes("FST_ERR_REP_ALREADY_SENT"));
  assert.equal(hasDoubleReply, false, "requireSession must not trigger FST_ERR_REP_ALREADY_SENT");

  await app.close();
});
