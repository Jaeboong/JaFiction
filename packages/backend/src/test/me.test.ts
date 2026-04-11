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
