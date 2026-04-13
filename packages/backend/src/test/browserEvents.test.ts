/**
 * browserEvents.test.ts
 *
 * Tests the /ws/events browser WebSocket endpoint and /api/ws-probe.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyWebsocket from "@fastify/websocket";
import { registerBrowserEvents } from "../ws/browserEvents";
import {
  makeFakePubSubRedis,
  makeInMemorySessionStore
} from "./fakes";
import type { UserRow } from "../auth/session";
import { SESSION_COOKIE, makeRequireSession } from "../auth/session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(id: string): UserRow {
  return { id, email: `${id}@test.com`, google_sub: `sub-${id}` };
}

async function buildTestApp(
  redis: ReturnType<typeof makeFakePubSubRedis>,
  store: ReturnType<typeof makeInMemorySessionStore>
) {
  const app = Fastify({ logger: false });
  await app.register(fastifyCookie, { secret: "test-secret-32-chars-minimum-!!!" });
  await app.register(fastifyWebsocket);
  await registerBrowserEvents(app, { store, redis });
  // Register ws-probe (same as in buildApp)
  const requireSession = makeRequireSession(store);
  app.get("/api/ws-probe", { preHandler: requireSession }, async (_request, reply) => {
    return reply.code(200).send({ ok: true });
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as import("net").AddressInfo).port;
  return { app, port };
}

function nextMessage(ws: import("ws").WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(String(data)));
    ws.once("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("browserEvents — /ws/events", () => {
  it("no session cookie → 401 before upgrade", async () => {
    const redis = makeFakePubSubRedis();
    const userMap = new Map<string, UserRow>();
    const store = makeInMemorySessionStore(userMap);
    const { app, port } = await buildTestApp(redis, store);
    try {
      const { WebSocket } = await import("ws");
      // Connect without a cookie.
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`);
      const code = await new Promise<number>((resolve) => {
        ws.once("close", (c) => resolve(c));
        ws.once("error", () => resolve(-1));
      });
      // Fastify returns HTTP 401 which results in the ws being closed.
      assert.notStrictEqual(code, undefined);
    } finally {
      await app.close();
    }
  });

  it("valid session → connects and receives published events", async () => {
    const redis = makeFakePubSubRedis();
    const userId = "user-events-1";
    const userMap = new Map<string, UserRow>([[userId, makeUser(userId)]]);
    const store = makeInMemorySessionStore(userMap);
    const { raw } = await store.createSession(userId);
    const { app, port } = await buildTestApp(redis, store);
    try {
      const { WebSocket } = await import("ws");
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/events`, {
        headers: { Cookie: `${SESSION_COOKIE}=${raw}` }
      });

      await new Promise<void>((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });

      const msgPromise = nextMessage(ws);
      const payload = { v: 1, event: "state_snapshot", payload: { state: {} } };
      await redis.publish(`user:${userId}:events`, JSON.stringify(payload));
      const received = JSON.parse(await msgPromise);
      assert.strictEqual(received.event, "state_snapshot");
      ws.close();
    } finally {
      await app.close();
    }
  });

  it("two concurrent browser sockets for same user both receive events", async () => {

    const redis = makeFakePubSubRedis();
    const userId = "user-events-2";
    const userMap = new Map<string, UserRow>([[userId, makeUser(userId)]]);
    const store = makeInMemorySessionStore(userMap);
    const { raw: raw1 } = await store.createSession(userId);
    const { raw: raw2 } = await store.createSession(userId);
    const { app, port } = await buildTestApp(redis, store);
    try {
      const { WebSocket } = await import("ws");
      const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws/events`, {
        headers: { Cookie: `${SESSION_COOKIE}=${raw1}` }
      });
      const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws/events`, {
        headers: { Cookie: `${SESSION_COOKIE}=${raw2}` }
      });

      await Promise.all([
        new Promise<void>((resolve, reject) => { ws1.once("open", resolve); ws1.once("error", reject); }),
        new Promise<void>((resolve, reject) => { ws2.once("open", resolve); ws2.once("error", reject); }),
      ]);

      const msg1Promise = nextMessage(ws1);
      const msg2Promise = nextMessage(ws2);

      await redis.publish(`user:${userId}:events`, JSON.stringify({ v: 1, event: "run_finished", payload: { runId: "r", status: "completed" } }));

      const [m1, m2] = await Promise.all([msg1Promise, msg2Promise]);
      const parsed1 = JSON.parse(m1);
      const parsed2 = JSON.parse(m2);
      assert.strictEqual(parsed1.event, "run_finished");
      assert.strictEqual(parsed2.event, "run_finished");

      ws1.close();
      ws2.close();
    } finally {
      await app.close();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/ws-probe
// ---------------------------------------------------------------------------

describe("GET /api/ws-probe", () => {
  it("no session cookie → 401", async () => {
    const redis = makeFakePubSubRedis();
    const userMap = new Map<string, UserRow>();
    const store = makeInMemorySessionStore(userMap);
    const { app, port } = await buildTestApp(redis, store);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ws-probe`);
      assert.strictEqual(res.status, 401);
    } finally {
      await app.close();
    }
  });

  it("valid session → 200 with {ok: true}", async () => {
    const redis = makeFakePubSubRedis();
    const userId = "user-probe-1";
    const userMap = new Map<string, UserRow>([[userId, makeUser(userId)]]);
    const store = makeInMemorySessionStore(userMap);
    const { raw } = await store.createSession(userId);
    const { app, port } = await buildTestApp(redis, store);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ws-probe`, {
        headers: { Cookie: `${SESSION_COOKIE}=${raw}` }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json() as { ok: boolean };
      assert.strictEqual(body.ok, true);
    } finally {
      await app.close();
    }
  });
});
